/* Research UI and source rendering. Only session JWTs reach Supabase; provider keys stay server-side. */
(() => {
 const enabled=new URLSearchParams(window.location.search||"").get("research_preview")==="1";
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const safeUrl=value=>{try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 function create(supabase){
  async function call(body){const {data,error}=await supabase.functions.invoke("research",{body});if(error){let message;try{message=(await error.context?.json())?.error;}catch{}throw new Error(message||"Сервис исследования недоступен.");}if(data?.error)throw new Error(data.error);return data;}
  function sourcesList(sources,container){
   container.replaceChildren();for(const source of sources||[]){const url=safeUrl(source.url);if(!url)continue;
    const row=document.createElement("div");row.className="research-source";const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=(source.label?"["+source.label+"] ":"")+source.title;
    const host=document.createElement("small");host.textContent=new URL(url).hostname+(source.fetched_at?" · получено "+new Date(source.fetched_at).toLocaleString():"");row.append(link,host);container.appendChild(row);
   }
  }
  function renderAnswer(answer,container){
   const citations=Array.isArray(answer.citations)?answer.citations:[];
   if(!citations.length)return;
   // Rebuild only the answer text. Filenames/attachments are rendered separately by the existing UI.
   const text=document.createElement("div");text.className="research-answer";
   const content=String(answer.content||"");let start=0;
   for(const match of content.matchAll(/\[(S\d+)\]/g)){
    text.append(document.createTextNode(content.slice(start,match.index)));const citation=citations.find(c=>c.label===match[1]),url=citation&&safeUrl(citation.url);
    if(url){const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=match[0];link.title=citation.title;text.appendChild(link);}else text.append(document.createTextNode(match[0]));start=match.index+match[0].length;
   }
   text.append(document.createTextNode(content.slice(start)));container.textContent="";container.appendChild(text);
   const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Источники и подтверждающие фрагменты";details.appendChild(summary);
   for(const citation of citations){const card=document.createElement("div");card.className="research-evidence";const list=document.createElement("div");sourcesList([citation],list);const quote=document.createElement("blockquote");quote.textContent=citation.quote;card.append(list,quote);details.appendChild(card);}
   container.appendChild(details);
  }
  function mount(form,prefix,kind){
   const toolbar=document.createElement("div");toolbar.className="research-toolbar";toolbar.hidden=!enabled;
   const label=document.createElement("label");label.textContent="Интернет ";const mode=document.createElement("select");mode.id=prefix+"ResearchMode";mode.setAttribute("aria-label","Интернет: "+(kind==="chat"?"чат":prefix==="compare"?"сравнение":"Мульти-ИИ"));
   for(const [value,text]of[["off","Выключен"],["web","Поиск"],["deep","Глубокое исследование"]]){const option=document.createElement("option");option.value=value;option.textContent=text;mode.appendChild(option);}label.appendChild(mode);
   const hint=document.createElement("small");hint.textContent="Поиск: до 2 кредитов · исследование: до 12. Ответы GenAPI оплачиваются отдельно.";
   const panel=document.createElement("div");panel.className="research-panel";panel.hidden=true;const status=document.createElement("div");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
   const cancel=document.createElement("button");cancel.type="button";cancel.className="outline-btn";cancel.textContent="Остановить поиск";cancel.hidden=true;
   const sources=document.createElement("div");sources.className="research-sources";panel.append(status,cancel,sources);toolbar.append(label,hint,panel);form.before(toolbar);
   let activeId=null,busy=false;
   cancel.addEventListener("click",async()=>{if(!activeId)return;cancel.disabled=true;try{await call({action:"cancel",id:activeId});}catch(error){status.textContent=error.message;}finally{cancel.disabled=false;}});
   async function monitor(id){
    activeId=id;panel.hidden=false;cancel.hidden=false;
    let steps=0;
    for(;;){
     const state=await call({action:"status",id});status.textContent=(state.events.at(-1)?.message||"Подготавливаем исследование…")+" · бюджет: "+state.spent+"/"+state.budget+" кредитов";
     sourcesList(state.sources,sources);
     if(state.status==="ready"){cancel.hidden=true;return id;}
     if(["failed","unknown","cancelled"].includes(state.status)){cancel.hidden=true;throw new Error(state.error||"Исследование остановлено.");}
     if(state.status==="queued")await call({action:"step",id});
     if(++steps>600){cancel.hidden=true;throw new Error("Исследование продолжается в фоне. Открой этот чат позже, чтобы продолжить получение ответа.");}
     await wait(2000);
    }
   }
   return {
    mode:()=>mode.value,
    lock(value){busy=value;mode.disabled=value;},
    async prepare({userId,chatId,messageId,prompt,onCreated}){
     if(mode.value==="off")return null;
     if(prompt.length>500)throw new Error("Для интернет-поиска сократи запрос до 500 символов; подробности можно оставить в истории или файле.");
     const key="aistudio:research:"+userId+":"+kind+":"+chatId+":"+messageId;
     let id;try{id=sessionStorage.getItem(key);}catch{}
     if(!id){const job=await call({action:"create",kind,chatId,requestId:messageId,query:prompt,mode:mode.value});id=job.id;try{sessionStorage.setItem(key,id);}catch{}}
     try{await onCreated(id);}catch(error){try{await call({action:"cancel",id});}catch{}throw error;}
     return await monitor(id);
    },
    async resume(id){return await monitor(id);},
    offerResume(id,callback){
     if(busy||!id)return;
     activeId=id;panel.hidden=false;cancel.hidden=true;status.textContent="В этом сообщении есть сохранённое исследование. Можно продолжить получение ответа без нового поиска.";sources.replaceChildren();
     const resume=document.createElement("button"),retry=document.createElement("button");
     for(const button of[resume,retry]){button.type="button";button.className="outline-btn";}
     resume.textContent="Продолжить получение ответа";
     retry.textContent="Новый платный ответ GenAPI — без повторного поиска";
     for(const [button,newAnswer]of[[resume,false],[retry,true]])button.addEventListener("click",async()=>{resume.disabled=true;retry.disabled=true;try{await callback(id,newAnswer);}catch(error){status.textContent=error.message;resume.disabled=false;retry.disabled=false;}});
     const warning=document.createElement("small");warning.textContent="Продолжение использует прежнюю квитанцию. Новый ответ оплачивается отдельно; запускай его после завершения или ошибки предыдущей генерации.";
     sources.append(resume,retry,warning);
    },
    clear(){if(!busy){activeId=null;panel.hidden=true;sources.replaceChildren();}},
   };
  }
  return {mount,renderAnswer,call,sourcesList};
 }
 window.AIStudioResearch={create};
})();
