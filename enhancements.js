/* AI Studio 3.0 — install PWA + model marks */
(() => {
  "use strict";
  let installPrompt = null;
  const buttons = () => [...document.querySelectorAll("#installAppButton, #installInline")];
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function toast(message) {
    const el = document.querySelector("#toast");
    if (!el) { alert(message); return; }
    el.textContent = message; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3800);
  }
  function label(text, disabled = false) {
    buttons().forEach(b => { b.hidden = false; b.textContent = text; b.disabled = disabled; });
  }
  function help() {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) toast("На iPhone: открой сайт в Safari → «Поделиться» → «На экран Домой».");
    else if (/Android/i.test(ua)) toast("Если системное окно не появилось, открой меню Chrome ⋮ → «Установить приложение» или «Добавить на главный экран».");
    else toast("Открой меню браузера и выбери «Установить приложение» или «Создать ярлык». Нужны HTTPS и поддерживаемый браузер.");
  }
  async function install() {
    if (standalone()) return toast("AI Studio уже открыта как приложение.");
    if (!installPrompt) return help();
    installPrompt.prompt();
    try {
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === "accepted") label("✓ Установка запущена");
    } catch (_) { help(); }
    installPrompt = null;
  }
  const openai = `<img src="./images/logos/gpt.jpeg" alt="OpenAI / ChatGPT">`;
  const whale = `<img src="./images/logos/deepseek.jpeg" alt="DeepSeek">`;
  function addMarks() {
    document.querySelectorAll(".provider-icon.openai").forEach(el => { el.innerHTML = openai; el.setAttribute("aria-label", "OpenAI / ChatGPT"); });
    document.querySelectorAll(".provider-icon.deepseek").forEach(el => { el.innerHTML = whale; el.setAttribute("aria-label", "DeepSeek"); });
    document.querySelectorAll(".provider-icon.gemini").forEach(el => {
      el.innerHTML = `<img src="./images/logos/gemini.png" alt="Gemini">`;
      el.setAttribute("aria-label", "Gemini");
    });
    document.querySelectorAll(".media-model-card").forEach(card => {
      const title = card.querySelector("h3")?.textContent || "";
      const art = card.querySelector(".media-model-art");
      if (!art) return;

      if (title.includes("Stability")) {
        art.innerHTML = `<img src="./images/logos/stability.png" alt="Stability AI">`;
      } else if (title.includes("Runway")) {
        art.innerHTML = `<img src="./images/logos/runway.jpg" alt="Runway">`;
      } else if (title.includes("ElevenLabs")) {
        art.innerHTML = `<img src="./images/logos/eleven.jpeg" alt="ElevenLabs">`;
      }
    });
  }
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; if (!standalone()) label("↓ Установить приложение"); });
  addEventListener("appinstalled", () => { installPrompt = null; label("✓ Приложение установлено", true); toast("AI Studio установлена."); });
  document.addEventListener("DOMContentLoaded", () => {
    buttons().forEach(b => b.addEventListener("click", install));
    addMarks();
    if (standalone()) label("✓ Уже установлено", true);
    else label("↓ Установить приложение");
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "./service-worker.js",
        { updateViaCache: "none" }
      );

      // Проверяем наличие новой версии при открытии сайта.
      await registration.update();

      // Если найдена новая версия, активируем её.
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;

        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            window.location.reload();
          }
        });
      });
    } catch (error) {
      console.warn("Не удалось обновить AI Studio:", error);
    }
  }, { once: true });
    }
  });
})();
