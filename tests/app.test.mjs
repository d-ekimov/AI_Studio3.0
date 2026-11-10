import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const flush = async () => { for (let i=0;i<8;i++) await new Promise(resolve => setImmediate(resolve)); };

function appFixture({ saveFailure = false, multi = false, generate, multiSaveFailure = false, uploadFailure = false, research = false } = {}) {
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
    querySelector(selector) {
      for (const child of this.children) {
        if (selector.startsWith(".") && child.className?.split(" ").includes(selector.slice(1))) return child;
        if (selector === "button" && child.tagName === "button") return child;
      }
      return nodes.get(selector) || new Element();
    }
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
  const rows = [], apiCalls = [], researchRequests = [];
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
        return Promise.resolve({ data: [], error: (saveFailure && table === "ai_messages" && payload?.role === "assistant" || multiSaveFailure && table === "multi_ai_messages" && payload?.role === "assistant") && op === "insert" ? { message: "save failed" } : null }).then(resolve,reject);
      },
    }; return builder;
  };
  let resolveReply;
  const deferred = new Promise(resolve => { resolveReply = resolve; });
  const uploads = [];
  const supabase = { from: query, storage: { from: () => ({ upload: async (path, blob) => { uploads.push({path,blob}); return uploadFailure ? {error:{message:"offline"}} : {data:{}}; }, remove: async () => ({data:[]}), list: async () => ({data:[]}), createSignedUrl: async () => ({data:{signedUrl:"https://storage.example/image.png"}}) }) }, auth: { getSession: async () => ({ data: { session: { user } } }), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" } }) } } };
  const document = {
    querySelector: selector => nodes.get(selector) || new Element(),
    querySelectorAll: selector => selector.includes('input[name="multiModel"]') ? modelInputs : [],
    createElement: tag => { const el = new Element(); el.tagName = tag; return el; }, addEventListener() {}, body: new Element(),
  };
  const names = { chatgpt: "GPT-6 Sol", gemini: "Gemini 3.7 Flash", deepseek: "DeepSeek V4.1 Flash" };
  const sandbox = { document, console, Blob, File, URL, crypto, confirm: () => true, setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem() { return null; }, setItem() {} }, window: { innerWidth: 1200, scrollTo() {}, location: {}, supabase: { createClient: () => supabase }, AIStudioGenAPI: { names, context: value => value, create: () => ({ chat: async (model, messages, options = {}) => { apiCalls.push({ model, messages: structuredClone(messages), options: structuredClone(options) }); return generate ? generate(model, messages) : multi ? { content: "Ответ " + model } : deferred; } }) } } };
  if (research) sandbox.window.AIStudioResearch={create:()=>({renderAnswer(){},mount:()=>({mode:()=>"web",lock(){},clear(){},offerResume(){},resume:async id=>id,prepare:async options=>{researchRequests.push(options);await options.onCreated("shared-research-job");return "shared-research-job";}})})};
  vm.runInNewContext(readFileSync(new URL("../ai-workflows.js", import.meta.url), "utf8"), sandbox);
  vm.runInNewContext(readFileSync(new URL("../chat-attachments.js", import.meta.url), "utf8"), sandbox);
  vm.runInNewContext(readFileSync(new URL("../app.js", import.meta.url), "utf8"), sandbox, { filename: "app.js" });
  return { nodes, rows, apiCalls, resolveReply, sandbox, uploads, researchRequests };
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
  const saved = f.rows.filter(r => r.table === "ai_messages");
  assert.equal(saved[0].value.chat_id, "chat-a");
  assert.equal(saved[1].value.content, "Оплаченный ответ");
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
  assert.ok(f.apiCalls[0].messages.at(-1).content.includes("Обсуди идею"));
  assert.ok(f.apiCalls[1].messages.some(m => m.content.includes("Ответ chatgpt")));
  assert.ok(f.rows.filter(r => r.table === "multi_ai_messages").every(r => r.value.chat_id === "multi-a"));
  assert.equal(f.nodes.get("#multiMessageInput").disabled, false);
  const replies = f.nodes.get("#multiMessages").children.filter(row => row.className === "multi-message-row assistant");
  assert.equal(replies.length, 2);
  assert.equal(replies[0].querySelector(".multi-message-content").textContent, "Ответ chatgpt");
  assert.equal(replies[1].querySelector(".multi-message-content").textContent, "Ответ gemini");
});
test("comparison retries only the failed model with its original prompt", async () => {
  let fail = true;
  const f = appFixture({ generate: async model => { if (model === "gemini" && fail) throw new Error("Провайдер недоступен"); return { content: "Ответ " + model }; } });
  await flush();
  f.nodes.get("#comparePrompt").value = "Исходный запрос";
  await f.nodes.get("#compareRun").listeners.click();
  assert.equal(f.apiCalls.length, 2);
  assert.equal(f.nodes.get("#compareAnswer1").textContent, "Ответ chatgpt");
  assert.equal(f.nodes.get("#compareRetry1").hidden, true);
  assert.equal(f.nodes.get("#compareRetry2").hidden, false);
  fail = false; f.nodes.get("#comparePrompt").value = "Уже другой запрос";
  await f.nodes.get("#compareRetry2").listeners.click();
  assert.equal(f.apiCalls.length, 3);
  assert.equal(f.apiCalls[2].model, "gemini");
  assert.equal(f.apiCalls[2].messages[0].content, "Исходный запрос");
  assert.equal(f.nodes.get("#compareAnswer1").textContent, "Ответ chatgpt");
});
test("comparison rejects duplicate models and locks controls while waiting", async () => {
  const f = appFixture(); await flush();
  f.nodes.get("#comparePrompt").value = "Привет";
  f.nodes.get("#compareModel2").value = "chatgpt";
  await f.nodes.get("#compareRun").listeners.click();
  assert.equal(f.apiCalls.length, 0);
  f.nodes.get("#compareModel2").value = "gemini";
  const pending = f.nodes.get("#compareRun").listeners.click(); await flush();
  assert.equal(f.nodes.get("#compareModel1").disabled, true);
  await f.nodes.get("#compareRun").listeners.click();
  assert.equal(f.apiCalls.length, 2);
  f.resolveReply({ content: "готово" }); await pending;
  assert.equal(f.nodes.get("#compareModel1").disabled, false);
});
test("multi-AI continues after one model fails and reports partial completion", async () => {
  const f = appFixture({ multi: true, generate: async model => { if (model === "chatgpt") throw new Error("Временно недоступно"); return { content: "Ответ Gemini" }; } });
  await flush(); f.nodes.get("#multiMessageInput").value = "Обсуди идею";
  await f.nodes.get("#multiChatForm").listeners.submit({ preventDefault() {} });
  assert.equal(f.apiCalls.length, 2);
  assert.match(f.nodes.get("#multiRunStatus").textContent, /1 из 2/);
  assert.equal(f.rows.filter(r => r.table === "multi_ai_messages" && r.value.role === "assistant").length, 1);
});
test("multi-AI preserves paid replies in context when saving fails", async () => {
  const f = appFixture({ multi: true, multiSaveFailure: true });
  await flush(); f.nodes.get("#multiMessageInput").value = "Обсуди идею";
  await f.nodes.get("#multiChatForm").listeners.submit({ preventDefault() {} });
  assert.equal(f.apiCalls.length, 2);
  assert.ok(f.apiCalls[1].messages.some(m => m.content.includes("Ответ chatgpt")));
  assert.match(f.nodes.get("#multiRunStatus").textContent, /несохранённые ответы/);
});
test("HTML loads gateway client before app and keeps credentials out of media forms", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="genapi-client.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="ai-workflows.js"') < html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="app.js"') < html.indexOf('src="genapi-media.js"'));
  assert.equal((html.match(/data-media-model=/g) || []).length, 3);
  assert.ok(!html.includes('id="apiKey'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});
async function pick(f, prefix, files) {
  const input=f.nodes.get(`#${prefix}FileInput`);input.files=files;input.listeners.change();await flush();
}
test("ordinary chat uploads multiple files, saves references before generation, and sends metadata",async()=>{
  const f=appFixture({generate:async()=>({content:"анализ"})});await flush();
  await pick(f,"chat",[new File(["A,42"],"data.csv",{type:"text/csv"}),new File(["document"],"note.txt",{type:"text/plain"})]);
  assert.equal(f.nodes.get("#chatAttachments").children.length,2);
  f.nodes.get("#messageInput").value="анализ";f.nodes.get("#chatForm").listeners.submit({preventDefault(){}});await flush();
  assert.equal(f.uploads.length,2);assert.equal(f.apiCalls[0].messages.at(-1).attachments.length,2);
  const saved=f.rows.find(r=>r.table==="ai_messages"&&r.value.role==="user");assert.equal(saved.value.attachments[0].name,"data.csv");
  assert.equal(f.nodes.get("#chatAttachments").children.length,0);
});
test("comparison persists one attachment set and reuses it for both independent models",async()=>{
  const f=appFixture({generate:async()=>({content:"анализ"})});await flush();await pick(f,"compare",[new File(["facts"],"note.txt",{type:"text/plain"})]);
  f.nodes.get("#comparePrompt").value="сравни";await f.nodes.get("#compareRun").listeners.click();
  assert.equal(f.uploads.length,1);assert.equal(f.apiCalls.length,2);
  assert.equal(f.apiCalls[0].messages[0].attachments[0].path,f.apiCalls[1].messages[0].attachments[0].path);
  assert.equal(f.rows.filter(r=>r.table==="multi_ai_messages"&&r.value.role==="user").length,1);
});
test("multi-AI preserves file references for every model and the saved user message",async()=>{
  const f=appFixture({multi:true});await flush();await pick(f,"multi",[new File(["facts"],"note.txt",{type:"text/plain"})]);
  f.nodes.get("#multiMessageInput").value="обсуди";await f.nodes.get("#multiChatForm").listeners.submit({preventDefault(){}});
  assert.equal(f.uploads.length,1);assert.equal(f.apiCalls.length,2);
  for(const call of f.apiCalls)assert.ok(call.messages.some(m=>m.attachments?.[0]?.name==="note.txt"));
  assert.equal(f.rows.find(r=>r.table==="multi_ai_messages"&&r.value.role==="user").value.attachments.length,1);
});
test("upload failure prevents paid generation and keeps the file available for retry",async()=>{
  const f=appFixture({uploadFailure:true});await flush();await pick(f,"chat",[new File(["facts"],"note.txt",{type:"text/plain"})]);
  f.nodes.get("#messageInput").value="анализ";f.nodes.get("#chatForm").listeners.submit({preventDefault(){}});await flush();
  assert.equal(f.apiCalls.length,0);assert.equal(f.nodes.get("#chatAttachments").children.length,1);
  assert.equal(f.nodes.get("#messageInput").disabled,false);
});
test("unsupported files are rejected and a selected file can be removed before upload",async()=>{
  const f=appFixture();await flush();await pick(f,"chat",[new File(["script"],"bad.exe",{type:"application/octet-stream"})]);
  assert.equal(f.nodes.get("#chatAttachments").children.length,0);assert.match(f.nodes.get("#chatAttachmentStatus").textContent,/не поддерживается/);
  await pick(f,"chat",[new File(["facts"],"note.txt",{type:"text/plain"})]);
  await f.nodes.get("#chatAttachments").children[0].querySelector("button").listeners.click();
  assert.equal(f.nodes.get("#chatAttachments").children.length,0);assert.equal(f.uploads.length,0);
});

test("ordinary web search links one saved user message to the shared research job",async()=>{
 const f=appFixture({research:true,generate:async()=>({content:"Verified answer",research_job_id:"shared-research-job",citations:[{label:"S1",url:"https://source.example/"}]})});await flush();
 f.nodes.get("#messageInput").value="Current information";f.nodes.get("#chatForm").listeners.submit({preventDefault(){}});await flush();
 assert.equal(f.researchRequests.length,1);assert.equal(f.apiCalls[0].options.researchId,"shared-research-job");
 assert.equal(f.apiCalls[0].options.answerRequestId,f.rows.find(r=>r.table==="ai_messages"&&r.value.role==="user").value.id);
 assert.equal(f.rows.find(r=>r.table==="ai_messages"&&r.value.role==="assistant").value.citations.length,1);
});

test("comparison searches once and shares the job across both independent models",async()=>{
 const f=appFixture({research:true,generate:async()=>({content:"Verified answer",citations:[]})});await flush();f.nodes.get("#comparePrompt").value="Compare sources";await f.nodes.get("#compareRun").listeners.click();
 assert.equal(f.researchRequests.length,1);assert.equal(f.apiCalls.length,2);assert.ok(f.apiCalls.every(call=>call.options.researchId==="shared-research-job"));
 assert.equal(new Set(f.apiCalls.map(call=>call.options.answerRequestId)).size,1);
});

test("multi-AI shares research and persists source metadata while preserving sequential context",async()=>{
 const f=appFixture({multi:true,research:true,generate:async model=>({content:"Verified "+model,research_job_id:"shared-research-job",citations:[{label:"S1",url:"https://source.example/"}]})});await flush();f.nodes.get("#multiMessageInput").value="Discuss current sources";await f.nodes.get("#multiChatForm").listeners.submit({preventDefault(){}});
 assert.equal(f.researchRequests.length,1);assert.equal(f.apiCalls.length,2);assert.ok(f.apiCalls.every(call=>call.options.researchId==="shared-research-job"));
 assert.ok(f.apiCalls[1].messages.some(message=>message.content.includes("Verified chatgpt")));
 assert.equal(f.rows.filter(row=>row.table==="multi_ai_messages"&&row.value.role==="assistant"&&row.value.research_job_id==="shared-research-job").length,2);
});
