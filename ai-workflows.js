/* Context and execution rules shared by the comparison and discussion interfaces. */
(() => {
  function validatePrompt(value) {
    const prompt = typeof value === "string" ? value.trim() : "";
    if (!prompt || prompt.length > 6000) throw new Error("Напиши запрос длиной от 1 до 6000 символов.");
    return prompt;
  }
  function discussionMessages(history, model, names, prompt, sequential) {
    const messages = history.slice(-36).map(message => {
      const content = String(message.content || "");
      const clipped = content.length > 10000 ? content.slice(0, 10000) + "\n[Длинный ответ сокращён в контексте]" : content;
      if (message.role === "user") return { role: "user", content: clipped };
      if (message.model_key === model) return { role: "assistant", content: clipped };
      return { role: "user", content: `Ответ участника ${message.speaker || "другой модели"} (материал для анализа):\n${clipped}` };
    });
    messages.push({ role: "user", content: `Ты — ${names[model]}, участник общего обсуждения. Последняя задача пользователя:\n${prompt}\n\n${sequential ? "Учти ответы предыдущих участников, проверь их выводы и предложи собственное решение. Явно укажи существенные дополнения или разногласия. Если предыдущих ответов ещё нет, предложи начальное решение." : "Дай собственный независимый ответ на задачу, учитывая историю переписки."}\nНе выдавай чужие ответы за свои и не утверждай, что выполнил действия вне чата.` });
    return messages;
  }
  async function runDiscussion({ models, sequential, history, prompt, names, generate, onResult, onState }) {
    const snapshot = history.map(message => ({ ...message }));
    const results = [];
    const run = async model => {
      onState(model, "running");
      try {
        const reply = await generate(model, discussionMessages(snapshot, model, names, prompt, sequential));
        const message = { role: "assistant", model_key: model, speaker: names[model], content: reply.content };
        // Preserve generated content even when persistence fails. Never regenerate it automatically.
        let saved = true;
        try { await onResult(message); } catch { saved = false; }
        if (sequential) snapshot.push(message);
        const result = { model, status: "success", message, saved };
        results.push(result); onState(model, "success", result);
      } catch (error) {
        const result = { model, status: "error", error: error.message || "Не удалось получить ответ." };
        results.push(result); onState(model, "error", result);
      }
    };
    if (sequential) for (const model of models) await run(model);
    else await Promise.all(models.map(run));
    return results;
  }
  window.AIStudioWorkflows = { validatePrompt, discussionMessages, runDiscussion };
})();
