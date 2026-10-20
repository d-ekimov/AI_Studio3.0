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
    document.querySelectorAll(".media-model-card").forEach(card => {
      const title = card.querySelector("h3")?.textContent || "";
      const art = card.querySelector(".media-model-art");
      if (!art) return;
      if (title.includes("Stability")) art.innerHTML = `<svg viewBox="0 0 48 48" aria-label="Stability AI"><path fill="#fff" d="M24 3 29 17 44 24 29 29 24 45 19 29 4 24 19 17Z"/><circle cx="37" cy="10" r="3" fill="#fff"/></svg>`;
      else if (title.includes("Runway")) art.innerHTML = `<svg viewBox="0 0 48 48" aria-label="Runway"><rect x="5" y="5" width="38" height="38" rx="10" fill="none" stroke="#fff" stroke-width="3"/><path d="M18 14h9a7 7 0 0 1 0 14h-9zm0 14 13 7" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      else if (title.includes("ElevenLabs")) art.innerHTML = `<svg viewBox="0 0 48 48" aria-label="ElevenLabs"><path d="M14 8v32M24 8v32M34 8v32" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`;
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
      addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(err => console.warn("Service worker:", err)), { once: true });
    }
  });
})();
