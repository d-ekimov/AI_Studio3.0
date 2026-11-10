-- Approved research tables, durable budgets and a queue implemented by locked job rows.
begin;
create table public.research_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 chat_id uuid references public.ai_chats(id) on delete cascade,
 multi_chat_id uuid references public.multi_ai_chats(id) on delete cascade,
 request_id uuid not null, query text not null check(length(query) between 1 and 500),
 mode text not null check(mode in ('web','deep')), status text not null default 'queued' check(status in ('queued','running','ready','failed','cancelled','unknown')),
 phase text not null default 'plan', budget integer not null check(budget in (2,12)), spent integer not null default 0 check(spent>=0 and spent<=budget),
 work jsonb not null default '{}', analysis text not null default '', error text,
 lease_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(num_nonnulls(chat_id,multi_chat_id)=1), unique(user_id,request_id)
);
create index research_jobs_queue on public.research_jobs(status,created_at);
create table public.research_sources (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.research_jobs(id) on delete cascade,
 label text not null check(label ~ '^S[1-9][0-9]?$'),url text not null check(length(url)<=2048 and url like 'https://%'),title text not null,
 content text not null check(length(content)<=20000),published_at text,fetched_at timestamptz not null default now(),
 status text not null default 'extracted' check(status='extracted'),unique(job_id,url),unique(job_id,label)
);
create table public.research_events (
 id bigint generated always as identity primary key,job_id uuid not null references public.research_jobs(id) on delete cascade,
 message text not null check(length(message)<=500),created_at timestamptz not null default now()
);
create table public.research_calls (
 id uuid primary key default gen_random_uuid(),job_id uuid references public.research_jobs(id) on delete set null,
 user_id uuid not null,step_key text not null,reserved integer not null check(reserved between 0 and 12),actual numeric,
 status text not null default 'requested' check(status in ('requested','succeeded','failed','unknown')),
 created_at timestamptz not null default now(),finished_at timestamptz,result jsonb,usage jsonb,unique(job_id,step_key)
);
alter table public.research_jobs enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_events enable row level security;
alter table public.research_calls enable row level security;
create policy research_jobs_owner on public.research_jobs for select to authenticated using(user_id=auth.uid());
create policy research_sources_owner on public.research_sources for select to authenticated using(exists(select 1 from public.research_jobs j where j.id=job_id and j.user_id=auth.uid()));
create policy research_events_owner on public.research_events for select to authenticated using(exists(select 1 from public.research_jobs j where j.id=job_id and j.user_id=auth.uid()));
-- Ledger and writes are server-only. The browser cannot reserve/change credits or mark sources verified.
revoke all on public.research_jobs,public.research_sources,public.research_events,public.research_calls from anon,authenticated;
grant select on public.research_jobs,public.research_sources,public.research_events to authenticated;
grant all on public.research_jobs,public.research_sources,public.research_events,public.research_calls to service_role;
grant usage,select on sequence public.research_events_id_seq to service_role;

create function public.research_create(p_user uuid,p_chat uuid,p_kind text,p_request uuid,p_query text,p_mode text)
returns public.research_jobs language plpgsql security definer set search_path='' as $$
declare j public.research_jobs; b integer;
begin
 if p_mode not in ('web','deep') or p_kind not in ('chat','multi') or length(trim(p_query)) not between 1 and 500 then raise exception 'Invalid research request';end if;
 if (p_kind='chat' and not exists(select 1 from public.ai_chats where id=p_chat and user_id=p_user)) or
    (p_kind='multi' and not exists(select 1 from public.multi_ai_chats where id=p_chat and user_id=p_user)) then raise exception 'Conversation not owned';end if;
 perform pg_advisory_xact_lock(hashtextextended('research_global_monthly_budget',0));
 select * into j from public.research_jobs where user_id=p_user and request_id=p_request;
 if found then
  if j.query<>trim(p_query) or j.mode<>p_mode or coalesce(j.chat_id,j.multi_chat_id)<>p_chat then raise exception 'Request ID already used';end if;
  return j;
 end if;
 b:=case when p_mode='deep' then 12 else 2 end;
 if (select coalesce(sum(reserved),0) from public.research_calls where step_key='reservation' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')+b>800 then raise exception 'Monthly search budget exhausted';end if;
 if (select count(*) from public.research_calls where step_key='reservation' and user_id=p_user and created_at>now()-interval '1 day')>=20 or
    (p_mode='deep' and (select count(*) from public.research_calls where step_key='reservation' and reserved=12 and user_id=p_user and created_at>now()-interval '1 day')>=3) then raise exception 'Daily research limit exhausted';end if;
 if exists(select 1 from public.research_jobs where user_id=p_user and status in ('queued','running')) then raise exception 'Another research is running';end if;
 insert into public.research_jobs(user_id,chat_id,multi_chat_id,request_id,query,mode,budget)
 values(p_user,case when p_kind='chat' then p_chat end,case when p_kind='multi' then p_chat end,p_request,trim(p_query),p_mode,b) returning * into j;
 insert into public.research_calls(job_id,user_id,step_key,reserved,status,finished_at)values(j.id,p_user,'reservation',b,'succeeded',now());
 insert into public.research_events(job_id,message)values(j.id,'Задача создана; поисковый бюджет зарезервирован.');return j;
end $$;

create function public.research_claim(p_job uuid default null) returns public.research_jobs
language plpgsql security definer set search_path='' as $$
declare j public.research_jobs;
begin
 select * into j from public.research_jobs where (p_job is null or id=p_job) and status in ('queued','running')
  and (lease_until is null or lease_until<now()) order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 if exists(select 1 from public.research_calls where job_id=j.id and status='requested')then
  update public.research_jobs set status='unknown',error='Предыдущий платный шаг не завершился. Автоповтор отключён.',lease_until=null,updated_at=now() where id=j.id;
  update public.research_calls set status='unknown' where job_id=j.id and status='requested';return null;
 end if;
 update public.research_jobs set status='running',lease_until=now()+interval '120 seconds',updated_at=now() where id=j.id returning * into j;
 return j;
end $$;

create function public.research_begin_call(p_job uuid,p_step text,p_credits integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.research_jobs; result uuid;
begin
 select * into j from public.research_jobs where id=p_job for update;
 if not found or j.status<>'running' or j.lease_until<now() or p_credits not between 0 and 2 or j.spent+p_credits>j.budget then raise exception 'Research call denied or budget exhausted';end if;
 insert into public.research_calls(job_id,user_id,step_key,reserved)values(p_job,j.user_id,p_step,p_credits)returning id into result;
 update public.research_jobs set spent=spent+p_credits where id=p_job;return result;
end $$;

create function public.research_finish_step(p_job uuid,p_call uuid,p_work jsonb,p_phase text,p_message text,p_sources jsonb default '[]',p_analysis text default null,p_actual numeric default null)
returns void language plpgsql security definer set search_path='' as $$
declare j public.research_jobs;s jsonb;
begin
 select * into j from public.research_jobs where id=p_job for update;
 if not found or j.status<>'running' then raise exception 'Research is no longer running';end if;
 if p_call is not null then
  update public.research_calls set status='succeeded',finished_at=now(),actual=p_actual where id=p_call and job_id=p_job and status='requested';
  if not found then raise exception 'Call has already been settled';end if;
  if p_actual is not null and p_actual>(select reserved from public.research_calls where id=p_call) then
   update public.research_jobs set status='failed',error='Поисковый API превысил зарезервированную стоимость; новые вызовы остановлены.',lease_until=null where id=p_job;return;
  end if;
 end if;
 for s in select value from jsonb_array_elements(p_sources)loop
  insert into public.research_sources(job_id,label,url,title,content,published_at,fetched_at)
  values(p_job,s->>'label',s->>'url',s->>'title',s->>'content',s->>'published_at',(s->>'fetched_at')::timestamptz);
 end loop;
 update public.research_jobs set work=p_work,phase=p_phase,analysis=coalesce(p_analysis,analysis),
  status=case when p_phase='ready' then 'ready' else 'queued' end,lease_until=null,updated_at=now() where id=p_job;
 insert into public.research_events(job_id,message)values(p_job,left(p_message,500));
end $$;

revoke all on function public.research_create(uuid,uuid,text,uuid,text,text),public.research_claim(uuid),public.research_begin_call(uuid,text,integer),public.research_finish_step(uuid,uuid,jsonb,text,text,jsonb,text,numeric) from public,anon,authenticated;
grant execute on function public.research_create(uuid,uuid,text,uuid,text,text),public.research_claim(uuid),public.research_begin_call(uuid,text,integer),public.research_finish_step(uuid,uuid,jsonb,text,text,jsonb,text,numeric) to service_role;

create function public.research_answer_claim(p_job uuid,p_request uuid,p_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.research_jobs;c public.research_calls;k text;
begin
 select * into j from public.research_jobs where id=p_job for update;
 if not found or j.status<>'ready' or p_model not in ('chatgpt','deepseek','gemini') then raise exception 'Materials not ready';end if;
 k:='answer:'||p_model||':'||p_request::text;
 select * into c from public.research_calls where job_id=p_job and step_key=k;
 if found then return to_jsonb(c)||jsonb_build_object('claimed',false);end if;
 if (select count(*) from public.research_calls where job_id=p_job and step_key like 'answer:%')>=5 then raise exception 'Answer limit exhausted';end if;
 insert into public.research_calls(job_id,user_id,step_key,reserved)values(p_job,j.user_id,k,0)returning * into c;
 return to_jsonb(c)||jsonb_build_object('claimed',true);
end $$;
revoke all on function public.research_answer_claim(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.research_answer_claim(uuid,uuid,text)to service_role;

alter table public.ai_messages add column research_job_id uuid references public.research_jobs(id),add column citations jsonb not null default '[]';
alter table public.multi_ai_messages add column research_job_id uuid references public.research_jobs(id),add column citations jsonb not null default '[]';
create function public.check_message_research() returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
 if jsonb_typeof(new.citations)<>'array' or jsonb_array_length(new.citations)>60 then raise exception 'Invalid citations';end if;
 if new.research_job_id is null then
  if jsonb_array_length(new.citations)>0 then raise exception 'Citations need a research job';end if;
  return new;
 end if;
 if not exists(select 1 from public.research_jobs j where j.id=new.research_job_id and j.user_id=auth.uid() and
  ((tg_table_name='ai_messages' and j.chat_id=new.chat_id) or(tg_table_name='multi_ai_messages' and j.multi_chat_id=new.chat_id)))then raise exception 'Research outside this conversation';end if;
 for c in select value from jsonb_array_elements(new.citations)loop
  if not exists(select 1 from public.research_sources s where s.job_id=new.research_job_id and s.id::text=c->>'source_id' and s.url=c->>'url' and s.label=c->>'label')then raise exception 'Unknown citation source';end if;
 end loop;return new;
end $$;
revoke all on function public.check_message_research()from public;
create trigger ai_messages_research_guard before insert or update of research_job_id,citations,chat_id on public.ai_messages for each row execute function public.check_message_research();
create trigger multi_messages_research_guard before insert or update of research_job_id,citations,chat_id on public.multi_ai_messages for each row execute function public.check_message_research();
commit;
