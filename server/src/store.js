import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { writeAtomicJson } from './atomicJson.js';

const locks = new Map();
const fileFor = (id) => path.join(config.jobsRoot, id + '.json');

async function persistJob(job) {
  job.updatedAt = new Date().toISOString();
  await writeAtomicJson(fileFor(job.id), job, {
    onRetry: ({ attempt, code, waitMs }) => {
      if ([1, 5, 10].includes(attempt)) {
        console.warn('[RAC][JOB_SAVE_RETRY]', { jobId: job.id, code, attempt, waitMs });
      }
    },
  });
  return job;
}

// A single queue covers both the initial save and every later mutation.
// mutateJob must call persistJob directly while holding this lock.
function withJobWriteLock(id, action) {
  const previous = locks.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  locks.set(id, next);
  return next.finally(() => { if (locks.get(id) === next) locks.delete(id); });
}

export async function getJob(id) {
  try { return JSON.parse(await readFile(fileFor(id), 'utf8')); }
  catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw cause;
  }
}
export async function saveJob(job) {
  return withJobWriteLock(job.id, () => persistJob(job));
}
export async function mutateJob(id, fn) {
  return withJobWriteLock(id, async () => {
    const job = await getJob(id);
    if (!job) throw Object.assign(new Error('Job introuvable.'), { code: 'JOB_NOT_FOUND' });
    const result = await fn(job) || job;
    await persistJob(result);
    return structuredClone(result);
  });
}
export async function listJobs(limit = 40) {
  await mkdir(config.jobsRoot, { recursive: true });
  const names = (await readdir(config.jobsRoot)).filter((x) => x.endsWith('.json'));
  const jobs = [];
  for (const name of names) {
    try { jobs.push(JSON.parse(await readFile(path.join(config.jobsRoot, name), 'utf8'))); } catch {}
  }
  return jobs.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}
