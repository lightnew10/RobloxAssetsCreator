import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatHourlyStatus, resolveTelegramChatId, safeTelegramErrorCode, sendTelegramMessage, startTelegramMonitor, uniqueStartChatIds } from '../src/telegram.js';

const settings = { telegramBotToken: 'local-test-token', telegramChatId: '123' };

test('Telegram sends to the configured chat and does not expose the token in failures', async () => {
  let request;
  const result = await sendTelegramMessage('test', { settings, fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true }) };
  } });
  assert.deepEqual(result, { delivered: true, reason: null });
  assert.equal(request.url, 'https://api.telegram.org/botlocal-test-token/sendMessage');
  assert.deepEqual(JSON.parse(request.options.body).chat_id, '123');
  assert.equal((await sendTelegramMessage('test', { settings, fetchImpl: async () => { throw new Error('local-test-token leaked'); } })).reason, 'network_error');
  assert.equal((await sendTelegramMessage('test', { settings: {}, fetchImpl: async () => { throw new Error('should not call'); } })).reason, 'not_configured');
  assert.equal(safeTelegramErrorCode('ECONNREFUSED'), 'ECONNREFUSED');
  assert.equal(safeTelegramErrorCode('secret=local-test-token'), 'UNKNOWN_ERROR');
});

test('one private /start pairs from the token and persists the chat without the token', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rac-telegram-'));
  const statePath = path.join(dir, 'chat.json');
  const tokenOnly = { telegramBotToken: 'pairing-test-token', telegramChatId: '' };
  const updates = [{ message: { text: '/start', chat: { id: 123, type: 'private' } } }, { message: { text: '/start', chat: { id: 123, type: 'private' } } }, { message: { text: '/start', chat: { id: -4, type: 'group' } } }];
  try {
    assert.deepEqual(uniqueStartChatIds(updates), ['123']);
    const paired = await resolveTelegramChatId({ settings: tokenOnly, statePath, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: updates }) }) });
    assert.deepEqual(paired, { chatId: '123', reason: null });
    const saved = await readFile(statePath, 'utf8');
    assert.equal(saved.includes('pairing-test-token'), false);
    assert.equal(JSON.parse(saved).chatId, '123');
    let sentTo;
    const result = await sendTelegramMessage('test', { settings: tokenOnly, statePath, fetchImpl: async (_url, options) => { sentTo = JSON.parse(options.body).chat_id; return { ok: true, json: async () => ({ ok: true }) }; } });
    assert.equal(result.delivered, true);
    assert.equal(sentTo, '123');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('multiple private chats require an explicit recipient; persisted pairing belongs to its token', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rac-telegram-'));
  const statePath = path.join(dir, 'chat.json');
  const token = 'different-test-token';
  try {
    await writeFile(statePath, JSON.stringify({ fingerprint: createHash('sha256').update('another-token').digest('hex'), chatId: '999' }));
    const result = await resolveTelegramChatId({ settings: { telegramBotToken: token }, statePath, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: [
      { message: { text: '/start', chat: { id: 1, type: 'private' } } },
      { message: { text: '/start', chat: { id: 2, type: 'private' } } },
    ] }) }) });
    assert.deepEqual(result, { chatId: null, reason: 'multiple_chats' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a saved chat is restored for the same token without polling Telegram', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rac-telegram-'));
  const statePath = path.join(dir, 'chat.json');
  const token = 'restore-test-token';
  try {
    await writeFile(statePath, JSON.stringify({ fingerprint: createHash('sha256').update(token).digest('hex'), chatId: '456' }));
    assert.deepEqual(await resolveTelegramChatId({ settings: { telegramBotToken: token }, statePath, fetchImpl: async () => { throw new Error('unexpected polling'); } }), { chatId: '456', reason: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('hourly status counts recent variants, failed jobs and queue positions', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const text = formatHourlyStatus([
    { status: 'generating', updatedAt: '2026-10-08T11:45:00Z', variants: [{ status: 'done', finishedAt: '2026-10-08T11:40:00Z' }] },
    { status: 'failed', updatedAt: '2026-10-08T11:30:00Z', events: [{ type: 'job.failed', at: '2026-10-08T11:30:00Z' }] },
    { status: 'review_ready', updatedAt: '2026-10-08T10:00:00Z' },
  ], { queued: ['a'], active: ['b'] }, now);
  assert.match(text, /Jobs actifs : 1 \(file : 1, en cours : 1\)/);
  assert.match(text, /Variantes terminées depuis 1 h : 1/);
  assert.match(text, /Jobs en erreur depuis 1 h : 1/);
  assert.match(text, /Jobs prêts pour revue depuis 1 h : 0/);
});

test('Telegram monitor sends startup and hourly messages, then stops its timer', async () => {
  const messages = [];
  let tick;
  let cleared = false;
  const stop = startTelegramMonitor({ settings, listJobs: async () => [], queueStatus: () => ({ queued: [], active: [] }), send: async (message) => { messages.push(message); return { delivered: true }; }, timers: { setInterval(fn, ms) { assert.equal(ms, 3600000); tick = fn; return 1; }, clearInterval(id) { assert.equal(id, 1); cleared = true; } } });
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 2);
  assert.match(messages[0], /bot actif/);
  assert.match(messages[1], /statut horaire/);
  stop();
  assert.equal(cleared, true);
});

test('token-only monitor retries pairing after /start', async () => {
  const messages = [];
  const callbacks = new Map();
  const cleared = [];
  let attempts = 0;
  const stop = startTelegramMonitor({ settings: { telegramBotToken: 'poll-test-token' }, listJobs: async () => [], queueStatus: () => ({ queued: [], active: [] }), send: async (message) => {
    attempts += 1;
    if (attempts === 1) return { delivered: false, reason: 'waiting_for_start' };
    messages.push(message);
    return { delivered: true, reason: null };
  }, timers: { setInterval(fn, ms) { callbacks.set(ms, fn); return ms; }, clearInterval(id) { cleared.push(id); } } });
  await new Promise((resolve) => setImmediate(resolve));
  callbacks.get(30000)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 1);
  assert.deepEqual(cleared, [30000]);
  stop();
  assert.deepEqual(cleared, [30000, 3600000]);
});
