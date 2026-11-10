-- Approved additive changes. Run preflight before applying to the live project.
begin;

alter table public.ai_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.multi_ai_messages add column if not exists attachments jsonb not null default '[]'::jsonb;

-- One private bucket for all three existing chat interfaces. Never repurpose avatars.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'chat-attachments' and public) then
    raise exception 'Existing chat-attachments bucket is public; inspect it before continuing';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760, array[
  'image/png','image/jpeg','image/webp','image/gif','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]) on conflict (id) do nothing;

create or replace function public.owns_attachment_chat(object_name text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null
    and split_part(object_name, '/', 1) = auth.uid()::text
    and array_length(string_to_array(object_name, '/'), 1) = 4
    and object_name !~ '(^|/)\.\.?(/|$)'
    and (
      (split_part(object_name, '/', 2) = 'chat' and exists (
        select 1 from public.ai_chats c where c.id::text = split_part(object_name, '/', 3) and c.user_id = auth.uid()
      )) or
      (split_part(object_name, '/', 2) = 'multi' and exists (
        select 1 from public.multi_ai_chats c where c.id::text = split_part(object_name, '/', 3) and c.user_id = auth.uid()
      ))
    );
$$;
revoke all on function public.owns_attachment_chat(text) from public;
grant execute on function public.owns_attachment_chat(text) to authenticated;

-- Restrictive guard also prevents pre-existing broad storage policies from exposing this bucket.
create policy "chat_attachments_boundary" on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'chat-attachments' or public.owns_attachment_chat(name))
with check (bucket_id <> 'chat-attachments' or public.owns_attachment_chat(name));
create policy "chat_attachments_no_anonymous" on storage.objects as restrictive for all to anon
using (bucket_id <> 'chat-attachments') with check (bucket_id <> 'chat-attachments');
create policy "chat_attachments_read" on storage.objects for select to authenticated
using (bucket_id = 'chat-attachments' and public.owns_attachment_chat(name));
create policy "chat_attachments_upload" on storage.objects for insert to authenticated
with check (bucket_id = 'chat-attachments' and public.owns_attachment_chat(name));
create policy "chat_attachments_delete" on storage.objects for delete to authenticated
using (bucket_id = 'chat-attachments' and public.owns_attachment_chat(name));
-- No UPDATE policy: application uploads immutable UUID-named objects with upsert:false.

create or replace function public.check_message_attachments()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare a jsonb; owner_id uuid; kind text; total_size numeric := 0;
begin
  if jsonb_typeof(new.attachments) <> 'array' or jsonb_array_length(new.attachments) > 4 then
    raise exception 'attachments must be an array with at most four files';
  end if;
  if tg_table_name = 'ai_messages' then
    kind := 'chat'; select user_id into owner_id from public.ai_chats where id = new.chat_id;
  else
    kind := 'multi'; select user_id into owner_id from public.multi_ai_chats where id = new.chat_id;
  end if;
  if jsonb_array_length(new.attachments) > 0 and (new.role <> 'user' or owner_id is distinct from auth.uid()) then
    raise exception 'Only an owner user message can reference attachments';
  end if;
  for a in select value from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(a) <> 'object' or coalesce(jsonb_typeof(a->'name'),'') <> 'string'
      or length(a->>'name') not between 1 and 255 or coalesce(jsonb_typeof(a->'size'),'') <> 'number'
      or (a->>'size')::numeric not between 1 and 10485760
      or coalesce(jsonb_typeof(a->'mime'),'') <> 'string'
      or coalesce(jsonb_typeof(a->'path'),'') <> 'string'
      or a->>'path' not like owner_id::text || '/' || kind || '/' || new.chat_id::text || '/%'
      or not public.owns_attachment_chat(a->>'path')
      or not exists (select 1 from storage.objects where bucket_id='chat-attachments' and name=a->>'path'
        and metadata->>'mimetype' = a->>'mime' and (metadata->>'size')::numeric = (a->>'size')::numeric) then
      raise exception 'Invalid attachment or file outside this conversation';
    end if;
    total_size := total_size + (a->>'size')::numeric;
  end loop;
  if total_size > 20971520 or
    (select count(distinct value->>'path') from jsonb_array_elements(new.attachments)) <> jsonb_array_length(new.attachments) then
    raise exception 'Too many bytes or duplicate attachment references';
  end if;
  return new;
end $$;
revoke all on function public.check_message_attachments() from public;
create trigger ai_messages_attachments_guard before insert or update of attachments, chat_id, role
on public.ai_messages for each row execute function public.check_message_attachments();
create trigger multi_ai_messages_attachments_guard before insert or update of attachments, chat_id, role
on public.multi_ai_messages for each row execute function public.check_message_attachments();

commit;
