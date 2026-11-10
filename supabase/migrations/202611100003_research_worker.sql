-- A private scheduler kick token only permits advancing existing, authorized jobs.
-- It is generated inside Postgres, stays in Vault and is never returned to the client.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from vault.secrets where name='research_worker_token')then
  perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'research_worker_token','Private research queue scheduler');
 end if;
end $$;
create function public.research_worker_check(p_token text)returns boolean
language sql stable security definer set search_path='' as $$
 select length(p_token)=72 and exists(select 1 from vault.decrypted_secrets where name='research_worker_token' and decrypted_secret=p_token);
$$;
revoke all on function public.research_worker_check(text)from public,anon,authenticated;
grant execute on function public.research_worker_check(text)to service_role;
select cron.schedule('ai-studio-research-worker','* * * * *',$cron$
 select net.http_post(
  url:='https://zzjfceazpjpavnyyigek.supabase.co/functions/v1/research',
  headers:=jsonb_build_object('Content-Type','application/json','x-research-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='research_worker_token')),
  body:='{"action":"tick"}'::jsonb,timeout_milliseconds:=10000
 );
$cron$);
commit;
