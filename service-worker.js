const CACHE_NAME = "ai-studio-shell-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon.svg"
];

// Устанавливаем новую версию кэша.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Удаляем кэш старых версий, не затрагивая данные аккаунта.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Сначала получаем свежие файлы из сети.
// Если интернета нет, используем сохранённую копию.
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const url = new URL(request.url);

      // HTML и файлы приложения должны обновляться из сети.
      const isAppFile =
        request.mode === "navigate" ||
        /\.(html|js|css|json)$/i.test(url.pathname);

      if (isAppFile) {
        try {
          const response = await fetch(request, {
            cache: "no-cache"
          });

          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }

          return response;
        } catch (error) {
          const cached = await caches.match(request);

          if (cached) return cached;

          if (request.mode === "navigate") {
            return (
              await caches.match("./index.html")
            ) || Response.error();
          }

          return Response.error();
        }
      }

      // Для остальных файлов используем кэш,
      // а при отсутствии копии обращаемся к сети.
      const cached = await caches.match(request);

      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        return Response.error();
      }
    })()
  );
});
