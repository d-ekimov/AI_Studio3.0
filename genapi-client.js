/* The browser holds only a Supabase user session. Provider credentials stay on the server. */
(() => {
  const names = { chatgpt: "GPT-6 Sol", deepseek: "DeepSeek V4.1 Flash", gemini: "Gemini 3.7 Flash" };
  function context(messages) {
    const result = [];
    let length = 0;
    for (const message of messages.slice(-40).reverse()) {
      const content = message.content ?? message.text ?? "";
      if (!["user", "assistant"].includes(message.role) || !content.trim()) continue;
      if (content.length > 12000) throw new Error("Одно сообщение слишком длинное: максимум 12000 символов.");
      if (length + content.length > 60000) break;
      result.unshift({ role: message.role, content, ...(message.attachments?.length ? { attachments: message.attachments } : {}) }); length += content.length;
    }
    return result;
  }
  function create(supabase) {
    async function call(body) {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error("Войди в аккаунт AI Studio.");
      const result = await supabase.functions.invoke("genapi", { body });
      if (result.error) {
        let message;
        try { message = (await result.error.context?.json())?.error; } catch {}
        throw new Error(message || "Сервер GenAPI недоступен. Проверь публикацию функции genapi и её настройки Supabase.");
      }
      if (result.data?.error) throw new Error(result.data.error);
      return result.data;
    }
    return {
      call,
      async chat(model, messages, options = {}) { return await call({ action: "chat", model, messages: context(messages), ...(options.researchId ? { researchId: options.researchId, answerRequestId: options.answerRequestId } : {}) }); },
    };
  }
  window.AIStudioGenAPI = { create, names, context };
})();
