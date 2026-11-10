-- Synthetic fixtures only. Everything, including reservations, is rolled back.
begin;
create temporary table research_test_results(test text,passed boolean);
grant all on research_test_results to authenticated,anon;
do $$
declare u uuid;c uuid;c2 uuid;j public.research_jobs;j2 public.research_jobs;req uuid:=gen_random_uuid();r uuid;a jsonb;b jsonb;
begin
 select id into u from auth.users order by created_at limit 1;
 if u is null then raise exception 'A real Auth account is needed for fixture ownership';end if;
 perform set_config('research_test.owner',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.ai_chats(user_id,title,model)values(u,'Research RLS fixture','gemini')returning id into c;
 insert into public.ai_chats(user_id,title,model)values(u,'Research other-chat fixture','gemini')returning id into c2;
 perform set_config('research_test.chat',c::text,true);perform set_config('research_test.other_chat',c2::text,true);
 j:=public.research_create(u,c,'chat',req,'Synthetic search','web');
 j2:=public.research_create(u,c,'chat',req,'Synthetic search','web');
 insert into research_test_results values('create is idempotent',j.id=j2.id and(select count(*) from public.research_calls where job_id=j.id and step_key='reservation')=1);
 perform set_config('research_test.job',j.id::text,true);
 perform set_config('research_test.reservation',(select id::text from public.research_calls where job_id=j.id and step_key='reservation'),true);
 j:=public.research_claim(j.id);r:=public.research_begin_call(j.id,'search:0',1);
 perform public.research_finish_step(j.id,r,'{}','ready','Synthetic test complete',jsonb_build_array(jsonb_build_object('label','S1','url','https://example.org/article','title','Synthetic source','content','Synthetic evidence is only for the transaction-level access test.','fetched_at',now())),null,1);
 a:=public.research_answer_claim(j.id,req,'gemini');b:=public.research_answer_claim(j.id,req,'gemini');
 insert into research_test_results values('answer receipt prevents repeated claim',(a->>'claimed')::boolean and not(b->>'claimed')::boolean and a->>'id'=b->>'id');
 insert into public.ai_messages(chat_id,role,content,research_job_id)values(c,'user','Synthetic question',j.id);
end $$;
set local role authenticated;
insert into research_test_results select 'owner can read materials',
 exists(select 1 from public.research_jobs where id=current_setting('research_test.job')::uuid) and
 exists(select 1 from public.research_sources where job_id=current_setting('research_test.job')::uuid) and
 exists(select 1 from public.research_events where job_id=current_setting('research_test.job')::uuid);
do $$begin
 begin perform public.research_begin_call(current_setting('research_test.job')::uuid,'forged',1);
 exception when insufficient_privilege then insert into research_test_results values('browser cannot invoke spending RPC',true);end;
 if not exists(select 1 from research_test_results where test='browser cannot invoke spending RPC')then raise exception 'Spending RPC was accessible';end if;
 begin insert into public.research_jobs(user_id,chat_id,request_id,query,mode,budget)values(auth.uid(),current_setting('research_test.chat')::uuid,gen_random_uuid(),'forged','web',2);
 exception when insufficient_privilege then insert into research_test_results values('browser cannot bypass job reservation',true);end;
 if not exists(select 1 from research_test_results where test='browser cannot bypass job reservation')then raise exception 'Direct job insertion was accessible';end if;
 begin perform 1 from public.research_calls;
 exception when insufficient_privilege then insert into research_test_results values('ledger is server-only',true);end;
 if not exists(select 1 from research_test_results where test='ledger is server-only')then raise exception 'Ledger was readable';end if;
 begin insert into public.ai_messages(chat_id,role,content,research_job_id)values(current_setting('research_test.other_chat')::uuid,'user','forged reference',current_setting('research_test.job')::uuid);
 exception when raise_exception then insert into research_test_results values('cross-chat research reference denied',true);end;
 if not exists(select 1 from research_test_results where test='cross-chat research reference denied')then raise exception 'Cross-chat research reference was accepted';end if;
end $$;
reset role;
do $$begin perform set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',true);end $$;
set local role authenticated;
insert into research_test_results select 'another user cannot read jobs or evidence',
 not exists(select 1 from public.research_jobs where id=current_setting('research_test.job')::uuid) and
 not exists(select 1 from public.research_sources where job_id=current_setting('research_test.job')::uuid) and
 not exists(select 1 from public.research_events where job_id=current_setting('research_test.job')::uuid);
reset role;
do $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('research_test.owner'),'role','authenticated')::text,true);
 delete from public.ai_chats where id=current_setting('research_test.chat')::uuid;
 insert into research_test_results select 'deleting chat keeps monthly reservation',exists(select 1 from public.research_calls where id=current_setting('research_test.reservation')::uuid and job_id is null and reserved=2);
 if exists(select 1 from research_test_results where not passed)then raise exception 'Research access test failed';end if;
end $$;
select * from research_test_results order by test;
rollback;
