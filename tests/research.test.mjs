import test from "node:test";
import assert from "node:assert/strict";
import { publicUrl,boundedJson,createTavily,searchResults,extractedResults,researchContext,checkCitedAnswer } from "../supabase/functions/research/core.mjs";
import { createResearchHandler,researchStep } from "../supabase/functions/research/index.ts";
import { groundedChat } from "../supabase/functions/_shared/grounded-chat.mjs";
const userId="11111111-1111-4111-8111-111111111111",jobId="22222222-2222-4222-8222-222222222222";
const envValues={SUPABASE_URL:"https://project.supabase.co",SUPABASE_ANON_KEY:"public",SUPABASE_SERVICE_ROLE_KEY:"fake-server-role",GENAPI_API_KEY:"fake-genapi",TAVILY_API_KEY:"fake-search-key",GENAPI_ALLOWED_USER_IDS:userId,GENAPI_ALLOWED_ORIGINS:"https://studio.example"};
const env=name=>envValues[name];
const json=data=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});
const passage="Supabase Edge Functions have a maximum memory allowance of 256 MB. Limits depend on the chosen plan.";
test("research blocks local, encoded-IP, credential and non-HTTPS targets",()=>{
 for(const url of["http://example.com","https://127.0.0.1/","https://2130706433/","https://0x7f000001/","https://[::1]/","https://metadata.internal/","https://10.0.0.1/","file:///etc/passwd","https://a:b@example.com/","https://example.com:444/"])assert.throws(()=>publicUrl(url),url);
 assert.equal(publicUrl("https://supabase.com/docs?utm_source=a&section=limits#part"),"https://supabase.com/docs?section=limits");
});
test("research search adapter uses fixed API endpoints and never places keys in body or URL",async()=>{
 const calls=[];const tavily=createTavily("fake-search-key",async(url,init)=>{calls.push({url,init});return json({results:[]});});
 await tavily.search("test",true);await tavily.extract([{url:"https://supabase.com/docs"}]);
 assert.equal(calls[0].url,"https://api.tavily.com/search");assert.equal(calls[1].url,"https://api.tavily.com/extract");
 assert.equal(JSON.parse(calls[0].init.body).auto_parameters,false);assert.equal(JSON.parse(calls[0].init.body).search_depth,"advanced");
 for(const call of calls){assert.ok(!call.url.includes("fake-search-key"));assert.ok(!call.init.body.includes("fake-search-key"));assert.equal(call.init.redirect,"error");}
 await assert.rejects(()=>tavily.extract([{url:"https://localhost/"}]));
});
test("HTTP 200 with partial/empty extractions never verifies unavailable pages",()=>{
 const items=searchResults({results:[{url:"https://supabase.com/docs",title:"Limits"},{url:"https://127.0.0.1/"},{url:"https://supabase.com/docs#duplicate"},{url:"https://example.com/news",title:"News"}]});
 assert.equal(items.length,2);
 const sources=extractedResults({results:[{url:items[0].url,raw_content:passage},{url:"https://unrequested.example.com/",raw_content:passage}],failed_results:[{url:items[1].url}]},items);
 assert.equal(sources.length,1);assert.equal(sources[0].status,"extracted");
 assert.throws(()=>researchContext(extractedResults({results:[]},items)),/содержимое/);
});
test("bounded extraction stops oversized streams and hides provider error bodies",async()=>{
 await assert.rejects(()=>boundedJson(new Response('x'.repeat(100)),20),/слишком большой/);
 await assert.rejects(()=>boundedJson(new Response('fake-secret-debug',{status:500})),error=>!error.message.includes("fake-secret-debug"));
});
test("cited answers reject invented IDs and quotes absent from the actual extracted text",()=>{
 const sources=[{id:"S1",text:passage}];
 for(const evidence of[[{source_id:"S99",quote:passage}],[{source_id:"S1",quote:"Invented quotation about unlimited memory."}]])assert.throws(()=>checkCitedAnswer(JSON.stringify({sections:[{claims:[{text:"Claim",evidence}]}]}),sources),/проверку цитат/);
 const answer=checkCitedAnswer(JSON.stringify({sections:[{heading:"Limits",claims:[{text:"Memory is capped. https://invented.example/ [S99]",evidence:[{source_id:"S1",quote:"maximum memory allowance of 256 MB"}]}]}]}),sources);
 assert.equal(answer.claims.length,1);assert.ok(!answer.claims[0].text.includes("invented.example"));assert.ok(!answer.claims[0].text.includes("S99"));
});
test("only extracted content enters a bounded research context",()=>{
 const context=researchContext(Array.from({length:10},(_,i)=>({label:"S"+(i+1),url:"https://example.com/"+i,title:"Source",content:"a".repeat(20000),status:"extracted"})));
 assert.equal(context.selected.length,10);assert.equal(context.selected.reduce((sum,s)=>sum+s.text.length,0),40000);
});
test("research health verifies user allowlist and origin without spending search credits",async()=>{
 let calls=0;const handler=createResearchHandler({env,fetcher:async url=>{calls++;assert.ok(url.endsWith("/auth/v1/user"));return json({id:userId});},background:()=>{},storeFactory:()=>{throw new Error("Health must not open the database");}});
 const request=(headers={})=>new Request("https://project.supabase.co/functions/v1/research",{method:"POST",headers:{authorization:"Bearer user-session",origin:"https://studio.example",...headers},body:'{"action":"health"}'});
 assert.equal((await handler(request({origin:"https://evil.example"}))).status,403);assert.equal(calls,0);
 const result=await handler(request());assert.equal(result.status,200);assert.equal((await result.json()).monthlyLimit,800);assert.equal(calls,1);
 const denied=createResearchHandler({env:name=>name==="GENAPI_ALLOWED_USER_IDS"?"different":env(name),fetcher:async()=>json({id:userId})});assert.equal((await denied(request())).status,403);
});
test("an unauthenticated scheduler tick cannot create jobs or retrieve materials",async()=>{
 const handler=createResearchHandler({env,background:()=>{},storeFactory:()=>({rpc:async(name)=>{assert.equal(name,"research_worker_check");return false;}})});
 const response=await handler(new Request("https://project.supabase.co/functions/v1/research",{method:"POST",headers:{"x-research-worker-token":"forged"},body:'{"action":"tick"}'}));assert.equal(response.status,403);
});
test("ordinary search advances through one search and one extraction with unique receipts",async()=>{
 const job={id:jobId,user_id:userId,query:"Supabase limits",mode:"web",phase:"plan",work:{},status:"running"},sources=[],receipts=[],events=[];
 const store={async rpc(name,args){if(name==="research_begin_call"){receipts.push([args.p_step,args.p_credits]);return String(receipts.length);}if(name==="research_finish_step"){job.work=args.p_work;job.phase=args.p_phase;sources.push(...args.p_sources);events.push(args.p_message);return;}throw new Error(name);},sources:async()=>sources,job:async()=>job,patch:async(_,data)=>Object.assign(job,data),rest:async()=>{}};
 const fetcher=async url=>url.endsWith("/search")?json({results:[{url:"https://supabase.com/docs",title:"Limits"}],usage:{credits:1}}):json({results:[{url:"https://supabase.com/docs",raw_content:passage}],usage:{credits:1}});
 for(let i=0;i<3;i++)await researchStep(job,{env,fetcher,store});
 assert.equal(job.phase,"ready");assert.deepEqual(receipts,[["search:0",1],["extract:0",1]]);assert.equal(sources.length,1);assert.equal(sources[0].label,"S1");assert.equal(events.length,3);
});
test("search timeout records an uncertain paid step without automatic provider retry",async()=>{
 let paid=0;const patches=[];const job={id:jobId,user_id:userId,query:"test",mode:"web",phase:"search",work:{queries:["test"],searchIndex:0,urls:[]},status:"running"};
 const store={rpc:async()=>"receipt",job:async()=>job,patch:async(_,data)=>patches.push(data),rest:async()=>{}};
 await researchStep(job,{env,fetcher:async()=>{paid++;throw new Error("timeout-with-private-details");},store});assert.equal(paid,1);assert.equal(patches[0].status,"unknown");assert.ok(!patches[0].error.includes("private-details"));
});

test("Deep Research plans separate searches, reads both batches and compares the shared evidence",async()=>{
 const job={id:jobId,user_id:userId,query:"Compare sources and contradictions",mode:"deep",phase:"plan",work:{},status:"running"};const sources=[],receipts=[];let searches=0,models=0;
 const store={async rpc(name,args){if(name==="research_begin_call"){receipts.push([args.p_step,args.p_credits]);return String(receipts.length);}if(name==="research_finish_step"){job.work=args.p_work;job.phase=args.p_phase;sources.push(...args.p_sources);if(args.p_analysis)job.analysis=args.p_analysis;return;}throw new Error(name);},sources:async()=>sources,job:async()=>job,patch:async(_,data)=>Object.assign(job,data),rest:async()=>{}};
 const fetcher=async(url,init)=>{
  if(url.includes("proxy.gen-api.ru")){models++;return json({choices:[{message:{content:models===1?'{"queries":["primary sources","recent changes","independent comparison","contradictions"]}':"Sources S1 and S6 disagree; dates must be compared."}}]});}
  if(url.endsWith("/search")){const n=searches++;return json({results:Array.from({length:3},(_,i)=>({url:`https://source${n*3+i}.example.com/page`,title:"Source"})),usage:{credits:2}});}
  const body=JSON.parse(init.body);return json({results:body.urls.map(url=>({url,raw_content:passage})),usage:{credits:1}});
 };
 for(let i=0;i<8;i++)await researchStep(job,{env,fetcher,store});
 assert.equal(job.phase,"ready");assert.equal(searches,4);assert.equal(models,2);assert.equal(sources.length,10);assert.equal(receipts.reduce((sum,r)=>sum+r[1],0),10);assert.match(job.analysis,/disagree/);
});

test("grounded answer removes claims rejected by verification and uses only stored source URLs",async()=>{
 let providerCalls=0;const receipts=[];
 const fetcher=async(url,init)=>{
  if(url.includes("research_jobs?"))return json([{id:jobId,user_id:userId,status:"ready",mode:"web",analysis:""}]);
  if(url.includes("rpc/research_answer_claim"))return json({id:"receipt",claimed:true,status:"requested"});
  if(url.includes("research_sources?"))return json([{id:"stored-source",label:"S1",url:"https://supabase.com/docs",title:"Limits",status:"extracted",content:passage}]);
  if(url.includes("research_calls?")){receipts.push(JSON.parse(init.body));return json([]);}throw new Error(url);
 };
 const provider=async payload=>{providerCalls++;assert.equal(payload.messages[0].role,"system");return {usage:{prompt_tokens:100,completion_tokens:50},choices:[{message:{content:providerCalls===1?JSON.stringify({sections:[{heading:"Memory",claims:[{text:"Memory limit is 256 MB.",evidence:[{source_id:"S1",quote:"maximum memory allowance of 256 MB"}]},{text:"Memory is unlimited.",evidence:[{source_id:"S1",quote:"maximum memory allowance of 256 MB"}]}]}]}):'{"supported":[true,false]}'}}]};};
 const result=await groundedChat({body:{model:"gemini",researchId:jobId,answerRequestId:userId},user:{id:userId},env,fetcher,provider,messages:[{role:"user",content:"memory?"}]});
 assert.equal(providerCalls,2);assert.match(result.content,/256 MB/);assert.ok(!result.content.includes("unlimited"));assert.equal(result.citations[0].url,"https://supabase.com/docs");assert.equal(receipts[0].status,"succeeded");
});

test("a completed research answer is replayed from its receipt without another paid call",async()=>{
 const result={content:"Saved answer",citations:[]};const fetcher=async url=>url.includes("research_jobs?")?json([{id:jobId,status:"ready"}]):json({claimed:false,status:"succeeded",result});
 const actual=await groundedChat({body:{model:"chatgpt",researchId:jobId,answerRequestId:userId},user:{id:userId},env,fetcher,provider:()=>{throw new Error("Must not charge twice");},messages:[]});assert.deepEqual(actual,result);
});

test("another user's research cannot reach GenAPI",async()=>{
 let paid=0;await assert.rejects(()=>groundedChat({body:{model:"chatgpt",researchId:jobId,answerRequestId:userId},user:{id:userId},env,fetcher:async url=>{assert.ok(url.includes("&user_id=eq."+userId));return json([]);},provider:()=>{paid++;},messages:[]}),/недоступно/);assert.equal(paid,0);
});
