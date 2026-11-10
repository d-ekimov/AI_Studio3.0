import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const flush = async () => { for (let i=0;i<8;i++) await new Promise(resolve => setImmediate(resolve)); };

function appFixture({ saveFailure = false, multi = false } = {}) {
  class Element {
    constructor() { this.listeners = {}; this.style = {}; this.dataset = {}; this.children = []; this.value = ""; this.checked = false; this.disabled = false; this.textContent = ""; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    focus() {}
    remove() {}
    contains() { return false; }
    querySelector(selector) { return nodes.get(selector) || new Element(); }
    querySelectorAll() { return []; }
    closest() { return new Element(); }
  }
  const nodes = new Map();
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set("#" + match[1], new Element());
  for (const selector of ["#chatForm button[type='submit']", "#multiChatForm button[type='submit']", ".model-select-wrap .provider-icon"]) nodes.set(selector, new Element());
  nodes.get("#modelSelect").value = "gemini";
  nodes.get("#compareModel1").value = "chatgpt"; nodes.get("#compareModel2").value = "gemini";
  nodes.get("#taskFilter").value = "all";
  nodes.get("#multiAutoMode").checked = true;
  const modelInputs = [{ value: "chatgpt", checked: true }, { value: "gemini", checked: true }];
  const rows = [], apiCalls = [];
  const user = { id: "user-a", email: "a@example.test", user_metadata: {} };
  const query = table => {
    let op = "select", payload = null;
    const filters = [];
    const builder = {
      select() { return builder; }, insert(value) { op = "insert"; payload = value; rows.push({ table, value }); return builder; },
      update() { op = "update"; return builder; }, delete() { return builder; },
      eq(key, value) { filters.push([key,value]); return builder; }, order() { return builder; }, in() { return builder; }, limit() { return builder; },
      single: async () => ({ data: { id: table === "ai_chats" ? "chat-a" : "multi-a", ...payload } }),
      maybeSingle: async () => ({ data: null }),
      then(resolve, reject) {
        if (table === "multi_ai_messages" && op === "select") {
          const id = filters.find(([key]) => key === "chat_id")?.[1];
          if (id !== "multi-a") return Promise.reject(new Error("Wrong multi conversation ID: " + id)).then(resolve,reject);
          return Promise.resolve({ data: rows.filter(r => r.table === table && r.value.chat_id === id).map(r => r.value) }).then(resolve,reject);
        }
        return Promise.resolve({ data: [], error: saveFailure && table === "ai_messages" && op === "insert" ? { message: "save failed" } : null }).then(resolve,reject);
      },
    }; return builder;
  };
  let resolveReply;
  const deferred = new Promise(resolve => { resolveReply = resolve; });
  const supabase = { from: query, auth: { getSession: async () => ({ data: { session: { user } } }), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" } }) } } };
  const document = {
    querySelector: selector => nodes.get(selector) || new Element(),
    querySelectorAll: selector => selector.includes('input[name="multiModel"]') ? modelInputs : [],
    createElement: () => new Element(), addEventListener() {}, body: new Element(),
  };
  const names = { chatgpt: "GPT-6 Sol", gemini: "Gemini 3.7 Flash", deepseek: "DeepSeek V4.1 Flash" };
  const sandbox = { document, console, confirm: () => true, setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem() { return null; }, setItem() {} }, window: { innerWidth: 1200, scrollTo() {}, location: {}, supabase: { createClient: () => supabase }, AIStudioGenAPI: { names, context: value => value, create: () => ({ chat: async (model, messages) => { apiCalls.push({ model, messages: structuredClone(messages) }); return multi ? { content: "Ответ " + model } : deferred; } }) } } };
  vm.runInNewContext(readFileSync(new URL("../app.js", import.meta.url), "utf8"), sandbox, { filename: "app.js" });
  return { nodes, rows, apiCalls, resolveReply, sandbox };
}

test("ordinary chat locks duplicate submission and navigation during a paid call", async () => {
  const f = appFixture(); await flush();
  f.nodes.get("#messageInput").value = "Привет";
  const submit = f.nodes.get("#chatForm").listeners.submit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  await flush();
  assert.equal(f.apiCalls.length, 1);
  assert.equal(f.nodes.get("#messageInput").disabled, true);
  f.nodes.get("#newChat").listeners.click();
  f.resolveReply({ content: "Оплаченный ответ" }); await flush();
  const saved = f.rows.find(r => r.table === "ai_messages");
  assert.equal(saved.value[0].chat_id, "chat-a");
  assert.equal(saved.value[1].content, "Оплаченный ответ");
  assert.equal(f.nodes.get("#messageInput").disabled, false);
});
test("paid response remains visible after history save failure without API retry", async () => {
  const f = appFixture({ saveFailure: true }); await flush();
  f.nodes.get("#messageInput").value = "Привет";
  f.nodes.get("#chatForm").listeners.submit({ preventDefault() {} }); await flush();
  f.resolveReply({ content: "Скопируй меня" }); await flush();
  assert.equal(f.apiCalls.length, 1);
  assert.equal(f.nodes.get("#messages").children.at(-1).children[1].textContent, "Скопируй меня");
  assert.match(f.nodes.get("#toast").textContent, /история не сохранена/);
});
test("sequential multi-AI uses the captured chat ID and passes previous answers", async () => {
  const f = appFixture({ multi: true }); await flush();
  f.nodes.get("#multiMessageInput").value = "Обсуди идею";
  const submit = f.nodes.get("#multiChatForm").listeners.submit;
  const pending = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  await pending;
  assert.equal(f.apiCalls.length, 2);
  assert.equal(f.apiCalls[0].messages.at(-1).content, "Обсуди идею");
  assert.ok(f.apiCalls[1].messages.some(m => m.content.includes("Ответ chatgpt")));
  assert.ok(f.rows.filter(r => r.table === "multi_ai_messages").every(r => r.value.chat_id === "multi-a"));
  assert.equal(f.nodes.get("#multiMessageInput").disabled, false);
});
test("HTML loads gateway client before app and keeps credentials out of media forms", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="genapi-client.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="app.js"') < html.indexOf('src="genapi-media.js"'));
  assert.equal((html.match(/data-media-model=/g) || []).length, 3);
  assert.ok(!html.includes('id="apiKey'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});
