-- Read-only inventory. Do not include row contents or secrets in reports.
select table_name, column_name, data_type, is_nullable from information_schema.columns
where table_schema='public' and table_name in ('ai_chats','ai_messages','multi_ai_chats','multi_ai_messages')
order by table_name, ordinal_position;
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where (schemaname='public' and tablename in ('ai_chats','ai_messages','multi_ai_chats','multi_ai_messages'))
or (schemaname='storage' and tablename='objects');
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('ai_chats','ai_messages','multi_ai_chats','multi_ai_messages');
