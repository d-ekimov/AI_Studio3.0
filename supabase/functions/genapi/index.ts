// No provider SDK or privileged database client is needed by this gateway.
// Kept in standard JavaScript syntax so its security paths can also run in Node tests.
class GatewayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MODELS = Object.freeze({
  chatgpt: "gpt-6-sol",
  deepseek: "deepseek-v4-1-flash",
  gemini: "gemini-3-7-flash",
  image: "recraft-v4-1",
  video: "runway-gen-4-aleph",
  audio: "eleven-v4",
});
const encoder = new TextEncoder();
const csv = (value) => (value || "").split(",").map(v => v.trim()).filter(Boolean);
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const unbase64url = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

function text(value, name, limit = 6000) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new GatewayError(400, `Поле ${name}: требуется текст до ${limit} символов.`);
  }
  return value.trim();
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 40) {
    throw new GatewayError(400, "Допускается от 1 до 40 сообщений.");
  }
  const clean = messages.map(m => {
    if (!m || !["user", "assistant"].includes(m.role)) throw new GatewayError(400, "Недопустимая роль сообщения.");
    return { role: m.role, content: text(m.content, "сообщение", 12000) };
  });
  if (clean.reduce((sum, m) => sum + m.content.length, 0) > 60000 || clean.at(-1).role !== "user") {
    throw new GatewayError(400, "Сократи контекст; последнее сообщение должно быть от пользователя.");
  }
  return clean;
}

function videoUrl(value) {
  let url;
  try { url = new URL(text(value, "ссылка на видео", 2048)); } catch { throw new GatewayError(400, "Укажи HTTPS-ссылку на исходное видео."); }
  // The gateway never fetches this URL itself. Disallow obvious local targets and credentials.
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) ||
      url.hostname.includes(":") || /\.(local|internal|localhost)$/.test(url.hostname)) {
    throw new GatewayError(400, "Нужна публичная HTTPS-ссылка на видео без пароля.");
  }
  return url.href;
}

function mediaInput(body) {
  const prompt = text(body.prompt, "запрос", body.model === "audio" ? 3000 : 6000);
  if (body.model === "image") return { prompt, model: "flash", width: 1024, height: 1024, enable_safey_checker: true };
  if (body.model === "video") return { promptText: prompt, videoUri: videoUrl(body.videoUrl), model: "gen4_aleph", ratio: "1280:720" };
  if (body.model === "audio") return { text: prompt, voice: "Alice", language_code: "ru", turbo: true, output_format: "mp3_44100_128" };
  throw new GatewayError(400, "Неизвестная медиа-модель.");
}

function outputUrls(data) {
  const candidates = data.result ?? data.output ?? [];
  const values = Array.isArray(candidates) ? candidates : [candidates];
  return values.map(v => typeof v === "string" ? v : v?.url).filter(v => {
    if (typeof v !== "string") return false;
    try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
  }).slice(0, 8);
}

export function createHandler({ env = name => Deno.env.get(name), fetcher = fetch, now = Date.now } = {}) {
  // Best-effort local throttling, NOT a durable quota or billing system.
  const windows = new Map();
  const inFlight = new Map();
  const keyForTickets = async secret => crypto.subtle.importKey("raw", encoder.encode(`genapi-ticket-v1:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  async function ticket(secret, userId, requestId, model) {
    const payload = base64url(encoder.encode(JSON.stringify({ userId, requestId, model, expires: now() + 24 * 60 * 60 * 1000 })));
    const signature = await crypto.subtle.sign("HMAC", await keyForTickets(secret), encoder.encode(payload));
    return `${payload}.${base64url(new Uint8Array(signature))}`;
  }
  async function readTicket(secret, userId, value) {
    try {
      if (typeof value !== "string" || value.length > 2048) throw new Error();
      const [payload, signature, extra] = value.split(".");
      if (extra || !await crypto.subtle.verify("HMAC", await keyForTickets(secret), unbase64url(signature), encoder.encode(payload))) throw new Error();
      const data = JSON.parse(new TextDecoder().decode(unbase64url(payload)));
      if (data.userId !== userId || data.expires <= now() || !/^\d+$/.test(String(data.requestId)) || !["image", "video", "audio"].includes(data.model)) throw new Error();
      return data;
    } catch { throw new GatewayError(403, "Недействительный или просроченный доступ к результату."); }
  }
  async function provider(path, apiKey, body) {
    const isChat = path === "chat";
    const response = await fetcher(isChat ? "https://proxy.gen-api.ru/v1" : `https://api.gen-api.ru/api/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(isChat ? 90000 : 25000),
      redirect: "error",
    });
    // Never return raw upstream errors, request headers, inputs or secrets to the browser/log.
    if (!response.ok) {
      const hints = { 401: "Проверь ключ GenAPI в Secrets Supabase.", 402: "Недостаточно средств на GenAPI.", 429: "GenAPI ограничил частоту запросов. Подожди перед новой попыткой." };
      throw new GatewayError(response.status === 429 ? 429 : 502, hints[response.status] || `GenAPI отклонил запрос (HTTP ${response.status}). Проверь модель и параметры.`);
    }
    return await response.json();
  }

  return async request => {
    const origin = request.headers.get("origin");
    const origins = csv(env("GENAPI_ALLOWED_ORIGINS"));
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
    if (origin && origins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
    let runningUser;
    try {
      if (!origins.length) throw new GatewayError(503, "Настрой GENAPI_ALLOWED_ORIGINS в Secrets Supabase.");
      if (origin && !origins.includes(origin)) throw new GatewayError(403, "Этот адрес сайта не разрешён.");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "POST") throw new GatewayError(405, "Используй POST.");
      const authorization = request.headers.get("authorization") || "";
      if (!/^Bearer [\w.-]+$/.test(authorization)) throw new GatewayError(401, "Войди в аккаунт AI Studio.");
      const supabaseUrl = env("SUPABASE_URL");
      const supabaseKey = env("SUPABASE_ANON_KEY");
      if (!supabaseUrl || !supabaseKey) throw new GatewayError(503, "Не настроено окружение Supabase.");
      // Do not trust a decoded JWT, a client user_id or the public application key.
      const authResponse = await fetcher(`${supabaseUrl}/auth/v1/user`, {
        headers: { authorization, apikey: supabaseKey }, signal: AbortSignal.timeout(10000), redirect: "error",
      });
      if (!authResponse.ok) throw new GatewayError(401, "Сессия истекла. Войди повторно.");
      const user = await authResponse.json();
      if (!user.id) throw new GatewayError(401, "Не удалось подтвердить пользователя.");
      if (!csv(env("GENAPI_ALLOWED_USER_IDS")).includes(user.id)) {
        throw new GatewayError(403, "Доступ к GenAPI ещё не включён для этого аккаунта.");
      }
      if ((user.factors || []).some(f => f.status === "verified")) {
        let claims;
        try { claims = JSON.parse(new TextDecoder().decode(unbase64url(authorization.slice(7).split(".")[1]))); } catch { throw new GatewayError(401, "Некорректная сессия."); }
        if (claims.aal !== "aal2") throw new GatewayError(403, "Подтверди вход кодом двухфакторной защиты.");
      }
      const raw = await request.text();
      if (encoder.encode(raw).length > 128000) throw new GatewayError(413, "Слишком большой запрос.");
      let body;
      try { body = JSON.parse(raw); } catch { throw new GatewayError(400, "Некорректный JSON."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new GatewayError(400, "Некорректный запрос.");
      const apiKey = env("GENAPI_API_KEY");
      if (!apiKey) throw new GatewayError(503, "В Secrets Supabase отсутствует GENAPI_API_KEY.");
      if (body.action === "health") return json(200, { ready: true, models: MODELS });
      if (body.action === "status") {
        const job = await readTicket(apiKey, user.id, body.ticket);
        const result = await provider(`request/get/${job.requestId}`, apiKey);
        const failed = ["error", "failed"].includes(result.status);
        if (failed) throw new GatewayError(502, "GenAPI не выполнил задачу. Проверь её статус в личном кабинете GenAPI.");
        return json(200, { requestId: job.requestId, model: job.model, status: result.status === "success" ? "success" : "processing", urls: result.status === "success" ? outputUrls(result) : [] });
      }
      if (!["chat", "media"].includes(body.action)) throw new GatewayError(400, "Неизвестное действие.");
      const slug = MODELS[body.model];
      if (!slug) throw new GatewayError(400, "Неизвестная модель.");
      let payload;
      if (body.action === "chat") {
        if (!["chatgpt", "deepseek", "gemini"].includes(body.model)) throw new GatewayError(400, "Выбери текстовую модель.");
        payload = { model: slug, messages: validateMessages(body.messages), max_tokens: 2048, stream: false };
      } else {
        payload = { ...mediaInput(body), callback_url: null };
      }
      const minute = Math.floor(now() / 60000);
      if (windows.size > 1000) for (const [id, window] of windows) if (window.minute !== minute) windows.delete(id);
      const window = windows.get(user.id) || { minute, count: 0 };
      if (window.minute !== minute) { window.minute = minute; window.count = 0; }
      if (window.count >= 8 || (inFlight.get(user.id) || 0) >= 3) throw new GatewayError(429, "Слишком много запросов. Дождись завершения или попробуй через минуту.");
      window.count++; windows.set(user.id, window);
      inFlight.set(user.id, (inFlight.get(user.id) || 0) + 1); runningUser = user.id;
      const result = await provider(body.action === "chat" ? "chat" : `networks/${slug}`, apiKey, payload);
      if (body.action === "chat") {
        const content = result.choices?.[0]?.message?.content;
        const answer = typeof content === "string" ? content : Array.isArray(content) ? content.map(p => p.text || "").join("") : "";
        if (!answer.trim() || answer.length > 100000) throw new GatewayError(502, "GenAPI вернул пустой или неподдерживаемый ответ.");
        return json(200, { content: answer, model: slug });
      }
      const requestId = result.request_id ?? result.id;
      if (!/^\d+$/.test(String(requestId))) throw new GatewayError(502, "GenAPI не вернул ID задачи. Проверь личный кабинет перед повторной отправкой.");
      return json(200, { requestId, ticket: await ticket(apiKey, user.id, requestId, body.model), model: body.model });
    } catch (error) {
      if (error instanceof GatewayError) return json(error.status, { error: error.message });
      if (["TimeoutError", "AbortError"].includes(error?.name)) return json(504, { error: "Время ожидания истекло. Задача могла быть принята GenAPI; проверь кабинет перед повтором." });
      return json(502, { error: "Не удалось выполнить запрос. Проверь подключение и кабинет GenAPI перед повтором." });
    } finally {
      if (runningUser) { const count = (inFlight.get(runningUser) || 1) - 1; if (count) inFlight.set(runningUser, count); else inFlight.delete(runningUser); }
    }
  };
}

if (typeof Deno !== "undefined") Deno.serve(createHandler());
