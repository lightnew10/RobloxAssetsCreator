import { config } from './config.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const chatStatePath = path.join(config.dataRoot, 'runtime', 'telegram-chat.json');
let cachedChat = null;
let pendingResolution = null;

export function telegramConfigured(settings = config) {
  return Boolean(settings.telegramBotToken);
}

const tokenFingerprint = (token) => createHash('sha256').update(token).digest('hex');

export function uniqueStartChatIds(updates = []) {
  return [...new Set(updates.filter((update) => /^\/start(?:\s|$)/.test(update.message?.text || '') && update.message?.chat?.type === 'private')
    .map((update) => String(update.message.chat.id)))];
}

export async function resolveTelegramChatId({ settings = config, fetchImpl = fetch, statePath = chatStatePath } = {}) {
  if (!settings.telegramBotToken) return { chatId: null, reason: 'not_configured' };
  if (settings.telegramChatId) return { chatId: String(settings.telegramChatId), reason: null };
  const fingerprint = tokenFingerprint(settings.telegramBotToken);
  if (cachedChat?.fingerprint === fingerprint) return { chatId: cachedChat.chatId, reason: null };
  if (pendingResolution) return pendingResolution;
  pendingResolution = (async () => {
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      if (saved.fingerprint === fingerprint && /^-?\d+$/.test(String(saved.chatId))) {
        cachedChat = { fingerprint, chatId: String(saved.chatId) };
        return { chatId: cachedChat.chatId, reason: null };
      }
    } catch {}
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${settings.telegramBotToken}/getUpdates`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return { chatId: null, reason: `http_${response.status}` };
      const body = await response.json();
      if (body.ok !== true) return { chatId: null, reason: 'api_rejected' };
      const ids = uniqueStartChatIds(body.result);
      if (ids.length !== 1) return { chatId: null, reason: ids.length ? 'multiple_chats' : 'waiting_for_start' };
      cachedChat = { fingerprint, chatId: ids[0] };
      try {
        await mkdir(path.dirname(statePath), { recursive: true });
        await writeFile(statePath, JSON.stringify(cachedChat), { mode: 0o600 });
      } catch { console.warn('[RAC][TELEGRAM] Chat trouvé, mais mémorisation locale impossible.'); }
      return { chatId: cachedChat.chatId, reason: null };
    } catch (cause) {
      return { chatId: null, reason: cause.name === 'TimeoutError' ? 'timeout' : 'network_error' };
    }
  })();
  try { return await pendingResolution; }
  finally { pendingResolution = null; }
}

export async function sendTelegramMessage(message, { settings = config, fetchImpl = fetch, statePath = chatStatePath } = {}) {
  if (!telegramConfigured(settings)) return { delivered: false, reason: 'not_configured' };
  const recipient = await resolveTelegramChatId({ settings, fetchImpl, statePath });
  if (!recipient.chatId) return { delivered: false, reason: recipient.reason };
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: recipient.chatId, text: String(message).slice(0, 3500), link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { delivered: false, reason: `http_${response.status}` };
    const body = await response.json();
    return { delivered: body.ok === true, reason: body.ok === true ? null : 'api_rejected' };
  } catch (cause) {
    return { delivered: false, reason: cause.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
}

export async function sendCriticalAlert(message) {
  const result = await sendTelegramMessage(message);
  if (telegramConfigured() && !result.delivered) console.warn('[RAC][TELEGRAM] Alerte impossible :', result.reason);
  return result;
}

export function safeTelegramErrorCode(code) {
  const value = String(code || '').slice(0, 80);
  return /^[A-Z][A-Z0-9_:-]*$/.test(value) ? value : 'UNKNOWN_ERROR';
}

export function formatHourlyStatus(jobs, queue, now = Date.now()) {
  const happenedRecently = (timestamp) => Number.isFinite(Date.parse(timestamp)) && now - Date.parse(timestamp) <= 3600000 && now >= Date.parse(timestamp);
  const active = (jobs || []).filter((job) => ['queued', 'understanding', 'planning', 'generating', 'awaiting_decomposition_review'].includes(job.status));
  const completedVariants = (jobs || []).flatMap((job) => job.variants || []).filter((variant) => variant.status === 'done' && happenedRecently(variant.finishedAt)).length;
  const countEvents = (types) => (jobs || []).filter((job) => (job.events || []).some((entry) => types.includes(entry.type) && happenedRecently(entry.at))).length;
  return [
    'RobloxAssetsCreator — statut horaire',
    `Heure : ${new Date(now).toISOString()}`,
    `Jobs actifs : ${active.length} (file : ${queue?.queued?.length || 0}, en cours : ${queue?.active?.length || 0})`,
    `Variantes terminées depuis 1 h : ${completedVariants}`,
    `Jobs prêts pour revue depuis 1 h : ${countEvents(['job.review_ready', 'batch.target_reached'])}`,
    `Jobs en erreur depuis 1 h : ${countEvents(['job.failed'])}`,
  ].join('\n');
}

export function startTelegramMonitor({ listJobs, queueStatus, intervalMs = 3600000, send = sendTelegramMessage, timers = globalThis, settings = config } = {}) {
  if (!telegramConfigured(settings)) return () => {};
  let paired = Boolean(settings.telegramChatId);
  let pairingTimer = null;
  const deliver = async (message) => {
    const result = await send(message);
    if (!result.delivered && result.reason !== 'waiting_for_start') console.warn('[RAC][TELEGRAM] Envoi impossible :', result.reason);
    return result;
  };
  const announce = async () => {
    const result = await deliver('RobloxAssetsCreator — bot actif. Les erreurs seront signalées immédiatement et un statut sera envoyé chaque heure.');
    if (result.delivered) {
      paired = true;
      if (pairingTimer !== null) { timers.clearInterval(pairingTimer); pairingTimer = null; }
    }
  };
  void announce();
  if (!paired) pairingTimer = timers.setInterval(() => { void announce(); }, 30000);
  const timer = timers.setInterval(() => {
    void (async () => {
      try { await deliver(formatHourlyStatus(await listJobs(Infinity), queueStatus())); }
      catch (cause) { console.warn('[RAC][TELEGRAM] Statut horaire impossible :', cause.code || 'STATUS_ERROR'); }
    })();
  }, intervalMs);
  return () => { timers.clearInterval(timer); if (pairingTimer !== null) timers.clearInterval(pairingTimer); };
}
