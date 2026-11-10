import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(new URL("../ai-workflows.js", import.meta.url), "utf8"), sandbox);
const { runDiscussion, discussionMessages, validatePrompt } = sandbox.window.AIStudioWorkflows;
const names = { chatgpt: "GPT", gemini: "Gemini", deepseek: "DeepSeek" };

test("parallel models get the same history without seeing each other's current replies", async () => {
  const requests = [];
  const history = [{ role: "user", content: "задача" }];
  await runDiscussion({ models: ["chatgpt", "gemini"], sequential: false, history, prompt: "задача", names,
    generate: async (model, messages) => { requests.push({ model, messages }); return { content: "NEW " + model }; },
    onResult: async message => history.push(message), onState() {} });
  assert.equal(requests.length, 2);
  for (const r of requests) assert.ok(r.messages.every(m => !m.content.includes("NEW")));
});
test("sequential context distinguishes own responses from other participants", () => {
  const messages = discussionMessages([
    { role: "assistant", model_key: "chatgpt", speaker: "GPT", content: "свой ответ" },
    { role: "assistant", model_key: "gemini", speaker: "Gemini", content: "чужой ответ" },
  ], "chatgpt", names, "задача", true);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /Gemini/);
  assert.equal(messages.at(-1).role, "user");
  assert.match(messages.at(-1).content, /Ты — GPT/);
});
test("long prior responses are bounded without changing stored history", () => {
  const history = [{ role: "assistant", model_key: "gemini", content: "x".repeat(30000) }];
  const messages = discussionMessages(history, "chatgpt", names, "задача", true);
  assert.ok(messages[0].content.length < 12000);
  assert.equal(history[0].content.length, 30000);
  assert.throws(() => validatePrompt("x".repeat(6001)));
});
