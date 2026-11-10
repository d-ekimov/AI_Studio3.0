-- Live checks run in one subtransaction; all fixtures and reservations are rolled back.
do $test$
declare u uuid;c uuid;c2 uuid;j public.research_jobs;j2 public.research_jobs;req uuid:=gen_random_uuid();r uuid;a jsonb;b jsonb;reservation uuid;passed integer:=0;denied boolean;
begin
 begin
  select id into u from auth.users order by created_at limit 1;
  if u is null then raise exception 'An Auth account is required';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  insert into public.ai_chats(user_id,title,model)values(u,'Research access test','gemini')returning id into c;
  insert into public.ai_chats(user_id,title,model)values(u,'Research other-chat test','gemini')returning id into c2;
  j:=public.research_create(u,c,'chat',req,'Synthetic search','web');j2:=public.research_create(u,c,'chat',req,'Synthetic search','web');
  if j.id<>j2.id or(select count(*) from public.research_calls where job_id=j.id and step_key='reservation')<>1 then raise exception 'Idempotency failed';end if;passed:=passed+1;
  select id into reservation from public.research_calls where job_id=j.id and step_key='reservation';
  j:=public.research_claim(j.id);r:=public.research_begin_call(j.id,'search:0',1);
  perform public.research_finish_step(j.id,r,'{}','ready','Synthetic test complete',jsonb_build_array(jsonb_build_object('label','S1','url','https://example.org/article','title','Synthetic source','content','Synthetic evidence used only by the transaction-level access test.','fetched_at',now())),null,1);
  a:=public.research_answer_claim(j.id,req,'gemini');b:=public.research_answer_claim(j.id,req,'gemini');
  if not(a->>'claimed')::boolean or(b->>'claimed')::boolean or a->>'id'<>b->>'id' then raise exception 'Answer receipt failed';end if;passed:=passed+1;
  insert into public.ai_messages(chat_id,role,content,research_job_id)values(c,'user','Synthetic question',j.id);
  set local role authenticated;
  if not exists(select 1 from public.research_jobs where id=j.id) or not exists(select 1 from public.research_sources where job_id=j.id) or not exists(select 1 from public.research_events where job_id=j.id)then raise exception 'Owner read failed';end if;passed:=passed+1;
  denied:=false;begin perform public.research_begin_call(j.id,'forged',1);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Browser could spend credits';end if;passed:=passed+1;
  denied:=false;begin insert into public.research_jobs(user_id,chat_id,request_id,query,mode,budget)values(u,c,gen_random_uuid(),'forged','web',2);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Browser bypassed reservation';end if;passed:=passed+1;
  denied:=false;begin perform 1 from public.research_calls;exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Browser could read ledger';end if;passed:=passed+1;
  denied:=false;begin insert into public.ai_messages(chat_id,role,content,research_job_id)values(c2,'user','forged reference',j.id);exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Cross-chat reference accepted';end if;passed:=passed+1;
  reset role;
  perform set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',true);
  set local role authenticated;
  if exists(select 1 from public.research_jobs where id=j.id) or exists(select 1 from public.research_sources where job_id=j.id) or exists(select 1 from public.research_events where job_id=j.id)then raise exception 'Foreign owner isolation failed';end if;passed:=passed+1;
  reset role;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  delete from public.ai_chats where id=c;
  if not exists(select 1 from public.research_calls where id=reservation and job_id is null and reserved=2)then raise exception 'Deleting chat reset budget';end if;passed:=passed+1;
  raise exception using errcode='Z9001',message='Rollback synthetic fixtures';
 exception when sqlstate 'Z9001' then null;
 end;
 if passed<>9 then raise exception 'Expected nine successful checks';end if;
 raise notice 'Nine research access checks passed; all fixtures rolled back';
end $test$;
select '9 research access and budget checks passed; fixtures rolled back' as result;
