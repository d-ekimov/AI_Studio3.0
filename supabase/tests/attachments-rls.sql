-- Live transaction test used for this feature. All fixtures are rolled back.
-- Run as postgres in the same project after the attachment migration.
begin;
create temp table attachment_checks(test text,passed boolean);
grant select,insert on attachment_checks to authenticated;
do $$ declare uid uuid; cid uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); begin
select id into uid from auth.users order by created_at limit 1;
if uid is null then raise exception 'No existing test owner available'; end if;
perform set_config('test.owner',uid::text,true); perform set_config('test.chat',cid::text,true); perform set_config('test.multi',mid::text,true);
insert into public.ai_chats(id,user_id,title,model)values(cid,uid,'Attachment RLS transaction test','gemini');
insert into public.multi_ai_chats(id,user_id,title,selected_models,sequential_mode)values(mid,uid,'Attachment RLS transaction test',array['gemini'],false);
perform set_config('request.jwt.claim.sub',uid::text,true);
end $$;
set local role authenticated;
-- SQL metadata fixtures model Storage RLS; no binary object is uploaded by these tests.
insert into storage.objects(bucket_id,name,metadata)values('chat-attachments',current_setting('test.owner')||'/chat/'||current_setting('test.chat')||'/test.txt','{"size":3,"mimetype":"text/plain"}');
insert into attachment_checks select 'owner_can_read_own_object',count(*)=1 from storage.objects where bucket_id='chat-attachments' and name=current_setting('test.owner')||'/chat/'||current_setting('test.chat')||'/test.txt';
insert into public.ai_messages(chat_id,role,content,attachments)values(current_setting('test.chat')::uuid,'user','Attachment test',jsonb_build_array(jsonb_build_object('name','test.txt','path',current_setting('test.owner')||'/chat/'||current_setting('test.chat')||'/test.txt','size',3,'mime','text/plain')));
insert into attachment_checks values('message_attachment_reference_accepted',true);
insert into storage.objects(bucket_id,name,metadata)values('chat-attachments',current_setting('test.owner')||'/multi/'||current_setting('test.multi')||'/test.txt','{"size":3,"mimetype":"text/plain"}');
insert into public.multi_ai_messages(chat_id,role,speaker,content,attachments)values(current_setting('test.multi')::uuid,'user','Test','Attachment test',jsonb_build_array(jsonb_build_object('name','test.txt','path',current_setting('test.owner')||'/multi/'||current_setting('test.multi')||'/test.txt','size',3,'mime','text/plain')));
insert into attachment_checks values('multi_message_attachment_reference_accepted',true);
do $$ begin
begin insert into public.multi_ai_messages(chat_id,role,speaker,content,attachments)values(current_setting('test.multi')::uuid,'user','Test','Wrong chat',jsonb_build_array(jsonb_build_object('name','test.txt','path',current_setting('test.owner')||'/chat/'||current_setting('test.chat')||'/test.txt','size',3,'mime','text/plain'))); insert into attachment_checks values('cross_chat_reference_denied',false); exception when raise_exception then insert into attachment_checks values('cross_chat_reference_denied',true); end;
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true) is not null as switched_to_other_user;
insert into attachment_checks select 'other_user_cannot_read_object',count(*)=0 from storage.objects where bucket_id='chat-attachments';
insert into attachment_checks select 'other_user_cannot_read_messages',count(*)=0 from public.ai_messages where chat_id=current_setting('test.chat')::uuid;
do $$ begin
begin insert into storage.objects(bucket_id,name,metadata)values('chat-attachments',current_setting('test.owner')||'/chat/'||current_setting('test.chat')||'/spoof.txt','{"size":3,"mimetype":"text/plain"}'); insert into attachment_checks values('foreign_path_upload_denied',false); exception when insufficient_privilege then insert into attachment_checks values('foreign_path_upload_denied',true); end;
end $$;
insert into attachment_checks select 'other_user_cannot_read_multi_messages',count(*)=0 from public.multi_ai_messages where chat_id=current_setting('test.multi')::uuid;
reset role;
select * from attachment_checks order by test;
rollback;
