/* AI Studio brand logo patch — v2
   Keeps existing layout and colors. Applies logos to the existing model cards,
   including cards inserted later by app.js. If an icon URL fails, restores the
   original text symbol instead of leaving an empty tile.
*/
(() => {
  "use strict";

  const brands = {
    openai: {
      src: "https://cdn.simpleicons.org/openai",
      label: "OpenAI"
    },
    deepseek: {
      src: "https://cdn.simpleicons.org/deepseek",
      label: "DeepSeek"
    },
    stability: {
      src: "https://cdn.simpleicons.org/stabilityai",
      label: "Stability AI"
    },
    runway: {
      src: "https://cdn.simpleicons.org/runway",
      label: "Runway"
    },
    elevenlabs: {
      src: "https://cdn.simpleicons.org/elevenlabs",
      label: "ElevenLabs"
    }
  };

  const targets = [
    [".provider-icon.openai", "openai"],
    [".provider-icon.deepseek", "deepseek"],
    [".media-model-art.image-art", "stability"],
    [".media-model-art.video-art", "runway"],
    [".media-model-art.audio-art", "elevenlabs"]
  ];

  function applyLogo(element, brandKey) {
    if (element.dataset.aiLogoState === brandKey ||
        element.dataset.aiLogoState === "loading-" + brandKey) return;

    const brand = brands[brandKey];
    if (!brand) return;

    // Save the original symbol so it can be restored if the image cannot load.
    const originalSymbol = element.dataset.aiOriginalSymbol ?? element.textContent ?? "";
    element.dataset.aiOriginalSymbol = originalSymbol;

    const img = document.createElement("img");
    img.className = "ai-brand-logo";
    img.alt = brand.label;
    img.title = brand.label;
    img.decoding = "async";
    img.loading = "eager";
    img.referrerPolicy = "no-referrer";
    img.src = brand.src;

    img.onload = () => {
      element.dataset.aiLogoState = brandKey;
      element.classList.add("ai-brand-mark");
    };

    img.onerror = () => {
      element.replaceChildren(document.createTextNode(originalSymbol));
      delete element.dataset.aiLogoState;
      element.classList.remove("ai-brand-mark");
    };

    element.dataset.aiLogoState = "loading-" + brandKey;
    element.classList.add("ai-brand-mark");
    element.replaceChildren(img);
  }

  function applyAll() {
    for (const [selector, key] of targets) {
      document.querySelectorAll(selector).forEach(element => {
        // If app.js recreated the icon, apply the logo again.
        if (!element.querySelector("img.ai-brand-logo")) {
          delete element.dataset.aiLogoState;
          applyLogo(element, key);
        }
      });
    }
  }

  const styleId = "ai-studio-brand-logo-style-v2";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .ai-brand-mark {
        display: grid !important;
        place-items: center !important;
      }
      .ai-brand-logo {
        display: block;
        width: 70%;
        height: 70%;
        max-width: 42px;
        max-height: 42px;
        object-fit: contain;
      }
      .media-model-art.ai-brand-mark .ai-brand-logo {
        width: 58%;
        height: 58%;
        max-width: 56px;
        max-height: 56px;
      }
    `;
    document.head.appendChild(style);
  }

  function start() {
    applyAll();
    // Catch icons that app.js or navigation adds after initial page load.
    const observer = new MutationObserver(() => applyAll());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
