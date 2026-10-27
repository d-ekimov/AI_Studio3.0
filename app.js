(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
    const SUPABASE_URL = "https://zzjfceazpjpavnyyigek.supabase.co";
  const SUPABASE_KEY = "sb_publishable_uZhcc1D66aEzG5xqoe1jcg_Ts7NZI3V";

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );
  const pageNames = {chat:"Чат", compare:"Несколько ИИ", multi:"Мульти-ИИ", projects:"Проекты", tasks:"Задачи", models:"Модели"};
  const defaultTasks = [
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
    const modelName = () => ({chatgpt:"ChatGPT · Demo",deepseek:"DeepSeek · Demo",gemini:"Google Gemini · Demo",future:"Будущая модель · Demo"}[$("#modelSelect").value] || "ChatGPT · Demo");
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
        const confirmed = confirm(
          `Удалить чат «${c.title || "Новый чат"}»?\n\nЭто действие нельзя отменить.`
        );

        if (!confirmed) return;

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
      if(m.role!=="user"){const small=document.createElement("small");small.textContent=m.model||modelName();content.appendChild(small);}
      row.append(av,content);box.appendChild(row);
    });
    box.scrollTop=box.scrollHeight;
  };
  const persistChats=()=>{renderHistory();};
const newChat=()=>{activeChatId=null;renderChat();renderHistory();go("chat");$("#messageInput").focus();};
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
  const demoAnswer=(prompt,model)=>{
    const p=prompt.toLowerCase();
    const intro=model==="deepseek"?"Давай разложим запрос по шагам.":"Хорошая отправная точка! Предлагаю двигаться постепенно.";
    if(p.includes("сайт")||p.includes("сайта"))return intro+"\n\n1. Определим цель и аудиторию.\n2. Соберём структуру страниц и переходов.\n3. Подготовим адаптивный дизайн.\n4. Проверим все кнопки и состояния.\n5. После проверки подключим нужные сервисы.\n\nЭто демонстрационный ответ. После подключения API здесь будет отвечать выбранная модель.";
    if(p.includes("задач")||p.includes("цель"))return intro+"\n\n• Сформулируй конечный результат.\n• Разбей его на небольшие шаги.\n• Выбери одну задачу на сегодня.\n• После выполнения проверь результат и обнови план.\n\nВ настоящем режиме мы сможем адаптировать план под твой проект.";
    if(p.includes("текст")||p.includes("напис"))return intro+"\n\nСначала уточним, для кого текст и какого результата хотим добиться. Затем подготовим черновик, проверим тон и ясность, а в конце сделаем финальную редактуру.\n\nПришли тему и желаемый стиль — продолжим.";
    if(p.includes("иде"))return intro+"\n\nМожно начать с трёх вариантов: простой продукт для быстрого запуска, инструмент для конкретной аудитории или сервис, который автоматизирует повторяющуюся задачу. Для выбора сравним пользу, сложность реализации и время на первый прототип.";
    return intro+"\n\nЯ бы предложил сначала уточнить желаемый результат, затем выделить главные ограничения и составить короткий план. После этого можно переходить к конкретным действиям.\n\nНапоминание: сейчас это демонстрационный ответ, а не ответ настоящей языковой модели.";
  };
  const sendMessage = async (text) => {
  text = (text || "").trim();
  if (!text) return;

  if (!currentUser) {
    toast("Войди в аккаунт, чтобы пользоваться чатами.");
    window.location.href = "auth.html";
    return;
  }

  const selected = $("#modelSelect").value;
  let c = currentChat();

  if (!c) {
    const title = text.length > 34
      ? text.slice(0, 34) + "…"
      : text;

    const { data, error } = await supabase
      .from("ai_chats")
      .insert({
        user_id: currentUser.id,
        title: title,
        model: selected
      })
      .select()
      .single();

    if (error) {
  console.error("Ошибка создания чата:", error);
  toast("Ошибка: " + error.message);
  return;
    }

    c = {
      id: data.id,
      title: data.title,
      model: data.model,
      messages: []
    };

    chats.unshift(c);
    activeChatId = c.id;
  }

  const answer = demoAnswer(text, selected);

  const { error: messageError } = await supabase
    .from("ai_messages")
    .insert([
      {
        chat_id: c.id,
        role: "user",
        content: text
      },
      {
        chat_id: c.id,
        role: "assistant",
        content: answer
      }
    ]);

  if (messageError) {
    console.error("Ошибка сохранения сообщений:", messageError);
    toast("Не удалось сохранить сообщения.");
    return;
  }

  c.messages.push(
    { role: "user", content: text },
    { role: "assistant", content: answer, model: modelName() }
  );

  const { error: updateError } = await supabase
    .from("ai_chats")
    .update({
      updated_at: new Date().toISOString(),
      model: selected
    })
    .eq("id", c.id);

  if (updateError) {
    console.error("Ошибка обновления чата:", updateError);
  }

  persistChats();
  renderChat();

  $("#messageInput").value = "";
  $("#messageInput").style.height = "auto";
};
  $("#chatForm").addEventListener("submit",e=>{e.preventDefault();sendMessage($("#messageInput").value);});
  $("#messageInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(e.target.value);}});
  $$(".suggestion").forEach(b=>b.addEventListener("click",()=>sendMessage(b.dataset.prompt)));
  $("#attachButton").addEventListener("click",()=>toast("Загрузка файлов появится после следующего этапа разработки."));
  $("#clearHistory").addEventListener("click", () => {
  const clear = async () => {
    if (!currentUser) {
      toast("Сначала войди в аккаунт.");
      return;
    }

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
    const compareNames = {
    chatgpt: "ChatGPT",
    deepseek: "DeepSeek",
    gemini: "Google Gemini"
  };

  const compareReply = (p, model) => {
    if (model === "chatgpt") {
      return "Подход ChatGPT:\n\n1. Определить главную цель.\n2. Разбить задачу на понятные шаги.\n3. Предложить практическое решение.\n\nЗапрос: «" + p.slice(0, 100) + "»\n\nЭто демонстрационный ответ.";
    }

    if (model === "deepseek") {
      return "Подход DeepSeek:\n\n1. Разобрать задачу и ограничения.\n2. Сравнить возможные решения.\n3. Выбрать наиболее эффективный вариант.\n\nЗапрос: «" + p.slice(0, 100) + "»\n\nЭто демонстрационный ответ.";
    }

    return "Подход Google Gemini:\n\n1. Рассмотреть задачу с разных сторон.\n2. Сформировать несколько идей.\n3. Выбрать наиболее перспективное решение.\n\nЗапрос: «" + p.slice(0, 100) + "»\n\nЭто демонстрационный ответ.";
  };

  function updateCompareModel(slot) {
    const select = $("#compareModel" + slot);
    const icon = $("#compareIcon" + slot);
    const model = select.value;

    icon.className = "provider-icon " +
      (model === "deepseek" ? "deepseek" : "openai");

    const imagePath = {
      chatgpt: "./images/logos/gpt.jpeg",
      deepseek: "./images/logos/deepseek.jpeg",
      gemini: "./images/logos/gemini.png"
    }[model];

    icon.innerHTML = "";
    const img = document.createElement("img");
    img.src = imagePath;
    img.alt = compareNames[model];
    icon.appendChild(img);
  }

  $("#compareModel1").addEventListener("change", () => updateCompareModel(1));
  $("#compareModel2").addEventListener("change", () => updateCompareModel(2));

  $("#compareRun").addEventListener("click", () => {
    const p = $("#comparePrompt").value.trim();

    if (!p) {
      toast("Сначала напиши запрос для сравнения.");
      $("#comparePrompt").focus();
      return;
    }

    [1, 2].forEach(slot => {
      const model = $("#compareModel" + slot).value;
      const card = $("#compareIcon" + slot).closest(".compare-card");
      const answer = $(".compare-answer", card);

      answer.classList.remove("muted-answer");
      answer.textContent = compareReply(p, model);
    });

    toast("Демонстрационные ответы готовы.");
  });
  updateCompareModel(1);
  updateCompareModel(2);
  
  // ===== МУЛЬТИ-ИИ: ОБЩИЙ ДИАЛОГ С СОХРАНЕНИЕМ =====

  let currentMultiChatId = null;

  const multiModels = {
    chatgpt: {
      name: "ChatGPT",
      reply: (prompt) =>
        "Предлагаю начать со структуры задачи: определить цель, выделить основные требования и разбить решение на конкретные шаги.\n\nПо запросу: «" +
        prompt.slice(0, 180) +
        "»\n\nЭто демонстрационный ответ."
    },
    deepseek: {
      name: "DeepSeek",
      reply: (prompt) =>
        "Я бы дополнительно проверил ограничения, возможные риски и эффективность каждого шага. Затем сравнил бы варианты и выбрал наиболее практичный.\n\nПо запросу: «" +
        prompt.slice(0, 180) +
        "»\n\nЭто демонстрационный ответ."
    },
    gemini: {
      name: "Gemini",
      reply: (prompt) =>
        "Предлагаю рассмотреть задачу с другой стороны, найти альтернативные идеи и объединить наиболее сильные решения в один план.\n\nПо запросу: «" +
        prompt.slice(0, 180) +
        "»\n\nЭто демонстрационный ответ."
    }
  };

  const multiDelay = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

  function addMultiMessage(speaker, content, role = "assistant") {
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

    row.append(name, text);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  // Сохраняем одно сообщение в Supabase
  async function saveMultiMessage(chatId, role, speaker, content, modelKey = null) {
    const { error } = await supabase
      .from("multi_ai_messages")
      .insert({
        chat_id: chatId,
        role: role,
        model_key: modelKey,
        speaker: speaker,
        content: content
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
        const confirmed = confirm(
          `Удалить диалог «${chat.title || "Новый диалог"}»?\n\nЭто действие нельзя отменить.`
        );

        if (!confirmed) return;

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
    if (!currentUser) return;

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
      .select("id, role, model_key, speaker, content, created_at")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Ошибка загрузки сообщений:", messagesError);
      toast("Не удалось загрузить сообщения.");
      return;
    }

    currentMultiChatId = chat.id;

    const selectedModels = Array.isArray(chat.selected_models)
      ? chat.selected_models
      : ["chatgpt", "deepseek"];

    $$('input[name="multiModel"]').forEach(input => {
      input.checked = selectedModels.includes(input.value);
    });

    $("#multiAutoMode").checked = chat.sequential_mode !== false;

    const box = $("#multiMessages");
    box.innerHTML = "";

    if (!messages || messages.length === 0) {
      box.innerHTML = `
        <div class="multi-welcome">
          <div class="multi-welcome-icon">✳</div>
          <h2>Продолжим диалог</h2>
          <p>Напиши сообщение, чтобы продолжить работу команды ИИ.</p>
        </div>
      `;
    } else {
      messages.forEach(message => {
        addMultiMessage(
          message.speaker,
          message.content,
          message.role === "user" ? "user" : "assistant"
        );
      });
    }

    await loadMultiChatList();
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
    if (!currentUser) {
      toast("Сначала войди в аккаунт.");
      return;
    }

    const confirmed = confirm(
      "Удалить ВСЕ диалоги Мульти-ИИ?\n\nВся история этих диалогов будет удалена. Это действие нельзя отменить."
    );

    if (!confirmed) return;

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

    await loadMultiChatList();
    toast("Все диалоги удалены.");
  });
  
  // Создаём новый пустой диалог
  $("#newMultiChatBtn").addEventListener("click", () => {
    currentMultiChatId = null;

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

  // Генерируем ответы и сохраняем каждый из них
  async function runMultiDiscussion(prompt, models, sequential) {
    const runModel = async (key, index) => {
      if (sequential && index > 0) {
        await multiDelay(700 * index);
      }

      const speaker = multiModels[key].name;
      const answer = multiModels[key].reply(prompt);

      await saveMultiMessage(
        currentMultiChatId,
        "assistant",
        speaker,
        answer,
        key
      );

      addMultiMessage(speaker, answer);
    };

    if (sequential) {
      for (let i = 0; i < models.length; i++) {
        await runModel(models[i], i);
      }
    } else {
      await Promise.all(
        models.map((key, index) => runModel(key, index))
      );
    }
  }

  $("#multiChatForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = $("#multiMessageInput");
    const prompt = input.value.trim();

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

    input.disabled = true;
    sendButton.disabled = true;

    try {
      // Создаём новый диалог при первом сообщении
      if (!currentMultiChatId) {
        await createMultiChat(prompt, selectedModels, sequential);
      } else {
        await updateMultiChat(selectedModels, sequential);
      }

      // Сохраняем сообщение пользователя
      await saveMultiMessage(
        currentMultiChatId,
        "user",
        "Ты",
        prompt
      );

      addMultiMessage("Ты", prompt, "user");
      input.value = "";

      // Сохраняем ответы выбранных моделей
      await runMultiDiscussion(
        prompt,
        selectedModels,
        sequential
      );
      await loadMultiChatList();
      
    } catch (error) {
      console.error("Ошибка Мульти-ИИ:", error);
      toast("Не удалось сохранить диалог. Проверь подключение к Supabase.");
    } finally {
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
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
  $("#profileButton").addEventListener("click", () => {
  const registered =
    localStorage.getItem("aiStudioRegistered") === "true";

  window.location.href = registered
    ? "profile.html"
    : "auth.html";
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

    currentUser = session.user;
    renderSidebarProfile(currentUser);
    
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
        .select("id, chat_id, role, content, created_at")
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
          role: message.role,
          content: message.content,
          model: chat.model === "deepseek"
            ? "DeepSeek · Demo"
            : chat.model === "future"
              ? "Будущая модель · Demo"
              : "ChatGPT · Demo"
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
