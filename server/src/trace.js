import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const secretKey = /(authorization|api[_-]?key|token|password|secret|cookie)/i;
const bearer = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

function safe(value) {
  return String(value ?? 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'unknown';
}
function redact(value, key = '') {
  if (secretKey.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((x) => redact(x));
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value === 'string') return value.replace(bearer, 'Bearer [REDACTED]');
  return value;
}
function dir(runId) { return path.join(config.tracesRoot, safe(runId)); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function traceEnabled(level = config.traceLevel) {
  return level === 'full' || level === 'basic';
}

export async function traceEvent(runId, eventType, payload = {}, context = {}) {
  if (!traceEnabled(context.traceLevel || config.traceLevel) || !runId) return null;
  const directory = dir(runId);
  await mkdir(directory, { recursive: true });
  const event = {
    id: randomUUID(),
    at: new Date().toISOString(),
    runId,
    eventType,
    phase: context.phase || null,
    variantId: context.variantId || null,
    attempt: context.attempt || null,
    payload: redact(payload),
  };
  await appendFile(path.join(directory, 'events.jsonl'), JSON.stringify(event) + '\n', 'utf8');
  await appendFile(path.join(directory, 'timeline.md'), `[${event.at}] ${event.eventType}${event.phase ? ' · ' + event.phase : ''}${event.variantId ? ' · ' + event.variantId : ''}\n`, 'utf8');
  return event;
}

export async function traceArtifact(runId, category, name, data, context = {}) {
  if (!traceEnabled(context.traceLevel || config.traceLevel) || !runId) return null;
  const directory = path.join(dir(runId), safe(category));
  await mkdir(directory, { recursive: true });
  const id = randomUUID();
  const isBuffer = Buffer.isBuffer(data);
  const body = isBuffer ? data : Buffer.from(typeof data === 'string' ? redact(data) : JSON.stringify(redact(data), null, 2), 'utf8');
  const ext = context.extension || (context.mimeType === 'image/png' ? 'png' : context.mimeType === 'image/jpeg' ? 'jpg' : isBuffer ? 'bin' : 'json');
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe(name)}_${id}.${safe(ext)}`;
  const file = path.join(directory, fileName);
  await writeFile(file, body);
  const entry = { id, category, name, path: path.relative(dir(runId), file).replaceAll('\\', '/'), size: body.length, sha256: hash(body), mimeType: context.mimeType || (isBuffer ? 'application/octet-stream' : 'application/json'), at: new Date().toISOString() };
  await appendFile(path.join(dir(runId), 'artifacts.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

export async function traceProviderEvent(event = {}) {
  const runId = event.traceContext?.runId;
  if (!runId) return;
  const context = { ...event.traceContext, phase: event.traceContext?.phase || 'ai' };
  if (event.kind === 'request') {
    const artifact = await traceArtifact(runId, 'ai_requests', event.provider + '_request', {
      callId: event.callId,
      provider: event.provider,
      model: event.model,
      messages: event.messages,
      schema: event.schema,
      images: (event.images || []).map((img) => ({ mimeType: img?.mimeType || 'image/png', bytes: img?.data ? Math.round(img.data.length * 0.75) : 0 })),
    }, context);
    await traceEvent(runId, 'AI_REQUEST', { provider: event.provider, model: event.model, artifactId: artifact?.id }, context);
  } else if (event.kind === 'response') {
    const raw = await traceArtifact(runId, 'ai_responses', event.provider + '_raw', event.raw, context);
    const parsed = await traceArtifact(runId, 'ai_responses', event.provider + '_parsed', { text: event.text, parsed: event.parsed, usage: event.usage }, context);
    await traceEvent(runId, 'AI_RESPONSE', { provider: event.provider, model: event.model, rawArtifact: raw?.id, parsedArtifact: parsed?.id }, context);
  } else if (event.kind === 'error') {
    const artifact = await traceArtifact(runId, 'errors', event.provider + '_error', {
      provider: event.provider, model: event.model, code: event.error?.code, message: event.error?.message, details: event.error?.details, stack: event.error?.stack,
    }, context);
    await traceEvent(runId, 'AI_ERROR', { provider: event.provider, code: event.error?.code, message: event.error?.message, artifactId: artifact?.id }, context);
  }
}

export async function readTrace(runId, limit = 500) {
  try {
    const text = await readFile(path.join(dir(runId), 'events.jsonl'), 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
  } catch { return []; }
}
export async function readTraceArtifacts(runId, limit = 500) {
  try {
    const text = await readFile(path.join(dir(runId), 'artifacts.jsonl'), 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
  } catch { return []; }
}
export async function resolveTraceArtifact(runId, artifactId) {
  const artifacts = await readTraceArtifacts(runId, 5000);
  const item = artifacts.find((entry) => entry.id === artifactId);
  if (!item) throw Object.assign(new Error('Artifact de trace introuvable.'), { code: 'TRACE_ARTIFACT_NOT_FOUND' });
  const root = path.resolve(dir(runId));
  const absolute = path.resolve(root, item.path);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) throw Object.assign(new Error('Chemin de trace invalide.'), { code: 'TRACE_PATH_INVALID' });
  return { ...item, absolute };
}

export function traceDirectory(runId) { return dir(runId); }
