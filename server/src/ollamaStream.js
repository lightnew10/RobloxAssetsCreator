// Ollama emits newline-delimited JSON when stream=true. Accumulate content
// but never expose or persist thinking text from the model.
function streamError(code, message, details = null) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

export async function parseOllamaChatStream(response, { onActivity = () => {}, onProgress = async () => {} } = {}) {
  if (!response?.body?.getReader) throw streamError('AI_STREAM_UNAVAILABLE', 'Ollama n’a pas fourni de réponse en streaming.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let thinkingCharacters = 0;
  let chunks = 0;
  let final = null;
  let lastProgress = 0;
  const consume = (line) => {
    if (!line.trim()) return;
    let item;
    try { item = JSON.parse(line); }
    catch { throw streamError('AI_STREAM_INVALID', 'Ollama a renvoyé un fragment JSON invalide.'); }
    if (item.error) throw streamError('AI_HTTP_ERROR', 'Ollama : ' + String(item.error));
    content += item.message?.content || '';
    thinkingCharacters += (item.message?.thinking || '').length;
    chunks++;
    if (content.length > 12_000_000) throw streamError('AI_STREAM_TOO_LARGE', 'La réponse IA dépasse la limite de sécurité.');
    if (item.done) final = item;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consume(line);
      }
      if (buffer.length > 2_000_000) throw streamError('AI_STREAM_TOO_LARGE', 'Un fragment de réponse Ollama est anormalement volumineux.');
      if (Date.now() - lastProgress > 30000) {
        lastProgress = Date.now();
        await onProgress({ contentCharacters: content.length, thinkingCharacters, chunks });
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!final) throw streamError('AI_STREAM_INCOMPLETE', 'Ollama a fermé le flux sans réponse finale.');
  return {
    raw: { ...final, message: { role: 'assistant', content }, streamed: true, thinkingCharacters, chunks },
    text: content,
    model: final.model,
    usage: {
      promptTokens: final.prompt_eval_count,
      completionTokens: final.eval_count,
      totalDurationNs: final.total_duration,
      loadDurationNs: final.load_duration,
      promptEvalDurationNs: final.prompt_eval_duration,
      evalDurationNs: final.eval_duration,
    },
  };
}
