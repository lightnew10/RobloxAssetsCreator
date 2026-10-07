import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getProviderRuntime, getVisionRuntime } from './providerSettings.js';
import { traceProviderEvent, traceEvent } from './trace.js';
import { parseOllamaChatStream } from './ollamaStream.js';

const ajv = new Ajv({ allErrors: true, strict: false });

function error(code, message, details = null) {
  const value = new Error(message);
  value.code = code;
  value.details = details;
  return value;
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '');
  try { return JSON.parse(raw); } catch {}
  const firstObj = raw.indexOf('{'), firstArr = raw.indexOf('[');
  const start = firstObj < 0 ? firstArr : firstArr < 0 ? firstObj : Math.min(firstObj, firstArr);
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  throw error('AI_INVALID_JSON', 'La réponse IA ne contient pas de JSON exploitable.', { preview: raw.slice(0, 800) });
}

function validate(data, schema) {
  if (!schema) return data;
  const check = ajv.compile(schema);
  if (!check(data)) throw error('AI_SCHEMA_INVALID', 'La réponse IA ne respecte pas le schéma attendu.', check.errors);
  return data;
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function normalizeImage(image) {
  if (!image) return null;
  if (typeof image === 'string') {
    const match = image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    return match ? { mimeType: match[1], data: match[2] } : { mimeType: 'image/png', data: image };
  }
  return { mimeType: image.mimeType || 'image/png', data: image.data || '' };
}

function openAiMessages(messages, images = []) {
  if (!images.length) return messages;
  const normalized = images.map(normalizeImage).filter((x) => x?.data);
  return messages.map((message, index) => {
    if (index !== messages.length - 1 || message.role !== 'user') return message;
    return {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        ...normalized.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })),
      ],
    };
  });
}

async function fetchJson(url, options, timeoutMs) {
  const timer = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: timer.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) throw error('AI_HTTP_ERROR', `Provider HTTP ${response.status}.`, { status: response.status, body: text.slice(0, 1200) });
    return payload;
  } catch (cause) {
    if (cause?.name === 'AbortError') throw error('AI_TIMEOUT', 'Le provider IA a dépassé le délai autorisé.');
    throw cause;
  } finally {
    timer.done();
  }
}

async function localChat({ runtime, messages, schema, images, traceContext = {} }) {
  const body = {
    model: runtime.textModel,
    messages: messages.map((message, index) => index === messages.length - 1 && images?.length
      ? { ...message, images: images.map(normalizeImage).filter(Boolean).map((img) => img.data) }
      : message),
    stream: true,
    format: schema || 'json',
    options: { temperature: 0.2, num_ctx: config.ollamaNumCtx },
  };
  const controller = new AbortController();
  const startedAt = Date.now();
  let reason = 'idle';
  let lastActivity = startedAt;
  let idleTimer;
  const resetIdle = () => {
    lastActivity = Date.now();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { reason = 'idle'; controller.abort(); }, config.ollamaIdleTimeoutMs);
  };
  const maxTimer = setTimeout(() => { reason = 'max_duration'; controller.abort(); }, config.ollamaMaxDurationMs);
  let lastProgress = 0;
  resetIdle();
  try {
    const response = await fetch(config.ollamaUrl.replace(/\/$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      throw error('AI_HTTP_ERROR', 'Ollama HTTP ' + response.status + ': ' + detail, { status: response.status });
    }
    return await parseOllamaChatStream(response, {
      onActivity: resetIdle,
      onProgress: async (progress) => {
        if (!traceContext.runId || Date.now() - lastProgress < 30000) return;
        lastProgress = Date.now();
        await traceEvent(traceContext.runId, 'AI_PROGRESS', {
          model: runtime.textModel,
          seconds: Math.round((Date.now() - startedAt) / 1000),
          contentCharacters: progress.contentCharacters,
          thinkingCharacters: progress.thinkingCharacters,
          chunks: progress.chunks,
          // Never store thinking content; only counters.
        }, traceContext);
      },
    });
  } catch (cause) {
    if (controller.signal.aborted || cause?.name === 'AbortError') {
      throw error('AI_TIMEOUT', 'Ollama n’a pas terminé la requête (' + reason +
        '). Modèle ' + runtime.textModel + '. Vérifie le chargement mémoire et la génération dans Ollama.', {
        model: runtime.textModel, reason, elapsedMs: Date.now() - startedAt,
        idleMs: Date.now() - lastActivity, idleTimeoutMs: config.ollamaIdleTimeoutMs,
        maxDurationMs: config.ollamaMaxDurationMs,
      });
    }
    throw cause;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
  }
}

async function openAiCompatible({ runtime, messages, schema, images, timeoutMs, url, headers = {} }) {
  const body = {
    model: runtime.textModel,
    messages: openAiMessages(messages, images),
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };
  const payload = await fetchJson(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + runtime.apiKey, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, timeoutMs);
  return { raw: payload, text: payload?.choices?.[0]?.message?.content || '', model: payload?.model || runtime.textModel, usage: payload?.usage || null };
}

async function claudeChat({ runtime, messages, images, timeoutMs }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const chat = messages.filter((m) => m.role !== 'system').map((m, index, arr) => {
    if (index !== arr.length - 1 || m.role !== 'user' || !images?.length) return { role: m.role, content: m.content };
    return {
      role: 'user',
      content: [
        { type: 'text', text: m.content },
        ...images.map(normalizeImage).filter((x) => x?.data).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } })),
      ],
    };
  });
  const payload = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': runtime.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: runtime.textModel, max_tokens: 5000, temperature: 0.2, system, messages: chat }),
  }, timeoutMs);
  return { raw: payload, text: (payload?.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n'), model: payload?.model || runtime.textModel, usage: payload?.usage || null };
}

async function geminiChat({ runtime, messages, images, timeoutMs }) {
  const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const parts = [{ text: prompt }, ...images.map(normalizeImage).filter((x) => x?.data).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }))];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(runtime.textModel)}:generateContent?key=${encodeURIComponent(runtime.apiKey)}`;
  const payload = await fetchJson(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
  }, timeoutMs);
  return { raw: payload, text: payload?.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || '', model: runtime.textModel, usage: payload?.usageMetadata || null };
}

async function callProvider({ provider, messages, schema, images = [], timeoutMs = 240000, traceContext = {}, vision = false, modelOverride = '' }) {
  const runtime = vision ? getVisionRuntime(provider) : getProviderRuntime(provider);
  if (vision && runtime.visionModel) runtime.textModel = runtime.visionModel;
  if (modelOverride) runtime.textModel = String(modelOverride).trim();
  if (provider !== 'local' && !runtime.apiKey) throw error('PROVIDER_KEY_REQUIRED', `Configure la clé API ${provider} dans Paramètres IA.`);
  if (!runtime.textModel) throw error('PROVIDER_MODEL_REQUIRED', `Configure le modèle ${provider}.`);
  const callId = randomUUID();
  await traceProviderEvent({ kind: 'request', callId, provider, model: runtime.textModel, messages, schema, images, traceContext });
  let response;
  try {
    if (provider === 'local') response = await localChat({ runtime, messages, schema, images, traceContext });
    else if (provider === 'openai') response = await openAiCompatible({ runtime, messages, schema, images, timeoutMs, url: 'https://api.openai.com/v1/chat/completions' });
    else if (provider === 'deepseek') response = await openAiCompatible({ runtime, messages, schema, images: [], timeoutMs, url: 'https://api.deepseek.com/chat/completions' });
    else if (provider === 'openrouter') response = await openAiCompatible({ runtime, messages, schema, images, timeoutMs, url: 'https://openrouter.ai/api/v1/chat/completions', headers: { 'HTTP-Referer': 'http://127.0.0.1', 'X-Title': 'RobloxAssetsCreator' } });
    else if (provider === 'claude') response = await claudeChat({ runtime, messages, images, timeoutMs });
    else if (provider === 'gemini') response = await geminiChat({ runtime, messages, images, timeoutMs });
    else throw error('PROVIDER_UNSUPPORTED', 'Provider non supporté : ' + provider);
    const data = validate(extractJson(response.text), schema);
    await traceProviderEvent({ kind: 'response', callId, provider, model: response.model, raw: response.raw, text: response.text, parsed: data, usage: response.usage, traceContext });
    return { data, meta: { provider, model: response.model, usage: response.usage } };
  } catch (cause) {
    await traceProviderEvent({ kind: 'error', callId, provider, model: runtime.textModel, error: cause, traceContext });
    throw cause;
  }
}

export async function structuredChat(options) {
  const provider = options.provider || getProviderRuntime().provider;
  return callProvider({ ...options, provider, vision: false });
}

export async function visionStructuredChat(options) {
  let provider = options.provider || getVisionRuntime().provider;
  if (provider === 'deepseek') provider = 'local';
  return callProvider({ ...options, provider, vision: true });
}

export async function providerHealth() {
  const results = {};
  try {
    const response = await fetch(config.ollamaUrl.replace(/\/$/, '') + '/api/tags');
    const payload = response.ok ? await response.json() : null;
    results.local = { ok: response.ok, models: (payload?.models || []).map((x) => x.name) };
  } catch (cause) {
    results.local = { ok: false, error: cause.message };
  }
  return results;
}
