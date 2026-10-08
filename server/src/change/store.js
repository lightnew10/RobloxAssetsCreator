import { mkdir, readFile, rename, unlink, writeFile, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';

const root = path.join(config.dataRoot, 'runtime');
const locks = new Map();
const fileFor = (name) => path.join(root, `${name}.jsonl`);
async function renameWithRetry(source, destination) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try { await rename(source, destination); return; }
    catch (cause) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(cause.code) || attempt === 11) throw cause;
      await new Promise((resolve) => setTimeout(resolve, Math.min(750, 40 * 2 ** attempt)));
    }
  }
}
function queued(file, task) {
  const previous = locks.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(file, next);
  return next.finally(() => { if (locks.get(file) === next) locks.delete(file); });
}
async function appendAtomic(name, entry, destination = fileFor(name)) {
  return queued(destination, async () => {
    await mkdir(path.dirname(destination), { recursive: true });
    const temp = `${destination}.${randomUUID()}.tmp`;
    try {
      try { await copyFile(destination, temp); }
      catch (cause) { if (cause.code !== 'ENOENT') throw cause; await writeFile(temp, ''); }
      const { appendFile } = await import('node:fs/promises');
      await appendFile(temp, JSON.stringify(entry) + '\n', 'utf8');
      await renameWithRetry(temp, destination);
    } finally { await unlink(temp).catch((cause) => { if (cause.code !== 'ENOENT') throw cause; }); }
    return entry;
  });
}
export const recordGeneration = (entry, options = {}) => appendAtomic('generations', entry, options.destination);
export const recordFeedback = (entry, options = {}) => appendAtomic('feedback', entry, options.destination);
export const recordCorrection = (entry, options = {}) => appendAtomic('corrections', entry, options.destination);
export const recordUnsupported = (entry, options = {}) => appendAtomic('requests', entry, options.destination);

export async function saveCapture(bytes, extension = 'png', options = {}) {
  const binary = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const hash = createHash('sha256').update(binary).digest('hex');
  const destination = path.join(options.directory || path.join(root, 'captures'), `${hash}.${extension}`);
  await mkdir(path.dirname(destination), { recursive: true });
  try { await readFile(destination); }
  catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
    const temp = `${destination}.${randomUUID()}.tmp`;
    try { await writeFile(temp, binary); await renameWithRetry(temp, destination); }
    finally { await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { hash, path: destination };
}
export async function listCorrectionsForFeedbackType(type, { source = fileFor('corrections'), category = '', archetype = '' } = {}) {
  let content;
  try { content = await readFile(source, 'utf8'); }
  catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
  const attempts = new Map();
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry.kind === 'attempt') attempts.set(entry.id, { ...entry, validated: false });
      if (entry.kind === 'validation' && attempts.has(entry.correctionId)) attempts.get(entry.correctionId).validated = entry.approved === true;
    } catch {}
  }
  return [...attempts.values()].filter((entry) => entry.feedbackType === type && entry.status === 'resolved' && entry.validated && ['params','parts'].includes(entry.patch?.target))
    .sort((a, b) => Number(b.archetype === archetype) - Number(a.archetype === archetype) || Number(b.category === category) - Number(a.category === category) || String(b.at).localeCompare(String(a.at))).slice(0, 3);
}
