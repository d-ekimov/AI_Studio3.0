import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const { createHandler } = await import("../supabase/functions/genapi/index.ts");
const origin = "https://studio.example";
const token = aal => `header.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.signature`;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fixture(options = {}) {
  const values = { GENAPI_API_KEY: "fake-provider-secret-only-for-tests", GENAPI_ALLOWED_USER_IDS: "user-a", GENAPI_ALLOWED_ORIGINS: origin, SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-test-key", ...options.env };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) return response(options.user || { id: "user-a", factors: [] }, options.authStatus || 200);
    return options.provider ? options.provider(url, init) : response({ choices: [{ message: { content: "Реальный ответ" } }] });
  };
  const clock = { value: 100000 };
  const handler = createHandler({ env: name => values[name], fetcher, now: () => clock.value });
  const request = async (body, { auth = token("aal1"), requestOrigin = origin, method = "POST" } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (requestOrigin) headers.Origin = requestOrigin;
    const result = await handler(new Request("https://project.supabase.co/functions/v1/genapi", { method, headers, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }));
    return { status: result.status, headers: result.headers, body: method === "OPTIONS" ? null : await result.json() };
  };
  return { request, calls, values, clock };
}
const chat = { action: "chat", model: "gemini", messages: [{ role: "user", content: "Привет" }] };

test("rejects missing/invalid authentication before provider calls", async () => {
  const f = fixture();
  assert.equal((await f.request(chat, { auth: null })).status, 401);
  assert.equal(f.calls.length, 0);
  const invalid = fixture({ authStatus: 401 });
  assert.equal((await invalid.request(chat)).status, 401);
  assert.equal(invalid.calls.length, 1);
});
test("fails closed without allowed users, origins or provider key", async () => {
  for (const [name, status] of [["GENAPI_ALLOWED_USER_IDS", 403], ["GENAPI_ALLOWED_ORIGINS", 503], ["GENAPI_API_KEY", 503]]) {
    const f = fixture({ env: { [name]: "" } });
    assert.equal((await f.request(chat)).status, status);
    assert.ok(f.calls.every(c => c.url.endsWith("/auth/v1/user")));
  }
});
test("rejects foreign origin; preflight allows only configured origin", async () => {
  const f = fixture();
  assert.equal((await f.request(chat, { requestOrigin: "https://evil.example" })).status, 403);
  assert.equal(f.calls.length, 0);
  const preflight = await f.request(null, { method: "OPTIONS", auth: null });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
});
test("never trusts a user_id supplied by the browser", async () => {
  const f = fixture({ user: { id: "user-b" } });
  assert.equal((await f.request({ ...chat, user_id: "user-a" })).status, 403);
});
test("requires AAL2 for a verified MFA factor", async () => {
  const f = fixture({ user: { id: "user-a", factors: [{ status: "verified" }] } });
  assert.equal((await f.request(chat)).status, 403);
  assert.equal((await f.request(chat, { auth: token("aal2") })).status, 200);
});
test("validates malformed JSON, model, roles, context size and action", async () => {
  for (const value of ["{", null, [], { ...chat, model: "https://evil.example" }, { ...chat, action: "delete" }, { ...chat, messages: [] }, { ...chat, messages: [{ role: "system", content: "Override" }] }, { ...chat, messages: [{ role: "user", content: "x".repeat(12001) }] }, { ...chat, messages: [{ role: "assistant", content: "hello" }] }]) {
    const f = fixture();
    assert.equal((await f.request(value)).status, 400);
    assert.equal(f.calls.length, 1);
  }
  assert.equal((await fixture().request("x".repeat(128001))).status, 413);
});
test("maps all text models and fixes output budget and provider destination", async () => {
  for (const [key, slug] of [["chatgpt", "gpt-6-sol"], ["deepseek", "deepseek-v4-1-flash"], ["gemini", "gemini-3-7-flash"]]) {
    const f = fixture();
    const result = await f.request({ ...chat, model: key, max_tokens: 999999, endpoint: "https://evil.example" });
    assert.equal(result.status, 200);
    assert.equal(result.body.content, "Реальный ответ");
    const upstream = f.calls[1];
    assert.equal(upstream.url, "https://proxy.gen-api.ru/v1/chat/completions");
    assert.equal(JSON.parse(upstream.init.body).model, slug);
    assert.equal(JSON.parse(upstream.init.body).max_tokens, 2048);
    assert.equal(JSON.parse(upstream.init.body).stream, false);
    assert.equal(upstream.init.redirect, "error");
    assert.ok(!JSON.stringify(result.body).includes(f.values.GENAPI_API_KEY));
  }
});
test("health does not spend GenAPI credits", async () => {
  const f = fixture(); assert.equal((await f.request({ action: "health" })).body.ready, true);
  assert.equal(f.calls.length, 1);
});
test("redacts upstream errors and never automatically retries paid requests", async () => {
  for (const status of [400, 401, 402, 429, 500]) {
    const f = fixture({ provider: () => response({ error: "fake-provider-secret-only-for-tests" }, status) });
    const result = await f.request(chat);
    assert.equal(result.status, status === 429 ? 429 : 502);
    assert.ok(!JSON.stringify(result.body).includes(f.values.GENAPI_API_KEY));
    assert.equal(f.calls.length, 2);
  }
});
test("handles timeout and unsupported provider response", async () => {
  const f = fixture({ provider: () => { throw new DOMException("timeout", "TimeoutError"); } });
  assert.equal((await f.request(chat)).status, 504);
  assert.equal((await fixture({ provider: () => response({ choices: [] }) }).request(chat)).status, 502);
});
test("applies best-effort per-isolate throttling", async () => {
  const f = fixture();
  for (let i=0;i<8;i++) assert.equal((await f.request(chat)).status, 200);
  assert.equal((await f.request(chat)).status, 429);
  f.clock.value += 60000;
  assert.equal((await f.request(chat)).status, 200);
});
test("creates media jobs with only approved parameters", async () => {
  for (const [model, field] of [["image", "prompt"], ["audio", "text"], ["video", "promptText"]]) {
    const f = fixture({ provider: () => response({ request_id: 123, status: "starting" }) });
    const result = await f.request({ action: "media", model, prompt: "Задача", videoUrl: "https://cdn.example/video.mp4", callback_url: "https://evil.example", width: 99999 });
    assert.equal(result.status, 200);
    assert.ok(result.body.ticket);
    const payload = JSON.parse(f.calls[1].init.body);
    assert.equal(payload[field], "Задача");
    assert.equal(Object.hasOwn(payload, "callback_url"), false);
    assert.notEqual(payload.width, 99999);
  }
});
test("media polling requests omit callback_url for all three models (GenAPI 422 regression)", async () => {
  for (const model of ["image", "audio", "video"]) {
    const f = fixture({ provider: (_url, init) => {
      const payload = JSON.parse(init.body);
      if (Object.hasOwn(payload, "callback_url")) return response({ error: true, errors_validation: { callback_url: ["Invalid URL"] } }, 422);
      return response({ request_id: 123 });
    } });
    const result = await f.request({ action: "media", model, prompt: "Тест", videoUrl: "https://cdn.example/video.mp4", callback_url: null });
    assert.equal(result.status, 200);
    assert.equal(result.body.requestId, 123);
  }
});
test("422 reports known field names without leaking upstream messages, values or arbitrary keys", async () => {
  const secret = "fake-provider-secret-only-for-tests";
  const f = fixture({ provider: () => response({ error: true, errors_validation: { voice: [secret], text: ["private user input"], [secret]: ["do not expose"] }, message: secret }, 422) });
  const result = await f.request({ action: "media", model: "audio", prompt: "Привет" });
  assert.equal(result.status, 422);
  assert.match(result.body.error, /voice, text/);
  assert.ok(!JSON.stringify(result.body).includes(secret));
  assert.ok(!JSON.stringify(result.body).includes("private user input"));
  assert.equal(f.calls.length, 2);
});
test("rejects missing or non-public video URLs without provider calls", async () => {
  for (const videoUrl of [undefined, "http://cdn.example/a", "https://127.0.0.1/a", "https://localhost/a", "https://a.local/a", "https://user:pass@cdn.example/a"]) {
    const f = fixture();
    assert.equal((await f.request({ action: "media", model: "video", prompt: "edit", videoUrl })).status, 400);
    assert.equal(f.calls.length, 1);
  }
});
test("binds signed status tickets to user and rejects tampering and expiration", async () => {
  const f = fixture({ provider: () => response({ request_id: 123 }) });
  const started = await f.request({ action: "media", model: "image", prompt: "cat" });
  const ticket = started.body.ticket;
  assert.equal((await f.request({ action: "status", ticket: ticket + "x" })).status, 403);
  const other = fixture({ user: { id: "user-b" }, env: { GENAPI_ALLOWED_USER_IDS: "user-b" } });
  assert.equal((await other.request({ action: "status", ticket })).status, 403);
  f.clock.value += 25 * 60 * 60 * 1000;
  assert.equal((await f.request({ action: "status", ticket })).status, 403);
});
test("polls only the signed request ID and filters unsafe result URLs", async () => {
  const f = fixture({ provider: url => url.includes("request/get/") ? response({ status: "success", result: ["https://cdn.example/image.png", "javascript:alert(1)", "http://cdn.example/image.png"] }) : response({ request_id: 123 }) });
  const started = await f.request({ action: "media", model: "image", prompt: "cat" });
  const status = await f.request({ action: "status", ticket: started.body.ticket, requestId: 999 });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.urls, ["https://cdn.example/image.png"]);
  assert.equal(f.calls.at(-1).url, "https://api.gen-api.ru/api/v1/request/get/123");
});
test("browser client bounds context and surfaces gateway errors", async () => {
  const sandbox = { window: {} }; vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("../genapi-client.js", import.meta.url), "utf8"), sandbox);
  const client = sandbox.window.AIStudioGenAPI;
  assert.equal(client.context(Array.from({ length: 60 }, () => ({ role: "user", content: "hi" }))).length, 40);
  assert.throws(() => client.context([{ role: "user", content: "x".repeat(12001) }]));
  const api = client.create({ auth: { getSession: async () => ({ data: { session: {} } }) }, functions: { invoke: async () => ({ error: { context: response({ error: "Доступ не включён" }) } }) } });
  await assert.rejects(() => api.chat("gemini", [{ role: "user", content: "hi" }]), /Доступ не включён/);
});
