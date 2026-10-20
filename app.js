(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const pageNames = {chat:"Чат", compare:"Несколько ИИ", projects:"Проекты", tasks:"Задачи", models:"Модели"};
  const defaultTasks = [
    {id:1,title:"Продумать структуру AI Studio",desc:"Определить основные разделы и переходы",done:true,tag:"Планирование"},
    {id:2,title:"Собрать адаптивный интерфейс",desc:"Проверить отображение на телефоне и компьютере",done:false,tag:"Дизайн"},
    {id:3,title:"Добавить историю чатов",desc:"Сохранение тестовых сообщений в браузере",done:false,tag:"Функции"},
    {id:4,title:"Подготовить подключение API",desc:"Сделать отдельный серверный этап позже",done:false,tag:"В планах"}
  ];
  const read = (key, fallback) => { try { const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  let chats = read("aistudio_chats", []);
  let activeChatId = null;
  let tasks = read("aistudio_tasks", defaultTasks);
  let projects = read("aistudio_projects", [
    {name:"AI Studio",desc:"Единое пространство для работы с несколькими ИИ.",state:"В работе",icon:"⌘",color:"purple-bg",tasks:2},
    {name:"Фриланс-портфолио",desc:"Сайт, примеры работ и первые заказы.",state:"Идея",icon:"▣",color:"blue-bg",tasks:3}
  ]);
  let toastTimer;
  const toast = (msg) => { const el=$("#toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600); };
  const go = (page) => {
    if (!pageNames[page]) return;
    $$(".page").forEach(el=>el.classList.toggle("active-page",el.id===`page-${page}`));
    $$(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
    $("#pageCrumb").textContent=pageNames[page];
    $("#sidebar").classList.remove("sidebar-open");
    window.scrollTo({top:0,behavior:"smooth"});
  };
  $$("[data-page]").forEach(btn=>btn.addEventListener("click",()=>go(btn.dataset.page)));
  $("#menuToggle").addEventListener("click",()=>$("#sidebar").classList.toggle("sidebar-open"));
  document.addEventListener("click",e=>{if(window.innerWidth<=760 && $("#sidebar").classList.contains("sidebar-open") && !$("#sidebar").contains(e.target) && !$("#menuToggle").contains(e.target))$("#sidebar").classList.remove("sidebar-open");});
  const currentChat = () => chats.find(c=>c.id===activeChatId);
  const modelName = () => ({chatgpt:"ChatGPT · Demo",deepseek:"DeepSeek · Demo",future:"Будущая модель · Demo"}[$("#modelSelect").value] || "ChatGPT · Demo");
  const renderHistory = () => {
    const list=$("#historyList"); list.innerHTML="";
    chats.slice().reverse().slice(0,12).forEach(c=>{
      const b=document.createElement("button"); b.className="history-item"+(c.id===activeChatId?" selected":""); b.innerHTML="<span>◌</span><em></em>"; $("em",b).textContent=c.title;
      b.addEventListener("click",()=>{activeChatId=c.id;renderChat();renderHistory();go("chat");}); list.appendChild(b);
    });
    if(!chats.length){const p=document.createElement("div");p.style.cssText="color:#686b7e;font-size:11px;padding:8px 10px";p.textContent="Твои чаты появятся здесь";list.appendChild(p);}
  };
  const renderChat = () => {
    const c=currentChat(); const box=$("#messages");box.innerHTML="";
    $("#welcomeCard").style.display=c&&c.messages.length?"none":"flex";
    $("#suggestions").style.display=c&&c.messages.length?"none":"grid";
    if(c) c.messages.forEach(m=>{
      const row=document.createElement("div");row.className="message "+(m.role==="user"?"user":"assistant");
      const av=document.createElement("div");av.className="message-avatar";av.textContent=m.role==="user"?"D":"✳";
      const content=document.createElement("div");content.className="message-content";content.textContent=m.text;
      if(m.role!=="user"){const small=document.createElement("small");small.textContent=m.model||modelName();content.appendChild(small);}
      row.append(av,content);box.appendChild(row);
    });
    box.scrollTop=box.scrollHeight;
  };
  const persistChats=()=>{save("aistudio_chats",chats);renderHistory();};
  const newChat=()=>{activeChatId=null;renderChat();renderHistory();go("chat");$("#messageInput").focus();};
  $("#newChat").addEventListener("click",newChat);
  $("#modelSelect").addEventListener("change",()=>{const val=$("#modelSelect").value;$("#activeModelName").textContent=modelName();$(".provider-icon.openai",$("#page-chat")).textContent=val==="deepseek"?"◈":val==="future"?"✧":"✳";toast("Выбрана модель: "+modelName());});
  const demoAnswer=(prompt,model)=>{
    const p=prompt.toLowerCase();
    const intro=model==="deepseek"?"Давай разложим запрос по шагам.":"Хорошая отправная точка! Предлагаю двигаться постепенно.";
    if(p.includes("сайт")||p.includes("сайта"))return intro+"\n\n1. Определим цель и аудиторию.\n2. Соберём структуру страниц и переходов.\n3. Подготовим адаптивный дизайн.\n4. Проверим все кнопки и состояния.\n5. После проверки подключим нужные сервисы.\n\nЭто демонстрационный ответ. После подключения API здесь будет отвечать выбранная модель.";
    if(p.includes("задач")||p.includes("цель"))return intro+"\n\n• Сформулируй конечный результат.\n• Разбей его на небольшие шаги.\n• Выбери одну задачу на сегодня.\n• После выполнения проверь результат и обнови план.\n\nВ настоящем режиме мы сможем адаптировать план под твой проект.";
    if(p.includes("текст")||p.includes("напис"))return intro+"\n\nСначала уточним, для кого текст и какого результата хотим добиться. Затем подготовим черновик, проверим тон и ясность, а в конце сделаем финальную редактуру.\n\nПришли тему и желаемый стиль — продолжим.";
    if(p.includes("иде"))return intro+"\n\nМожно начать с трёх вариантов: простой продукт для быстрого запуска, инструмент для конкретной аудитории или сервис, который автоматизирует повторяющуюся задачу. Для выбора сравним пользу, сложность реализации и время на первый прототип.";
    return intro+"\n\nЯ бы предложил сначала уточнить желаемый результат, затем выделить главные ограничения и составить короткий план. После этого можно переходить к конкретным действиям.\n\nНапоминание: сейчас это демонстрационный ответ, а не ответ настоящей языковой модели.";
  };
  const sendMessage=(text)=>{
    text=(text||"").trim();if(!text)return;
    if(!activeChatId){activeChatId="c"+Date.now();chats.push({id:activeChatId,title:text.length>34?text.slice(0,34)+"…":text,messages:[]});}
    const c=currentChat();c.messages.push({role:"user",text});
    const selected=$("#modelSelect").value;c.messages.push({role:"assistant",text:demoAnswer(text,selected),model:modelName()});
    persistChats();renderChat();$("#messageInput").value="";$("#messageInput").style.height="auto";
  };
  $("#chatForm").addEventListener("submit",e=>{e.preventDefault();sendMessage($("#messageInput").value);});
  $("#messageInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(e.target.value);}});
  $$(".suggestion").forEach(b=>b.addEventListener("click",()=>sendMessage(b.dataset.prompt)));
  $("#attachButton").addEventListener("click",()=>toast("Загрузка файлов появится после следующего этапа разработки."));
  $("#clearHistory").addEventListener("click",()=>{
    const clear=()=>{chats=[];activeChatId=null;persistChats();renderChat();toast("История чатов очищена.");};
    if($("#confirmClear").checked)openDialog("Очистить историю?","Все локальные тестовые чаты будут удалены из этого браузера.","Очистить",clear);else clear();
  });
  const compareReply=(p,model)=>model==="ChatGPT"?"Подход: начать с пользователя и простоты.\n\n1. Выделить главную ценность.\n2. Предложить ясный и запоминающийся вариант.\n3. Проверить, легко ли объяснить идею одной фразой.\n\nПример: «Одно пространство. Все твои ИИ.»":"Подход: сначала задать критерии и сравнить варианты.\n\n1. Определить аудиторию и задачу.\n2. Создать 3–5 вариантов.\n3. Оценить понятность, отличие и масштабируемость.\n\nЗапрос: «"+p.slice(0,100)+"»\n\nЭто пример структуры ответа, не реальный ответ DeepSeek.";
  $("#compareRun").addEventListener("click",()=>{
    const p=$("#comparePrompt").value.trim();if(!p){toast("Сначала напиши запрос для сравнения.");$("#comparePrompt").focus();return;}
    const cards=$$(".compare-card");cards.forEach((card,i)=>{const model=i===0?"ChatGPT":"DeepSeek";const answer=$(".compare-answer",card);answer.classList.remove("muted-answer");answer.textContent=compareReply(p,model);});toast("Демонстрационные ответы готовы.");
  });
  const renderProjects=()=>{
    const grid=$("#projectGrid");grid.innerHTML="";
    projects.forEach((p,i)=>{const card=document.createElement("article");card.className="project-card";card.innerHTML=`<div class="project-icon ${p.color||"purple-bg"}">${p.icon||"✧"}</div><span class="project-state ${p.state==="Идея"?"quiet-state":""}">${p.state||"В работе"}</span><h3></h3><p></p><div class="project-meta"><span>◷ Локально</span><span>${Number(p.tasks)||0} задач</span></div><button class="text-action">Открыть проект <span>→</span></button>`;$("h3",card).textContent=p.name;$("p",card).textContent=p.desc;$(".text-action",card).addEventListener("click",()=>openDialog(p.name,"Проект создан в прототипе. Позже здесь появятся связанные чаты, файлы и задачи.","Понятно",()=>{}));grid.appendChild(card);});
    const add=document.createElement("button");add.className="add-project-card";add.innerHTML="<span>＋</span><strong>Создать проект</strong><small>Начни с чистого листа</small>";add.addEventListener("click",createProject);grid.appendChild(add);
  };
  function createProject(){
    openDialog("Новый проект","Дай проекту название и коротко опиши цель.","Создать",()=>{
      const name=$("#fieldName")?.value.trim();const desc=$("#fieldDesc")?.value.trim();
      if(!name){toast("Укажи название проекта.");return false;}
      projects.push({name,desc:desc||"Новый проект без описания.",state:"В работе",icon:"✧",color:"purple-bg",tasks:0});save("aistudio_projects",projects);renderProjects();toast("Проект создан.");return true;
    },[{id:"fieldName",label:"Название проекта",placeholder:"Например, мой первый сайт"},{id:"fieldDesc",label:"Описание",placeholder:"Чего хочешь добиться?"}]);
  }
  $("#addProject").addEventListener("click",createProject);$("#addProjectCard").addEventListener("click",createProject);
  const renderTasks=()=>{
    const list=$("#taskList");list.innerHTML="";const filter=$("#taskFilter").value;
    tasks.filter(t=>filter==="all"||(filter==="done"?t.done:!t.done)).forEach(t=>{
      const row=document.createElement("div");row.className="task-row"+(t.done?" completed":"");
      const check=document.createElement("input");check.type="checkbox";check.className="task-check";check.checked=t.done;check.setAttribute("aria-label","Отметить задачу выполненной");check.addEventListener("change",()=>{t.done=check.checked;save("aistudio_tasks",tasks);renderTasks();});
      const copy=document.createElement("div");copy.className="task-copy";const title=document.createElement("strong");title.textContent=t.title;const desc=document.createElement("p");desc.textContent=t.desc;copy.append(title,desc);
      const tag=document.createElement("span");tag.className="task-tag"+(t.done?" done-tag":"");tag.textContent=t.done?"Готово":t.tag;
      row.append(check,copy,tag);list.appendChild(row);
    });
    const done=tasks.filter(t=>t.done).length;$("#taskTotal").textContent=tasks.length;$("#taskActive").textContent=tasks.length-done;$("#taskDone").textContent=done;const percent=tasks.length?Math.round(done/tasks.length*100):0;$("#taskProgress").textContent=percent+"%";$("#taskProgressBar").style.width=percent+"%";
    if(!list.children.length){const p=document.createElement("p");p.style.color="var(--muted)";p.textContent="В этой категории пока нет задач.";list.appendChild(p);}
  };
  $("#taskFilter").addEventListener("change",renderTasks);
  $("#addTask").addEventListener("click",()=>openDialog("Новая задача","Добавь небольшой следующий шаг.","Добавить",()=>{
    const title=$("#fieldName")?.value.trim();const desc=$("#fieldDesc")?.value.trim();if(!title){toast("Укажи название задачи.");return false;}tasks.push({id:Date.now(),title,desc:desc||"Без описания",done:false,tag:"Новая"});save("aistudio_tasks",tasks);renderTasks();toast("Задача добавлена.");return true;
  },[{id:"fieldName",label:"Название задачи",placeholder:"Что нужно сделать?"},{id:"fieldDesc",label:"Описание",placeholder:"Необязательно"}]));
  function openDialog(title,text,confirmLabel,onConfirm,fields=[]){
    const d=$("#appDialog");$("#dialogTitle").textContent=title;$("#dialogText").textContent=text;$("#dialogConfirm").textContent=confirmLabel;const box=$("#dialogFields");box.innerHTML="";
    fields.forEach(f=>{const wrap=document.createElement("div");wrap.className="dialog-field";const label=document.createElement("label");label.textContent=f.label;label.htmlFor=f.id;const input=document.createElement(f.multiline?"textarea":"input");input.id=f.id;input.placeholder=f.placeholder||"";if(f.multiline)input.rows=3;wrap.append(label,input);box.appendChild(wrap);});
    $("#dialogConfirm").onclick=(e)=>{e.preventDefault();const result=onConfirm?.();if(result!==false)d.close();};
    d.showModal();setTimeout(()=>fields.length&&$("#"+fields[0].id)?.focus(),50);
  }
  $$(".provider-detail").forEach(b=>b.addEventListener("click",()=>openDialog(b.dataset.provider,"Подключение пока не включено. Следующим этапом добавим сервер, безопасное хранение ключей и реальные ответы. API оплачивается отдельно от подписки на чат-сервис.","Понятно",()=>{})));
  $("#futureProvider").addEventListener("click",()=>toast("Новые провайдеры добавим отдельными модулями."));
  $("#themeToggle").addEventListener("click",()=>{document.body.classList.toggle("light-theme");save("aistudio_light",document.body.classList.contains("light-theme"));});
  if(read("aistudio_light",false))document.body.classList.add("light-theme");
  $("#compactToggle").addEventListener("change",e=>{document.body.classList.toggle("compact-mode",e.target.checked);save("aistudio_compact",e.target.checked);});
  $("#confirmClear").addEventListener("change",e=>save("aistudio_confirm_clear",e.target.checked));
  $("#compactToggle").checked=read("aistudio_compact",false);document.body.classList.toggle("compact-mode",$("#compactToggle").checked);
  $("#confirmClear").checked=read("aistudio_confirm_clear",true);
  $("#helpButton").addEventListener("click",()=>openDialog("Как пользоваться AI Studio","Это первая версия интерфейса. Работают вкладки, демонстрационный чат, сравнение ответов, проекты, задачи, переключение темы и локальное сохранение. Настоящие ответы ИИ, файлы и синхронизация между устройствами будут добавлены позже.","Понятно",()=>{}));
  $("#feedbackButton").addEventListener("click",()=>openDialog("Твоя заметка","Запиши идею или недостающую функцию — пока заметка никуда не отправляется.","Сохранить локально",()=>{
    const text=$("#fieldNote")?.value.trim();if(!text){toast("Напиши заметку.");return false;}const notes=read("aistudio_notes",[]);notes.push({text,date:new Date().toLocaleString("ru-RU")});save("aistudio_notes",notes);toast("Заметка сохранена в этом браузере.");return true;
  },[{id:"fieldNote",label:"Что стоит улучшить?",placeholder:"Хочу добавить…",multiline:true}]));
  $("#profileButton").addEventListener("click",()=>toast("Профиль пока локальный — авторизацию добавим позже."));
  document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();newChat();}});
  renderHistory();renderChat();renderProjects();renderTasks();
})();
