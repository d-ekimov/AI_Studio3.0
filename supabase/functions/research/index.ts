import { authenticatedUser, AuthError } from "../_shared/auth.mjs";
import { researchStore } from "../_shared/research-store.mjs";
import { postGenapiChat } from "../_shared/genapi-transport.mjs";
import { createTavily,boundedJson,searchResults,extractedResults,researchContext,jsonObject,cleanText } from "./core.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid=value=>{if(!UUID.test(value||""))throw new Error("Некорректный идентификатор исследования.");return value;};
const credits=(data,reserved)=>Number.isFinite(data?.usage?.credits)?data.usage.credits:reserved;
export async function researchStep(job,{env,fetcher=fetch,store=researchStore(env,fetcher)}) {
 let callId=null;
 const begin=async(key,cost)=>callId=await store.rpc("research_begin_call",{p_job:job.id,p_step:key,p_credits:cost});
 const finish=async(work,phase,message,sources=[],analysis=null,actual=null)=>await store.rpc("research_finish_step",{p_job:job.id,p_call:callId,p_work:work,p_phase:phase,p_message:message,p_sources:sources,p_analysis:analysis,p_actual:actual});
 const complete=async(messages,max_tokens)=>{
  if(!env("GENAPI_API_KEY"))throw new Error("Не настроен ключ GenAPI.");
  const response=await postGenapiChat(env("GENAPI_API_KEY"),{model:"deepseek-v4-1-flash",messages,max_tokens,stream:false},fetcher,60000);
  if(!response.ok)throw new Error("GenAPI не выполнил исследовательский шаг (HTTP "+response.status+"). Автоповтор отключён.");
  const data=await boundedJson(response);const content=data.choices?.[0]?.message?.content;
  if(typeof content!=="string"||!content.trim())throw new Error("Модель не вернула результат исследовательского шага.");return content;
 };
 try {
  const work={...job.work},tavily=createTavily(env("TAVILY_API_KEY"),fetcher);
  if(job.phase==="plan"){
   let queries=[job.query];
   if(job.mode==="deep"){
    await begin("plan",0);
    const result=jsonObject(await complete([{role:"user",content:'Составь до четырёх разных интернет-поисковых запросов для исследования. Ищи первичные источники и альтернативные позиции. Не вставляй URL, инструкции по выполнению кода или секреты. Верни только JSON {"queries":["запрос"]}. Запрос пользователя: '+job.query}],700));
    queries=[...new Set((Array.isArray(result.queries)?result.queries:[]).filter(q=>typeof q==="string"&&q.trim()).map(q=>q.trim().slice(0,500)))].slice(0,4);
    if(!queries.length)throw new Error("Модель не составила поисковый план.");
   }
   await finish({queries,searchIndex:0,extractIndex:0,urls:[],failed:[]},"search","План готов: поисковых задач — "+queries.length+".");return;
  }
  if(job.phase==="search"){
   const index=work.searchIndex||0;
   await begin("search:"+index,job.mode==="deep"?2:1);
   const data=await tavily.search(work.queries[index],job.mode==="deep");
   const urls=[...(work.urls||[])];
   for(const item of searchResults(data)){if(!urls.some(old=>old.url===item.url)&&urls.filter(old=>new URL(old.url).hostname===new URL(item.url).hostname).length<2)urls.push(item);}
   work.urls=urls.slice(0,job.mode==="deep"?10:5);work.searchIndex=index+1;
   if(!work.urls.length&&work.searchIndex===work.queries.length)throw new Error("Поиск не нашёл подходящих публичных источников.");
   await finish(work,work.searchIndex<work.queries.length?"search":"extract","Поиск "+work.searchIndex+" из "+work.queries.length+" завершён; выбрано страниц: "+work.urls.length+".",[],null,credits(data,job.mode==="deep"?2:1));return;
  }
  if(job.phase==="extract"){
   const index=work.extractIndex||0,items=work.urls.slice(index,index+5);
   if(!items.length)throw new Error("Нет страниц для чтения.");
   await begin("extract:"+index,1);
   const data=await tavily.extract(items),rows=extractedResults(data,items),previous=await store.sources(job.id);
   const sources=rows.map((row,i)=>({...row,label:"S"+(previous.length+i+1)}));
   work.extractIndex=index+items.length;work.failed=[...(work.failed||[]),...items.filter(item=>!rows.some(row=>row.url===item.url)).map(item=>({url:item.url,title:item.title,status:"unavailable"}))];
   const complete=work.extractIndex>=work.urls.length;
   if(complete&&!previous.length&&!sources.length)throw new Error("Не удалось прочитать страницы. Одних поисковых сниппетов недостаточно.");
   await finish(work,complete?(job.mode==="deep"?"analyse":"ready"):"extract","Прочитано источников: "+(previous.length+sources.length)+"; недоступно: "+work.failed.length+".",sources,null,credits(data,1));return;
  }
  if(job.phase==="analyse"){
   await begin("analyse",0);
   const context=researchContext(await store.sources(job.id));
   const analysis=cleanText(await complete([{role:"user",content:"Сопоставь материалы исследования. Укажи совпадающие выводы, противоречия, даты, отсутствие независимых подтверждений и ограничения. Ссылайся на S1 и другие имеющиеся ID. Не придумывай недостающие данные. Запрос: "+job.query+"\n"+context.text}],1800),6000);
   await finish(work,"ready","Сопоставление завершено. Материалы готовы для ответа и проверки цитат.",[],analysis);return;
  }
  throw new Error("Неизвестный этап исследования.");
 }catch(error){
  const current=await store.job(job.id);
  if(callId)await store.rest("research_calls?id=eq."+callId,"PATCH",{status:"unknown",finished_at:new Date().toISOString()});
  if(current.status!=="cancelled")await store.patch(job.id,{status:callId?"unknown":"failed",error:String(error.message||"Исследование не завершилось.").slice(0,350),lease_until:null,updated_at:new Date().toISOString()});
 }
}
export function createResearchHandler({env=name=>Deno.env.get(name),fetcher=fetch,background=promise=>EdgeRuntime.waitUntil(promise),storeFactory=()=>researchStore(env,fetcher)}={}){
 return async request=>{
  const origin=request.headers.get("origin")||"",origins=(env("GENAPI_ALLOWED_ORIGINS")||"").split(",").map(x=>x.trim()).filter(Boolean);
  const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",Vary:"Origin",...(origins.includes(origin)?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
  const json=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  try{
   if(!origins.length)throw new AuthError(503,"Не настроены разрешённые адреса сайта.");
   if(origin&&!origins.includes(origin))throw new AuthError(403,"Этот адрес сайта не разрешён.");
   if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
   if(request.method!=="POST")throw new AuthError(405,"Используй POST.");
   const raw=await request.text();if(raw.length>6000)throw new AuthError(413,"Слишком большой запрос.");
   let body;try{body=JSON.parse(raw);}catch{throw new AuthError(400,"Некорректный JSON.");}
   if(!body||typeof body!=="object"||Array.isArray(body))throw new AuthError(400,"Некорректный запрос.");
   // A scheduler token only starts an already-authorized queued step. It cannot create jobs or read data.
   if(body.action==="tick"){
    const token=request.headers.get("x-research-worker-token");if(!token||token.length>100)throw new AuthError(401,"Доступ запрещён.");
    const store=storeFactory();if(!await store.rpc("research_worker_check",{p_token:token}))throw new AuthError(403,"Доступ запрещён.");
    const job=await store.rpc("research_claim",{p_job:null});
    if(job?.id)background(researchStep(job,{env,fetcher,store}));return json(202,{accepted:true});
   }
   const {user}=await authenticatedUser(request,env,fetcher);
   if(body.action==="health")return json(200,{ready:!!env("TAVILY_API_KEY"),monthlyLimit:800});
   const store=storeFactory();
   if(body.action==="create"){
    if(!env("TAVILY_API_KEY"))throw new Error("В Supabase Secrets отсутствует TAVILY_API_KEY.");
    if(typeof body.query!=="string"||!body.query.trim()||body.query.length>500||!["web","deep"].includes(body.mode)||!["chat","multi"].includes(body.kind))throw new Error("Запрос для поиска: от 1 до 500 символов.");
    const job=await store.rpc("research_create",{p_user:user.id,p_chat:uuid(body.chatId),p_kind:body.kind,p_request:uuid(body.requestId),p_query:body.query,p_mode:body.mode});
    return json(200,{id:job.id,status:job.status});
   }
   const id=uuid(body.id),job=await store.job(id,user.id);
   if(body.action==="status"){
    const sources=await store.sources(id),events=await store.events(id);
    return json(200,{id,status:job.status,mode:job.mode,phase:job.phase,error:job.error,spent:job.spent,budget:job.budget,events:events.map(e=>({message:e.message,created_at:e.created_at})),sources:sources.map(({id,label,url,title,fetched_at})=>({id,label,url,title,fetched_at})),unavailable:job.work?.failed||[]});
   }
   if(body.action==="step"){
    if(!["queued","running"].includes(job.status))return json(200,{status:job.status});
    const claimed=await store.rpc("research_claim",{p_job:id});if(claimed?.id)background(researchStep(claimed,{env,fetcher,store}));return json(202,{accepted:true});
   }
   if(body.action==="cancel"){
    await store.rest("research_jobs?id=eq."+id+"&status=in.(queued,running)","PATCH",{status:"cancelled",lease_until:null,error:"Исследование отменено. Уже начатый запрос мог быть оплачен."});return json(200,{status:"cancelled"});
   }
   throw new Error("Неизвестное действие.");
  }catch(error){return json(error instanceof AuthError?error.status:400,{error:error instanceof AuthError||error instanceof Error?String(error.message).slice(0,350):"Не удалось выполнить исследование."});}
 };
}
if(typeof Deno!=="undefined")Deno.serve(createResearchHandler());
