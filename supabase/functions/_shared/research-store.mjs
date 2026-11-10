import { boundedJson } from "../research/core.mjs";
export function researchStore(env,fetcher=fetch) {
 const url=env("SUPABASE_URL"),key=env("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)throw new Error("Не настроено серверное окружение Supabase.");
 async function rest(path,method="GET",body) {
  const response=await fetcher(url+"/rest/v1/"+path,{method,headers:{apikey:key,authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"return=representation"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000),redirect:"error"});
  if(!response.ok){let message="";try{message=String((await response.json()).message||"");}catch{}
   const hint=message.includes("Monthly search budget")?"Месячный поисковый лимит исчерпан.":message.includes("Daily research limit")?"Дневной лимит исследований исчерпан.":message.includes("Another research")?"Дождись завершения другого исследования.":message.includes("Request ID already")?"Этот идентификатор запроса уже использован.":"Не удалось сохранить исследование. Проверь миграцию и права Supabase.";
   throw new Error(hint);
  }
  if(response.status===204)return null;
  return await boundedJson(response,4*1024*1024);
 }
 return {rest,rpc:(name,body)=>rest("rpc/"+name,"POST",body),
  async job(id,userId){const rows=await rest("research_jobs?id=eq."+id+(userId?"&user_id=eq."+userId:"")+"&limit=1");if(!rows[0])throw new Error("Исследование недоступно.");return rows[0];},
  sources:id=>rest("research_sources?job_id=eq."+id+"&order=label"),
  events:id=>rest("research_events?job_id=eq."+id+"&order=id&limit=100"),
  patch:(id,body)=>rest("research_jobs?id=eq."+id,"PATCH",body),
 };
}
