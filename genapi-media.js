(() => {
  const supabase = window.aiStudioSupabase;
  const api = window.AIStudioGenAPI.create(supabase);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cards = [...document.querySelectorAll("[data-media-model]")];
  const cacheKey = (userId, model) => `aistudio_genapi_job:${userId}:${model}`;
  const store = (key, job) => { try { if (job) sessionStorage.setItem(key, JSON.stringify(job)); else sessionStorage.removeItem(key); } catch {} };

  function showResults(card, urls) {
    const result = card.querySelector(".media-result"); result.replaceChildren();
    for (const value of urls || []) {
      let url;
      try { url = new URL(value); } catch { continue; }
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const kind = card.dataset.mediaModel;
      const media = document.createElement(kind === "image" ? "img" : kind);
      media.src = url.href;
      if (kind === "image") { media.alt = "Результат генерации Recraft"; media.loading = "lazy"; }
      else { media.controls = true; media.preload = "none"; }
      const link = document.createElement("a"); link.href = url.href;
      link.textContent = "Открыть и сохранить результат"; link.target = "_blank"; link.rel = "noopener noreferrer";
      result.append(media, link);
    }
    const note = document.createElement("p");
    note.textContent = result.children.length ? "Сохрани результат: ссылки GenAPI временные." : "Задача завершена. Ссылка не получена; проверь результат в кабинете GenAPI.";
    result.append(note);
  }

  cards.forEach(card => {
    const model = card.dataset.mediaModel;
    const form = card.querySelector("form");
    const status = card.querySelector(".media-status");
    const check = card.querySelector(".media-check");
    const submit = form.querySelector("[type='submit']");
    let job = null, key = null, busy = false;
    async function restoreJob() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Войди в аккаунт AI Studio.");
      const nextKey = cacheKey(data.session.user.id, model);
      if (key !== nextKey) {
        key = nextKey;
        try { job = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { job = null; }
      }
      check.hidden = !job;
    }
    async function poll(repeat) {
      if (!job || busy) return;
      busy = true; check.disabled = true; submit.disabled = true;
      try {
        const currentJob = job;
        for (let attempt = 0; attempt < (repeat ? 40 : 1); attempt++) {
          const result = await api.call({ action: "status", ticket: currentJob.ticket });
          if (result.status === "success") {
            status.textContent = `Готово · задача ${result.requestId}`;
            showResults(card, result.urls); job = null; store(key, null); check.hidden = true; return;
          }
          status.textContent = `Задача ${result.requestId} выполняется. Страницу можно оставить открытой.`;
          if (repeat) await pause(Math.min(5000 + attempt * 500, 15000));
        }
        status.textContent = `Задача ${currentJob.requestId} ещё выполняется. Нажми «Проверить результат» позже.`;
      } catch (error) { status.textContent = `${error.message} ID задачи: ${job?.requestId || "—"}.`; }
      finally { busy = false; check.disabled = false; submit.disabled = false; }
    }
    check.addEventListener("click", async () => {
      try { await restoreJob(); await poll(false); } catch (error) { status.textContent = error.message; }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (busy) return;
      busy = true; submit.disabled = true;
      try {
        await restoreJob();
        if (job && !confirm("Предыдущая задача ещё сохранена. Новый запуск оплачивается отдельно. Продолжить?")) return;
        const values = new FormData(form);
        status.textContent = "Отправляем запрос в GenAPI…";
        const started = await api.call({ action: "media", model, prompt: values.get("prompt"), videoUrl: values.get("videoUrl") });
        job = started; store(key, job); check.hidden = false;
        card.querySelector(".media-result").replaceChildren();
        status.textContent = `Задача ${job.requestId} принята.`;
      } catch (error) { status.textContent = error.message; return; }
      finally { busy = false; submit.disabled = false; }
      await poll(true);
    });
    restoreJob().then(() => { if (job) status.textContent = `Есть задача ${job.requestId}. Нажми «Проверить результат».`; }).catch(() => {});
  });

  api.call({ action: "health" }).then(() => {
    document.querySelector("#genapiStatus").textContent = "Сервер GenAPI настроен";
    document.querySelectorAll(".genapi-connect-state").forEach(el => { el.textContent = "Через GenAPI"; });
  }).catch(error => {
    document.querySelector("#genapiStatus").textContent = "GenAPI требует настройки";
    document.querySelectorAll(".genapi-connect-state").forEach(el => { el.textContent = "Нет доступа"; el.title = error.message; });
  });
})();
