(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
    const SUPABASE_URL = "https://zzjfceazpjpavnyyigek.supabase.co";
  const SUPABASE_KEY = "sb_publishable_uZhcc1D66aEzG5xqoe1jcg_Ts7NZI3V";

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );
  window.aiStudioSupabase = supabase;
  const genapi = window.AIStudioGenAPI.create(supabase);
  const modelLabels = window.AIStudioGenAPI.names;
  const workflows = window.AIStudioWorkflows;
  const attachmentsUI = window.AIStudioAttachments.create(supabase);
  const mountFiles = (prefix, button) => attachmentsUI.mount({ button: $(button), input: $("#" + prefix + "FileInput"), preview: $("#" + prefix + "Attachments"), status: $("#" + prefix + "AttachmentStatus") });
  const chatFiles = mountFiles("chat", "#attachButton");
  const compareFiles = mountFiles("compare", "#compareAttachButton");
  const multiFiles = mountFiles("multi", "#multiAttachButton");
  const researchUI = window.AIStudioResearch?.create(supabase);
  const noResearch = {mode:()=>"off",lock(){},clear(){},prepare:async()=>null,offerResume(){},resume:async id=>id};
  const chatResearch = researchUI?.mount($("#chatForm"),"chat","chat") || noResearch;
  const compareResearch = researchUI?.mount($("#comparePrompt").closest(".compare-input"),"compare","multi") || noResearch;
  const multiResearch = researchUI?.mount($("#multiChatForm"),"multi","multi") || noResearch;
  let chatSending = false;
  const pageNames = {chat:"Чат", compare:"Несколько ИИ", multi:"Мульти-ИИ", projects:"Проекты", tasks:"Задачи", models:"Модели"};
    const read = (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  };

  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };

  let chats = [];
  let activeChatId = null;
  let currentUser = null;

  // Проекты и задачи загружаются из Supabase
  let tasks = [];
  let projects = [];

  let toastTimer;
  const toast = (msg) => { const el=$("#toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600); };
  
function renderSidebarProfile(user) {
  const button = document.querySelector("#profileButton");
  if (!button || !user) return;

  let savedProfile = {};
  try {
    savedProfile = JSON.parse(
      localStorage.getItem("aiStudioProfile") || "{}"
    );
  } catch {}

  const metadata = user.user_metadata || {};

  const name =
    metadata.profile_name ||
    metadata.full_name ||
    metadata.name ||
    savedProfile.name ||
    user.email?.split("@")[0] ||
    "Пользователь";

  const avatarUrl =
    metadata.profile_avatar_url ||
    metadata.avatar_url ||
    metadata.picture ||
    savedProfile.avatar ||
    "";

  const avatar = button.querySelector(".avatar");
  const nameElement = button.querySelector(".profile-copy strong");
  const planElement = button.querySelector(".profile-copy small");

  nameElement.textContent = name;
  planElement.textContent = "Free · Без подписки";

  avatar.replaceChildren();

  if (
    typeof avatarUrl === "string" &&
    (avatarUrl.startsWith("https://") ||
     avatarUrl.startsWith("data:image/"))
  ) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = "Фото профиля";
    avatar.appendChild(img);
  } else {
    avatar.textContent = name.trim().charAt(0).toLocaleUpperCase("ru-RU") || "U";
  }
}
  
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
    const modelName = () => modelLabels[$("#modelSelect").value] || "Выбери модель";
    const renderHistory = () => {
    const list = $("#historyList");
    list.innerHTML = "";

    chats.slice(0, 12).forEach(c => {
      const row = document.createElement("div");
      row.className = "history-row";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className =
        "history-item" + (c.id === activeChatId ? " selected" : "");
      openButton.innerHTML = "<span>◌</span><em></em>";
      $("em", openButton).textContent = c.title || "Новый чат";

      openButton.addEventListener("click", () => {
        if (chatSending) { toast("Дождись ответа."); return; }
        chatResearch.clear();
        activeChatId = c.id;
        renderChat();
        renderHistory();
        go("chat");
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-history-chat";
      deleteButton.textContent = "×";
      deleteButton.title = "Удалить чат";
      deleteButton.setAttribute("aria-label", "Удалить чат");

      deleteButton.addEventListener("click", async () => {
        if (multiSending || multiOpening || chatSending) { toast("Дождись завершения ответов."); return; }
        const confirmed = confirm(
          `Удалить чат «${c.title || "Новый чат"}»?\n\nЭто действие нельзя отменить.`
        );

        if (!confirmed) return;

        try { await attachmentsUI.removeChatFiles(currentUser.id, "chat", c.id); }
        catch (error) { toast(error.message); return; }

        const { error } = await supabase
          .from("ai_chats")
          .delete()
          .eq("id", c.id)
          .eq("user_id", currentUser.id);

        if (error) {
          console.error("Ошибка удаления чата:", error);
          toast("Не удалось удалить чат.");
          return;
        }

        chats = chats.filter(chat => chat.id !== c.id);

        if (activeChatId === c.id) {
          activeChatId = null;
          renderChat();
        }

        renderHistory();
        toast("Чат удалён.");
      });

      row.appendChild(openButton);
      row.appendChild(deleteButton);
      list.appendChild(row);
    });

    if (!chats.length) {
      const p = document.createElement("div");
      p.style.cssText =
        "color:#686b7e;font-size:11px;padding:8px 10px";
      p.textContent = "Твои чаты появятся здесь";
      list.appendChild(p);
    }
  };
  const renderChat = () => {
    const c=currentChat(); const box=$("#messages");box.innerHTML="";
    $("#welcomeCard").style.display=c&&c.messages.length?"none":"flex";
    $("#suggestions").style.display=c&&c.messages.length?"none":"grid";
    if(c) c.messages.forEach(m=>{
      const row=document.createElement("div");row.className="message "+(m.role==="user"?"user":"assistant");
      const av=document.createElement("div");av.className="message-avatar";av.textContent=m.role==="user"?"D":"✳";
      const content=document.createElement("div");
content.className="message-content";
content.textContent=m.content ?? m.text ?? "";
      researchUI?.renderAnswer(m,content);
      if(m.role!=="user"){const small=document.createElement("small");small.textContent=m.model||modelName();content.appendChild(small);}
      attachmentsUI.renderSaved(m.attachments, content);
      row.append(av,content);box.appendChild(row);
    });
    box.scrollTop=box.scrollHeight;
    const pending = c?.messages.findLast(m=>m.role==="user"&&m.research_job_id);
    if(pending&&!c.messages.some(m=>m.role==="assistant"&&m.research_job_id===pending.research_job_id))chatResearch.offerResume(pending.research_job_id,()=>resumeChatResearch(c,pending));
  };
  const persistChats=()=>{renderHistory();};
const newChat=()=>{if(chatSending){toast("Дождись ответа.");return;}chatResearch.clear();activeChatId=null;renderChat();renderHistory();go("chat");$("#messageInput").focus();};
  $("#newChat").addEventListener("click",newChat);
  $("#modelSelect").addEventListener("change", () => {
  const val = $("#modelSelect").value;
  $("#activeModelName").textContent = modelName();

  const icon = $(".model-select-wrap .provider-icon", $("#page-chat"));

  if (val === "deepseek") {
    icon.innerHTML = '<img src="./images/logos/deepseek.jpeg" alt="DeepSeek">';
    icon.classList.remove("openai");
    icon.classList.add("deepseek");
} else if (val === "gemini") {
  icon.innerHTML = '<img src="./images/logos/gemini.png" alt="Google Gemini">';
  icon.classList.remove("deepseek");
  icon.classList.add("openai");
  } else if (val === "future") {
    icon.textContent = "✧";
    icon.classList.remove("deepseek");
    icon.classList.add("openai");
  } else {
    icon.innerHTML = '<img src="./images/logos/gpt.jpeg" alt="ChatGPT">';
    icon.classList.remove("deepseek");
    icon.classList.add("openai");
  }

  toast("Выбрана модель: " + modelName());
});
  async function finishChatAnswer(c,selected,researchId,answerRequestId){
    const reply=await genapi.chat(selected,c.messages,{researchId,answerRequestId});
    const saved={id:crypto.randomUUID(),role:"assistant",content:reply.content,...(researchId?{research_job_id:researchId,citations:reply.citations||[]}:{} )};
    c.messages.push({...saved,model:modelLabels[selected]});if(activeChatId===c.id)renderChat();
    const {error:messageError}=await supabase.from("ai_messages").insert({chat_id:c.id,...saved});
    if(messageError)throw new Error("Ответ получен, но история не сохранена. Скопируй ответ; повторная отправка создаст новый платный запрос.");
    c.model=selected;const {error}=await supabase.from("ai_chats").update({updated_at:new Date().toISOString(),model:selected}).eq("id",c.id).eq("user_id",currentUser.id);
    if(error)toast("Сообщения сохранены, но дата чата не обновлена.");persistChats();
  }
  async function resumeChatResearch(c,message){
    if(chatSending)return;chatSending=true;chatResearch.lock(true);chatFiles.lock(true);
    const button=$("#chatForm button[type='submit']"),input=$("#messageInput");button.disabled=true;input.disabled=true;
    try{await chatResearch.resume(message.research_job_id);await finishChatAnswer(c,c.model||$("#modelSelect").value,message.research_job_id,message.id);}
    catch(error){toast(error.message);}finally{chatSending=false;chatResearch.lock(false);chatFiles.lock(false);button.disabled=false;input.disabled=false;renderChat();}
  }
  const sendMessage = async (text) => {
    text = (text || "").trim();
    const requestedFiles = chatFiles.count() > 0;
    if ((!text && !chatFiles.count()) || chatSending) return;
    if (!text) text = "Проанализируй прикреплённые файлы.";
    if (text.length > 12000) { toast("Сообщение слишком длинное: максимум 12000 символов."); return; }
    if(chatResearch.mode()!=="off"&&text.length>500){toast("Для интернет-поиска сократи запрос до 500 символов.");return;}
    if (!currentUser) { toast("Войди в аккаунт."); window.location.href = "auth.html"; return; }
    const selected = $("#modelSelect").value;
    const button = $("#chatForm button[type='submit']");
    const input = $("#messageInput");
    chatSending = true; button.disabled = true; input.disabled = true;
    chatFiles.lock(true);
    chatResearch.lock(true);
    try {
      await chatFiles.ready();
      if (requestedFiles && !chatFiles.count()) throw new Error("Не удалось подготовить вложения. Выбери файлы снова.");
      let c = currentChat();
      const context = [...(c?.messages || []), { role: "user", content: text }];
      window.AIStudioGenAPI.context(context);
      if (!c) {
        const { data, error } = await supabase.from("ai_chats")
          .insert({ user_id: currentUser.id, title: text.slice(0, 34), model: selected }).select().single();
        if (error) throw new Error("Не удалось создать чат.");
        c = { ...data, messages: [] }; chats.unshift(c); activeChatId = c.id; renderHistory();
      }
      const files = await chatFiles.upload(currentUser.id, "chat", c.id);
      const userMessage = { id:crypto.randomUUID(),role: "user", content: text, ...(files.length ? { attachments: files } : {}) };
      context[context.length - 1] = userMessage;
      const { error: userMessageError } = await supabase.from("ai_messages").insert({ chat_id: c.id, ...userMessage });
      if (userMessageError) throw new Error("Не удалось сохранить сообщение с вложениями. Генерация не запускалась.");
      c.messages.push(userMessage); chatFiles.clear(); renderChat();
      if(chatResearch.mode()!=="off"){
        c.model=selected;const {error}=await supabase.from("ai_chats").update({model:selected}).eq("id",c.id).eq("user_id",currentUser.id);
        if(error)throw new Error("Не удалось сохранить модель для восстановления исследования.");
      }
      input.value = "";
      const researchId=await chatResearch.prepare({userId:currentUser.id,chatId:c.id,messageId:userMessage.id,prompt:text,onCreated:async id=>{const {error}=await supabase.from("ai_messages").update({research_job_id:id}).eq("id",userMessage.id).eq("chat_id",c.id);if(error)throw new Error("Не удалось связать исследование с сообщением.");userMessage.research_job_id=id;}});
      await finishChatAnswer(c,selected,researchId,userMessage.id);
      input.value = ""; input.style.height = "auto";
    } catch (error) { toast(error.message || "Не удалось получить ответ GenAPI."); }
    finally { chatSending = false; chatFiles.lock(false); chatResearch.lock(false); button.disabled = false; input.disabled = false; input.focus();renderChat(); }
  };
  $("#chatForm").addEventListener("submit",e=>{e.preventDefault();sendMessage($("#messageInput").value);});
  $("#messageInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(e.target.value);}});
  $$(".suggestion").forEach(b=>b.addEventListener("click",()=>sendMessage(b.dataset.prompt)));
  $("#clearHistory").addEventListener("click", () => {
  const clear = async () => {
    if (chatSending) { toast("Дождись ответа."); return; }
    if (!currentUser) {
      toast("Сначала войди в аккаунт.");
      return;
    }

    try { await attachmentsUI.removeAllChatFiles(currentUser.id, "chat", "ai_chats"); }
    catch (error) { toast(error.message); return; }

    const { error } = await supabase
      .from("ai_chats")
      .delete()
      .eq("user_id", currentUser.id);

    if (error) {
      console.error("Ошибка очистки истории:", error);
      toast("Не удалось очистить историю.");
      return;
    }

    chats = [];
    activeChatId = null;

    persistChats();
    renderChat();
    toast("История чатов очищена.");
  };

  if ($("#confirmClear").checked) {
    openDialog(
      "Очистить историю?",
      "Все твои чаты будут удалены из аккаунта.",
      "Очистить",
      clear
    );
  } else {
    clear();
  }
});
  let comparison = null;
  let comparisonDraftId = null;
  let compareBusy = false;
  const compareControls = () => [$("#compareRun"), $("#comparePrompt"), $("#compareModel1"), $("#compareModel2")];
  function updateCompareModel(slot) {
    const model = $("#compareModel" + slot).value;
    const icon = $("#compareIcon" + slot);
    icon.className = "provider-icon " + (model === "deepseek" ? "deepseek" : model === "gemini" ? "gemini" : "openai");
    const img = document.createElement("img");
    img.src = { chatgpt: "./images/logos/gpt.jpeg", deepseek: "./images/logos/deepseek.jpeg", gemini: "./images/logos/gemini.png" }[model];
    img.alt = modelLabels[model]; icon.replaceChildren(img);
  }
  function resetComparison() {
    compareResearch.clear();
    comparison = null;
    for (const slot of [1, 2]) {
      $("#compareAnswer" + slot).textContent = "Ответ появится после отправки запроса.";
      $("#compareState" + slot).textContent = "Готов к запуску";
      $("#compareCopy" + slot).disabled = true;
      $("#compareRetry" + slot).hidden = true;
    }
    $("#compareStatus").textContent = "Два независимых ответа на один запрос. Каждый запуск оплачивается отдельно.";
  }
  async function compareSlot(slot, round) {
    const model = round.models[slot - 1];
    const state = $("#compareState" + slot);
    const answer = $("#compareAnswer" + slot);
    const started = Date.now();
    state.textContent = modelLabels[model] + " · Получаем ответ…";
    answer.classList.remove("muted-answer"); answer.textContent = "Ожидаем ответ GenAPI…";
    round.results[slot] = { status: "running" };
    try {
      const result = await genapi.chat(model, [{ role: "user", content: round.prompt, ...(round.attachments?.length ? { attachments: round.attachments } : {}) }],{researchId:round.researchId,answerRequestId:round.answerIds?.[slot]||round.messageId});
      round.results[slot] = { status: "success", content: result.content };
      answer.textContent = result.content;
      researchUI?.renderAnswer(result,answer);
      state.textContent = modelLabels[model] + " · Готово за " + Math.ceil((Date.now() - started) / 1000) + " с";
      if (round.chatId) {
        try {
          const { error } = await supabase.from("multi_ai_messages").insert({ chat_id: round.chatId, role: "assistant", model_key: model, speaker: modelLabels[model], content: result.content,...(round.researchId?{research_job_id:round.researchId,citations:result.citations||[]}:{} ) });
          if (error) throw error;
        } catch { round.results[slot].unsaved = true; state.textContent += " · Ответ не сохранён, скопируй его"; }
      }
    } catch (error) {
      round.results[slot] = { status: "error" };
      answer.textContent = error.message || "Не удалось получить ответ.";
      state.textContent = modelLabels[model] + " · Ошибка";
    }
  }
  async function executeComparison(round, slots) {
    compareBusy = true;
    compareFiles.lock(true);
    compareResearch.lock(true);
    compareControls().forEach(control => { control.disabled = true; });
    for (const slot of [1, 2]) { $("#compareCopy" + slot).disabled = true; $("#compareRetry" + slot).hidden = true; }
    $("#compareStatus").textContent = "Выполняем " + slots.length + " " + (slots.length === 1 ? "запрос" : "запроса") + " GenAPI…";
    try { await Promise.all(slots.map(slot => compareSlot(slot, round))); }
    finally {
      compareBusy = false; compareControls().forEach(control => { control.disabled = false; });
      compareFiles.lock(false);
      compareResearch.lock(false);
      const success = [1, 2].filter(slot => round.results[slot]?.status === "success").length;
      $("#compareStatus").textContent = "Готово ответов: " + success + " из 2. " + (round.chatId ? "Диалог с файлами доступен в истории Мульти-ИИ." : "Результаты доступны до перезагрузки страницы.");
      for (const slot of [1, 2]) {
        $("#compareCopy" + slot).disabled = round.results[slot]?.status !== "success";
        $("#compareRetry" + slot).hidden = round.results[slot]?.status !== "error";
      }
    }
  }
  for (const slot of [1, 2]) {
    $("#compareModel" + slot).addEventListener("change", () => { if (!compareBusy) { resetComparison(); updateCompareModel(slot); } });
    $("#compareCopy" + slot).addEventListener("click", async () => {
      const content = comparison?.results[slot]?.content;
      if (!content) return;
      try { await navigator.clipboard.writeText(content); toast("Ответ скопирован."); }
      catch { toast("Выдели ответ и скопируй вручную."); }
    });
    $("#compareRetry" + slot).addEventListener("click", async () => {
      if (compareBusy || !comparison || comparison.results[slot]?.status !== "error") return;
      if(comparison.researchId){comparison.answerIds||={};comparison.answerIds[slot]=crypto.randomUUID();}
      await executeComparison(comparison, [slot]);
    });
    updateCompareModel(slot);
  }
  $("#compareRun").addEventListener("click", async () => {
    if (compareBusy) return;
    if (!currentUser) { toast("Сначала войди в аккаунт."); return; }
    try {
      const prompt = workflows.validatePrompt($("#comparePrompt").value.trim() || (compareFiles.count() ? "Проанализируй прикреплённые файлы." : ""));
      if(compareResearch.mode()!=="off"&&prompt.length>500)throw new Error("Для интернет-поиска сократи запрос до 500 символов.");
      const models = [$("#compareModel1").value, $("#compareModel2").value];
      if (models[0] === models[1]) { toast("Выбери две разные модели для сравнения."); return; }
      comparison = { prompt, models, results: {}, attachments: [],messageId:crypto.randomUUID() };
      const requestedCompareFiles=compareFiles.count()>0;
      if (requestedCompareFiles || compareResearch.mode()!=="off") {
        compareBusy = true; compareFiles.lock(true); compareControls().forEach(control => { control.disabled = true; });
        compareResearch.lock(true);
        try {
          await compareFiles.ready();
          if (requestedCompareFiles&&!compareFiles.count()) throw new Error("Не удалось подготовить вложения. Выбери файлы снова.");
          if (!comparisonDraftId) {
            const { data, error } = await supabase.from("multi_ai_chats").insert({ user_id: currentUser.id, title: "Сравнение: " + prompt.slice(0, 32), selected_models: models, sequential_mode: false }).select("id").single();
            if (error) throw new Error("Не удалось создать диалог для файлов.");
            comparisonDraftId = data.id;
          }
          comparison.chatId = comparisonDraftId;
          comparison.attachments = await compareFiles.upload(currentUser.id, "multi", comparisonDraftId);
          const { error: saveError } = await supabase.from("multi_ai_messages").insert({ id:comparison.messageId,chat_id: comparisonDraftId, role: "user", speaker: "Ты", content: prompt, attachments: comparison.attachments });
          if (saveError) throw new Error("Не удалось сохранить файлы в истории. Генерации не запускались.");
          compareFiles.clear();
          comparison.researchId=await compareResearch.prepare({userId:currentUser.id,chatId:comparison.chatId,messageId:comparison.messageId,prompt,onCreated:async id=>{const {error}=await supabase.from("multi_ai_messages").update({research_job_id:id}).eq("id",comparison.messageId).eq("chat_id",comparison.chatId);if(error)throw new Error("Не удалось сохранить связь исследования.");}});
          comparisonDraftId = null;
          await loadMultiChatList();
        } finally { compareBusy = false; compareFiles.lock(false); compareResearch.lock(false); compareControls().forEach(control => { control.disabled = false; }); }
      }
      await executeComparison(comparison, [1, 2]);
    } catch (error) { toast(error.message); }
  });

  // ===== МУЛЬТИ-ИИ: ОБЩИЙ ДИАЛОГ С СОХРАНЕНИЕМ =====

  let currentMultiChatId = null;

  let multiSending = false;
  let multiOpening = false;
  const multiHistoryCache = new Map();

  function addMultiMessage(speaker, content, role = "assistant", files = [], metadata = {}) {
    const box = $("#multiMessages");
    const welcome = $(".multi-welcome", box);

    if (welcome) welcome.remove();

    const row = document.createElement("div");
    row.className = "multi-message-row " + role;

    const name = document.createElement("strong");
    name.className = "multi-message-speaker";
    name.textContent = speaker;

    const text = document.createElement("div");
    text.className = "multi-message-content";
    text.textContent = content;
    researchUI?.renderAnswer({...metadata,content},text);
    attachmentsUI.renderSaved(files, text);

    row.append(name, text);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    if (role === "assistant") {
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "text-action"; copy.textContent = "Скопировать ответ";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text.textContent); toast("Ответ скопирован."); }
        catch { toast("Выдели ответ и скопируй вручную."); }
      });
      row.appendChild(copy);
    }
    return row;
  }

  // Сохраняем одно сообщение в Supabase
  async function saveMultiMessage(chatId, role, speaker, content, modelKey = null, files = [], metadata = {}) {
    const { error } = await supabase
      .from("multi_ai_messages")
      .insert({
        chat_id: chatId,
        role: role,
        model_key: modelKey,
        speaker: speaker,
        content: content,
        ...(files.length ? { attachments: files } : {}),...metadata
      });

    if (error) {
      console.error("Ошибка сохранения сообщения Мульти-ИИ:", error);
      throw error;
    }
  }

  // Создаём диалог при первом сообщении
  async function createMultiChat(prompt, models, sequential) {
    if (!currentUser) {
      throw new Error("Пользователь не авторизован.");
    }

    const title = prompt.length > 40
      ? prompt.slice(0, 40) + "…"
      : prompt;

    const { data, error } = await supabase
      .from("multi_ai_chats")
      .insert({
        user_id: currentUser.id,
        title: title,
        selected_models: models,
        sequential_mode: sequential
      })
      .select("id")
      .single();

    if (error) {
      console.error("Ошибка создания диалога Мульти-ИИ:", error);
      throw error;
    }

    currentMultiChatId = data.id;
    multiHistoryCache.set(data.id, []);
    return data.id;
  }

  // Обновляем настройки и дату диалога
  async function updateMultiChat(models, sequential) {
    if (!currentMultiChatId) return;

    const { error } = await supabase
      .from("multi_ai_chats")
      .update({
        selected_models: models,
        sequential_mode: sequential,
        updated_at: new Date().toISOString()
      })
      .eq("id", currentMultiChatId)
      .eq("user_id", currentUser.id);

    if (error) {
      console.error("Ошибка обновления диалога Мульти-ИИ:", error);
      throw error;
    }
  }

    // Загружаем список диалогов Мульти-ИИ
  async function loadMultiChatList() {
    if (!currentUser) return;

    const list = $("#multiChatList");

    const { data: chats, error } = await supabase
      .from("multi_ai_chats")
      .select("id, title, updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Ошибка загрузки списка Мульти-ИИ:", error);
      list.textContent = "Не удалось загрузить диалоги.";
      return;
    }

    list.innerHTML = "";

    if (!chats || chats.length === 0) {
      list.textContent = "Пока нет сохранённых диалогов.";
      return;
    }

    chats.forEach(chat => {
      const row = document.createElement("div");
      row.className = "multi-chat-row";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "multi-chat-list-item";
      openButton.textContent = chat.title || "Новый диалог";

      if (chat.id === currentMultiChatId) {
        openButton.classList.add("active");
      }

      openButton.addEventListener("click", async () => {
        await openMultiChat(chat.id);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-multi-chat-btn";
      deleteButton.textContent = "×";
      deleteButton.title = "Удалить диалог";
      deleteButton.setAttribute("aria-label", "Удалить диалог");

      deleteButton.addEventListener("click", async () => {
        if (multiSending || chatSending) { toast("Дождись завершения ответов."); return; }
        const confirmed = confirm(
          `Удалить диалог «${chat.title || "Новый диалог"}»?\n\nЭто действие нельзя отменить.`
        );

        if (!confirmed) return;

        try { await attachmentsUI.removeChatFiles(currentUser.id, "multi", chat.id); }
        catch (error) { toast(error.message); return; }

        const { error: deleteError } = await supabase
          .from("multi_ai_chats")
          .delete()
          .eq("id", chat.id)
          .eq("user_id", currentUser.id);

        if (deleteError) {
          console.error("Ошибка удаления диалога:", deleteError);
          toast("Не удалось удалить диалог.");
          return;
        }

        multiHistoryCache.delete(chat.id);
        if (currentMultiChatId === chat.id) {
          currentMultiChatId = null;

          $("#multiMessages").innerHTML = `
            <div class="multi-welcome">
              <div class="multi-welcome-icon">✳</div>
              <h2>Новый диалог</h2>
              <p>Напиши сообщение, чтобы начать новую переписку.</p>
            </div>
          `;

          $("#multiMessageInput").value = "";
        }

        await loadMultiChatList();
        toast("Диалог удалён.");
      });

      row.appendChild(openButton);
      row.appendChild(deleteButton);
      list.appendChild(row);
    });
  }

  // Открываем выбранный диалог
  async function openMultiChat(chatId) {
    if (multiOpening) return;
    if (multiSending || multiOpening) { toast("Дождись завершения текущего действия."); return; }
    if (!currentUser) return;

    multiOpening = true;
    try {
    const { data: chat, error: chatError } = await supabase
      .from("multi_ai_chats")
      .select("id, title, selected_models, sequential_mode")
      .eq("id", chatId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (chatError || !chat) {
      console.error("Ошибка открытия диалога:", chatError);
      toast("Не удалось открыть диалог.");
      return;
    }

    const { data: messages, error: messagesError } = await supabase
      .from("multi_ai_messages")
      .select("id, role, model_key, speaker, content, created_at, attachments, research_job_id, citations")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Ошибка загрузки сообщений:", messagesError);
      toast("Не удалось загрузить сообщения.");
      return;
    }

    currentMultiChatId = chat.id;
    const cached = multiHistoryCache.get(chat.id);
    const visibleMessages = cached?.some(message => message.saved === false) ? cached : (messages || []);
    multiHistoryCache.set(chat.id, visibleMessages);

    const selectedModels = Array.isArray(chat.selected_models)
      ? chat.selected_models
      : ["chatgpt", "deepseek"];

    $$('input[name="multiModel"]').forEach(input => {
      input.checked = selectedModels.includes(input.value);
    });

    $("#multiAutoMode").checked = chat.sequential_mode !== false;

    const box = $("#multiMessages");
    box.innerHTML = "";

    if (visibleMessages.length === 0) {
      box.innerHTML = `
        <div class="multi-welcome">
          <div class="multi-welcome-icon">✳</div>
          <h2>Продолжим диалог</h2>
          <p>Напиши сообщение, чтобы продолжить работу команды ИИ.</p>
        </div>
      `;
    } else {
      visibleMessages.forEach(message => {
        addMultiMessage(
          message.speaker,
          message.content,
          message.role === "user" ? "user" : "assistant",
          message.attachments,
          message
        );
      });
    }

    $("#multiRunStatus").textContent = visibleMessages.some(message => message.saved === false) ? "Есть ответы, не сохранённые на сервере. Скопируй их перед закрытием страницы." : "История загружена. Можно продолжить обсуждение.";
    const pending=visibleMessages.findLast(message=>message.role==="user"&&message.research_job_id);
    if(pending&&selectedModels.some(model=>!visibleMessages.some(message=>message.role==="assistant"&&message.research_job_id===pending.research_job_id&&message.model_key===model))){
      multiResearch.offerResume(pending.research_job_id,async()=>{
        if(multiSending)return;multiSending=true;multiResearch.lock(true);multiFiles.lock(true);
        const button=$("#multiChatForm button[type='submit']"),input=$("#multiMessageInput");button.disabled=true;input.disabled=true;
        try{await multiResearch.resume(pending.research_job_id);const missing=selectedModels.filter(model=>!visibleMessages.some(message=>message.role==="assistant"&&message.research_job_id===pending.research_job_id&&message.model_key===model));await runMultiDiscussion(chat.id,missing,chat.sequential_mode!==false,pending.content,pending.research_job_id,pending.id);}
        finally{multiSending=false;multiResearch.lock(false);multiFiles.lock(false);button.disabled=false;input.disabled=false;}
      });
    }
    await loadMultiChatList();
    } catch { toast("Не удалось открыть диалог."); }
    finally { multiOpening = false; }
  }

  // Загружаем список и последний диалог
  async function loadLatestMultiChat() {
    if (!currentUser) return;

    await loadMultiChatList();

    const { data: chat, error } = await supabase
      .from("multi_ai_chats")
      .select("id")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Ошибка загрузки последнего диалога:", error);
      return;
    }

    if (chat) {
      await openMultiChat(chat.id);
    } else {
      currentMultiChatId = null;
    }
  }
  
  // Удаляем все диалоги Мульти-ИИ текущего пользователя
  $("#deleteAllMultiChatsBtn").addEventListener("click", async () => {
    if (multiSending || multiOpening) { toast("Дождись завершения текущего действия."); return; }
    if (!currentUser) {
      toast("Сначала войди в аккаунт.");
      return;
    }

    const confirmed = confirm(
      "Удалить ВСЕ диалоги Мульти-ИИ?\n\nВся история этих диалогов будет удалена. Это действие нельзя отменить."
    );

    if (!confirmed) return;

    try { await attachmentsUI.removeAllChatFiles(currentUser.id, "multi", "multi_ai_chats"); }
    catch (error) { toast(error.message); return; }

    const { error } = await supabase
      .from("multi_ai_chats")
      .delete()
      .eq("user_id", currentUser.id);

    if (error) {
      console.error("Ошибка удаления всех диалогов:", error);
      toast("Не удалось удалить диалоги.");
      return;
    }

    currentMultiChatId = null;

    $("#multiMessages").innerHTML = `
      <div class="multi-welcome">
        <div class="multi-welcome-icon">✳</div>
        <h2>Новый диалог</h2>
        <p>Напиши сообщение, чтобы начать новую переписку.</p>
      </div>
    `;

    $("#multiMessageInput").value = "";
    multiHistoryCache.clear();
    $("#multiRunStatus").textContent = "Диалоги удалены. Можно начать новое обсуждение.";

    await loadMultiChatList();
    toast("Все диалоги удалены.");
  });
  
  // Создаём новый пустой диалог
  $("#newMultiChatBtn").addEventListener("click", () => {
    if (multiSending || multiOpening) { toast("Дождись завершения текущего действия."); return; }
    currentMultiChatId = null;
    $("#multiRunStatus").textContent = "Новый диалог. Выбери участников и отправь задачу.";

    const box = $("#multiMessages");
    box.innerHTML = `
      <div class="multi-welcome">
        <div class="multi-welcome-icon">✳</div>
        <h2>Новый диалог</h2>
        <p>Напиши сообщение, чтобы начать новую переписку.</p>
      </div>
    `;

    $("#multiMessageInput").value = "";
    loadMultiChatList();
    $("#multiMessageInput").focus();
  });

  // Generate one reply per participant; a provider failure never discards other replies.
  async function runMultiDiscussion(chatId, models, sequential, prompt, researchId = null, answerRequestId = null) {
    const history = multiHistoryCache.get(chatId) || [];
    const rows = new Map();
    for (const model of models) {
      const row = addMultiMessage(modelLabels[model], "Ожидает очереди…");
      $("button", row).disabled = true;
      row.classList.add("is-pending"); rows.set(model, row);
    }
    const results = await workflows.runDiscussion({
      models, sequential, history, prompt, names: modelLabels,
      generate: (model, messages) => genapi.chat(model, messages,{researchId,answerRequestId}),
      onResult: async message => {
        const cachedMessage = { ...message, saved: false };
        history.push(cachedMessage);
        await saveMultiMessage(chatId, message.role, message.speaker, message.content, message.model_key,[],...(message.research_job_id?[{research_job_id:message.research_job_id,citations:message.citations||[]}]:[]));
        cachedMessage.saved = true;
      },
      onState: (model, state, result) => {
        const row = rows.get(model);
        const content = $(".multi-message-content", row);
        if (state === "running") { content.textContent = "Получаем ответ GenAPI…"; $("#multiRunStatus").textContent = "Отвечает " + modelLabels[model] + "…"; return; }
        row.classList.remove("is-pending");
        if (state === "success") {
          content.textContent = result.message.content;
          researchUI?.renderAnswer(result.message,content);
          $("button", row).disabled = false;
          if (!result.saved) {
            const warning = document.createElement("small"); warning.className = "workflow-error";
            warning.textContent = "Ответ получен, но не сохранён. Скопируй его перед закрытием страницы."; row.appendChild(warning);
          }
        } else { row.classList.add("workflow-error"); content.textContent = result.error; }
      }
    });
    const success = results.filter(result => result.status === "success").length;
    const unsaved = history.some(message => message.saved === false);
    $("#multiRunStatus").textContent = "Получено ответов: " + success + " из " + models.length + ". " +
      (unsaved ? "Есть несохранённые ответы — скопируй их перед закрытием страницы." : "История сохранена.") +
      (success < models.length ? " Неудавшиеся запросы автоматически не повторяются." : "");
  }

  $("#multiChatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (multiSending || multiOpening) return;

    const input = $("#multiMessageInput");
    const requestedFiles = multiFiles.count() > 0;
    let prompt;
    try { prompt = workflows.validatePrompt(input.value.trim() || (multiFiles.count() ? "Проанализируй прикреплённые файлы." : "")); } catch (error) { toast(error.message); return; }
    if(multiResearch.mode()!=="off"&&prompt.length>500){toast("Для интернет-поиска сократи запрос до 500 символов.");return;}

    if (!prompt) {
      toast("Сначала напиши сообщение для общего чата.");
      input.focus();
      return;
    }

    if (!currentUser) {
      toast("Войди в аккаунт, чтобы сохранять историю Мульти-ИИ.");
      window.location.href = "auth.html";
      return;
    }

    const selectedModels = $$(
      'input[name="multiModel"]:checked'
    ).map(input => input.value);

    if (!selectedModels.length) {
      toast("Выбери хотя бы одного участника.");
      return;
    }

    const sendButton = $("#multiChatForm button[type='submit']");
    const sequential = $("#multiAutoMode").checked;

    multiSending = true;
    multiFiles.lock(true);
    multiResearch.lock(true);
    const controls = [...$$('input[name="multiModel"]'), $("#multiAutoMode"), $("#newMultiChatBtn"), $("#deleteAllMultiChatsBtn")];
    controls.forEach(control => { control.disabled = true; });
    $("#multiRunStatus").textContent = "Сохраняем запрос…";
    input.disabled = true;
    sendButton.disabled = true;

    try {
      await multiFiles.ready();
      if (requestedFiles && !multiFiles.count()) throw new Error("Не удалось подготовить вложения. Выбери файлы снова.");
      // Создаём новый диалог при первом сообщении
      if (!currentMultiChatId) {
        await createMultiChat(prompt, selectedModels, sequential);
      } else {
        await updateMultiChat(selectedModels, sequential);
      }

      const operationChatId = currentMultiChatId;
      const files = await multiFiles.upload(currentUser.id, "multi", operationChatId);
      const messageId=crypto.randomUUID();
      // Сохраняем сообщение пользователя
      await saveMultiMessage(
        operationChatId,
        "user",
        "Ты",
        prompt,
        null,
        files,
        {id:messageId}
      );

      const history = multiHistoryCache.get(operationChatId) || [];
      const userMessage={ id:messageId,role: "user", speaker: "Ты", content: prompt, saved: true, attachments: files };
      history.push(userMessage);
      multiHistoryCache.set(operationChatId, history);
      addMultiMessage("Ты", prompt, "user", files);
      multiFiles.clear();
      input.value = "";
      const researchId=await multiResearch.prepare({userId:currentUser.id,chatId:operationChatId,messageId,prompt,onCreated:async id=>{const {error}=await supabase.from("multi_ai_messages").update({research_job_id:id}).eq("id",messageId).eq("chat_id",operationChatId);if(error)throw new Error("Не удалось связать исследование с сообщением.");userMessage.research_job_id=id;}});

      // Сохраняем ответы выбранных моделей
      await runMultiDiscussion(
        operationChatId,
        selectedModels,
        sequential,
        prompt,
        researchId,
        messageId
      );
      await loadMultiChatList();
      
    } catch (error) {
      console.error("Ошибка Мульти-ИИ:", error);
      $("#multiRunStatus").textContent = error.message || "Не удалось выполнить запрос Мульти-ИИ.";
      toast(error.message || "Не удалось выполнить запрос Мульти-ИИ.");
    } finally {
      multiSending = false;
      multiFiles.lock(false);
      multiResearch.lock(false);
      controls.forEach(control => { control.disabled = false; });
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  });
    // Загружаем проекты и задачи пользователя из Supabase
  async function loadProjectsAndTasks() {
    if (!currentUser) return;

    const { data: projectRows, error: projectError } = await supabase
      .from("ai_projects")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (projectError) {
      console.error("Ошибка загрузки проектов:", projectError);
      toast("Не удалось загрузить проекты.");
      return;
    }

    const { data: taskRows, error: taskError } = await supabase
      .from("ai_tasks")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (taskError) {
      console.error("Ошибка загрузки задач:", taskError);
      toast("Не удалось загрузить задачи.");
      return;
    }

    projects = (projectRows || []).map(p => ({
      ...p,
      desc: p.description || ""
    }));

    tasks = (taskRows || []).map(t => ({
      ...t,
      desc: t.description || ""
    }));

    renderProjects();
    renderTasks();
  }

  // Отрисовка проектов
  const renderProjects = () => {
    const grid = $("#projectGrid");
    grid.innerHTML = "";

    projects.forEach(p => {
      const card = document.createElement("article");
      card.className = "project-card";

      const taskCount = tasks.filter(t => t.project_id === p.id).length;

      card.innerHTML = `
        <div class="project-icon ${p.color || "purple-bg"}">${p.icon || "✧"}</div>
        <span class="project-state ${p.state === "Идея" ? "quiet-state" : ""}">${p.state || "В работе"}</span>
        <h3></h3>
        <p></p>
        <div class="project-meta">
          <span>◷ Supabase</span>
          <span>${taskCount} задач</span>
        </div>
        <button class="text-action">Открыть проект <span>→</span></button>
      `;

      $("h3", card).textContent = p.name;
      $("p", card).textContent = p.desc;

      $(".text-action", card).addEventListener("click", () => {
        openDialog(
          p.name,
          p.desc || "Описание проекта не указано.",
          "Понятно",
          () => {}
        );
      });

      grid.appendChild(card);
    });

    const add = document.createElement("button");
    add.className = "add-project-card";
    add.innerHTML = "<span>＋</span><strong>Создать проект</strong><small>Начни с чистого листа</small>";
    add.addEventListener("click", createProject);
    grid.appendChild(add);
  };

  // Создание проекта в Supabase
  function createProject() {
    openDialog(
      "Новый проект",
      "Дай проекту название и коротко опиши цель.",
      "Создать",
      async () => {
        if (!currentUser) {
          toast("Войди в аккаунт.");
          return false;
        }

        const name = $("#fieldName")?.value.trim();
        const desc = $("#fieldDesc")?.value.trim();

        if (!name) {
          toast("Укажи название проекта.");
          return false;
        }

        const { data, error } = await supabase
          .from("ai_projects")
          .insert({
            user_id: currentUser.id,
            name,
            description: desc || "Новый проект без описания.",
            state: "В работе",
            icon: "✧",
            color: "purple-bg"
          })
          .select()
          .single();

        if (error) {
          console.error("Ошибка создания проекта:", error);
          toast("Не удалось создать проект.");
          return false;
        }

        projects.unshift({
          ...data,
          desc: data.description || ""
        });

        renderProjects();
        renderTasks();
        toast("Проект сохранён.");
        return true;
      },
      [
        {
          id: "fieldName",
          label: "Название проекта",
          placeholder: "Например, мой первый сайт"
        },
        {
          id: "fieldDesc",
          label: "Описание",
          placeholder: "Чего хочешь добиться?"
        }
      ]
    );
  }

  $("#addProject").addEventListener("click", createProject);
  $("#addProjectCard").addEventListener("click", createProject);

  // Отрисовка задач
  const renderTasks = () => {
    const list = $("#taskList");
    list.innerHTML = "";

    const filter = $("#taskFilter").value;

    tasks
      .filter(t =>
        filter === "all" ||
        (filter === "done" ? t.done : !t.done)
      )
      .forEach(t => {
        const row = document.createElement("div");
        row.className = "task-row" + (t.done ? " completed" : "");

        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "task-check";
        check.checked = t.done;
        check.setAttribute("aria-label", "Отметить задачу выполненной");

        check.addEventListener("change", async () => {
          if (!currentUser) return;

          const previousValue = t.done;
          t.done = check.checked;
          check.disabled = true;

          const { error } = await supabase
            .from("ai_tasks")
            .update({
              done: t.done,
              updated_at: new Date().toISOString()
            })
            .eq("id", t.id)
            .eq("user_id", currentUser.id);

          check.disabled = false;

          if (error) {
            console.error("Ошибка обновления задачи:", error);
            t.done = previousValue;
            toast("Не удалось обновить задачу.");
          }

          renderTasks();
        });

        const copy = document.createElement("div");
        copy.className = "task-copy";

        const title = document.createElement("strong");
        title.textContent = t.title;

        const desc = document.createElement("p");
        desc.textContent = t.desc || "Без описания";

        copy.append(title, desc);

        const tag = document.createElement("span");
        tag.className = "task-tag" + (t.done ? " done-tag" : "");
        tag.textContent = t.done ? "Готово" : (t.tag || "Новая");

        row.append(check, copy, tag);
        list.appendChild(row);
      });

    const done = tasks.filter(t => t.done).length;

    $("#taskTotal").textContent = tasks.length;
    $("#taskActive").textContent = tasks.length - done;
    $("#taskDone").textContent = done;

    const percent = tasks.length
      ? Math.round(done / tasks.length * 100)
      : 0;

    $("#taskProgress").textContent = percent + "%";
    $("#taskProgressBar").style.width = percent + "%";

    if (!list.children.length) {
      const p = document.createElement("p");
      p.style.color = "var(--muted)";
      p.textContent = "В этой категории пока нет задач.";
      list.appendChild(p);
    }
  };

  $("#taskFilter").addEventListener("change", renderTasks);

  // Создание задачи в Supabase
  $("#addTask").addEventListener("click", () => {
    openDialog(
      "Новая задача",
      "Добавь небольшой следующий шаг.",
      "Добавить",
      async () => {
        if (!currentUser) {
          toast("Войди в аккаунт.");
          return false;
        }

        const title = $("#fieldName")?.value.trim();
        const desc = $("#fieldDesc")?.value.trim();

        if (!title) {
          toast("Укажи название задачи.");
          return false;
        }

        const { data, error } = await supabase
          .from("ai_tasks")
          .insert({
            user_id: currentUser.id,
            title,
            description: desc || "Без описания",
            done: false,
            tag: "Новая"
          })
          .select()
          .single();

        if (error) {
          console.error("Ошибка создания задачи:", error);
          toast("Не удалось сохранить задачу.");
          return false;
        }

        tasks.unshift({
          ...data,
          desc: data.description || ""
        });

        renderTasks();
        renderProjects();
        toast("Задача сохранена.");
        return true;
      },
      [
        {
          id: "fieldName",
          label: "Название задачи",
          placeholder: "Что нужно сделать?"
        },
        {
          id: "fieldDesc",
          label: "Описание",
          placeholder: "Необязательно"
        }
      ]
    );
  });
  function openDialog(title,text,confirmLabel,onConfirm,fields=[]){
    const d=$("#appDialog");$("#dialogTitle").textContent=title;$("#dialogText").textContent=text;$("#dialogConfirm").textContent=confirmLabel;const box=$("#dialogFields");box.innerHTML="";
    fields.forEach(f=>{const wrap=document.createElement("div");wrap.className="dialog-field";const label=document.createElement("label");label.textContent=f.label;label.htmlFor=f.id;const input=document.createElement(f.multiline?"textarea":"input");input.id=f.id;input.placeholder=f.placeholder||"";if(f.multiline)input.rows=3;wrap.append(label,input);box.appendChild(wrap);});
        $("#dialogConfirm").onclick = async (e) => {
      e.preventDefault();
      const button = $("#dialogConfirm");
      button.disabled = true;

      try {
        const result = await onConfirm?.();
        if (result !== false) d.close();
      } catch (error) {
        console.error("Ошибка выполнения действия:", error);
        toast("Произошла ошибка. Попробуй ещё раз.");
      } finally {
        button.disabled = false;
      }
    };

    d.showModal();

    setTimeout(() => {
      if (fields.length) {
        $("#" + fields[0].id)?.focus();
      }
    }, 50);
  }

  $$(".provider-detail").forEach(b=>b.addEventListener("click",()=>openDialog(b.dataset.provider,"Запросы выполняются через GenAPI. Доступ проверяется сервером; использование расходует баланс владельца GenAPI.","Понятно",()=>{})));
  $("#futureProvider").addEventListener("click",()=>toast("Новые провайдеры добавим отдельными модулями."));
  $("#themeToggle").addEventListener("click",()=>{document.body.classList.toggle("light-theme");save("aistudio_light",document.body.classList.contains("light-theme"));});
  if(read("aistudio_light",false))document.body.classList.add("light-theme");
  $("#compactToggle").addEventListener("change",e=>{document.body.classList.toggle("compact-mode",e.target.checked);save("aistudio_compact",e.target.checked);});
  $("#confirmClear").addEventListener("change",e=>save("aistudio_confirm_clear",e.target.checked));
  $("#compactToggle").checked=read("aistudio_compact",false);document.body.classList.toggle("compact-mode",$("#compactToggle").checked);
  $("#confirmClear").checked=read("aistudio_confirm_clear",true);
  $("#helpButton").addEventListener("click",()=>openDialog("Как пользоваться AI Studio","Чат, сравнение и Мульти-ИИ используют GenAPI после настройки серверной функции. История сохраняется в Supabase. Медиа-инструменты находятся в разделе моделей. Каждый запуск расходует средства GenAPI.","Понятно",()=>{}));
  $("#feedbackButton").addEventListener("click",()=>openDialog("Твоя заметка","Запиши идею или недостающую функцию — пока заметка никуда не отправляется.","Сохранить локально",()=>{
    const text=$("#fieldNote")?.value.trim();if(!text){toast("Напиши заметку.");return false;}const notes=read("aistudio_notes",[]);notes.push({text,date:new Date().toLocaleString("ru-RU")});save("aistudio_notes",notes);toast("Заметка сохранена в этом браузере.");return true;
  },[{id:"fieldNote",label:"Что стоит улучшить?",placeholder:"Хочу добавить…",multiline:true}]));
  $("#profileButton").addEventListener("click", () => {
    window.location.href = currentUser ? "profile.html" : "auth.html";
  });
  async function initChats() {
  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    const session = sessionData.session;

    if (!session || !session.user) {
      window.location.href = "auth.html";
      return;
    }

    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") { window.location.href = "auth.html"; return; }
    currentUser = session.user;
    renderSidebarProfile(currentUser);
    await loadProjectsAndTasks();
    
    await loadLatestMultiChat();
    
    const { data: chatRows, error: chatError } = await supabase
      .from("ai_chats")
      .select("id, title, model, updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false });

    if (chatError) throw chatError;

    const chatIds = (chatRows || []).map(chat => chat.id);
    let messageRows = [];

    if (chatIds.length > 0) {
      const { data, error } = await supabase
        .from("ai_messages")
        .select("id, chat_id, role, content, created_at, attachments, research_job_id, citations")
        .in("chat_id", chatIds)
        .order("created_at", { ascending: true });

      if (error) throw error;

      messageRows = data || [];
    }

    chats = (chatRows || []).map(chat => ({
      ...chat,
      messages: messageRows
        .filter(message => message.chat_id === chat.id)
        .map(message => ({
          id:message.id,
          role: message.role,
          content: message.content,
          attachments: message.attachments,
          research_job_id:message.research_job_id,
          citations:message.citations,
          model: modelLabels[chat.model] || "Ранее сохранённый ответ"
        }))
    }));

    activeChatId = null;
    renderHistory();
    renderChat();

  } catch (error) {
    console.error("Ошибка загрузки чатов:", error);
    toast("Не удалось загрузить чаты. Проверь подключение к Supabase.");
  }
  }
  document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();newChat();}});
  renderProjects();
renderTasks();
initChats();
})();
