/* AI Studio — brand marks loaded as SVGs from Simple Icons CDN.
   Additive-only patch: does not replace or delete existing app files. */
(() => {
  "use strict";

  const brands = {
    openai: { src: "https://cdn.simpleicons.org/openai", label: "OpenAI" },
    deepseek: { src: "https://cdn.simpleicons.org/deepseek", label: "DeepSeek" },
    stability: { src: "https://cdn.simpleicons.org/stabilityai", label: "Stability AI" },
    runway: { src: "https://cdn.simpleicons.org/runway", label: "Runway" },
    elevenlabs: { src: "https://cdn.simpleicons.org/elevenlabs", label: "ElevenLabs" }
  };

  function applyMark(element, brandKey) {
    const brand = brands[brandKey];
    if (!brand || element.dataset.brandMarkApplied === brandKey) return;

    const img = document.createElement("img");
    img.src = brand.src;
    img.alt = brand.label;
    img.title = brand.label;
    img.loading = "lazy";
    img.decoding = "async";
    img.className = "ai-brand-logo";
    img.onerror = () => {
      // Keep the original symbol if a provider icon is unavailable from the CDN.
      img.remove();
      delete element.dataset.brandMarkApplied;
      element.classList.remove("ai-brand-mark");
    };

    element.dataset.brandMarkApplied = brandKey;
    element.classList.add("ai-brand-mark");
    element.replaceChildren(img);
  }

  function apply() {
    document.querySelectorAll(".provider-icon.openai").forEach(el => applyMark(el, "openai"));
    document.querySelectorAll(".provider-icon.deepseek").forEach(el => applyMark(el, "deepseek"));
    document.querySelectorAll(".media-model-art.image-art").forEach(el => applyMark(el, "stability"));
    document.querySelectorAll(".media-model-art.video-art").forEach(el => applyMark(el, "runway"));
    document.querySelectorAll(".media-model-art.audio-art").forEach(el => applyMark(el, "elevenlabs"));
  }

  const style = document.createElement("style");
  style.dataset.aiStudioBrandMarks = "true";
  style.textContent = `
    .ai-brand-mark { display:grid!important; place-items:center; }
    .ai-brand-logo { display:block; width:70%; height:70%; max-width:38px; max-height:38px; object-fit:contain; }
    .provider-icon.ai-brand-mark .ai-brand-logo { width:66%; height:66%; }
    .media-model-art.ai-brand-mark .ai-brand-logo { width:58%; height:58%; max-width:56px; max-height:56px; }
  `;
  document.head.appendChild(style);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
})();
