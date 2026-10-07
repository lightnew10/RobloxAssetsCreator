import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const locks = new Map();
const fileFor = (id) => path.join(config.jobsRoot, id + '.json');

async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
  await rename(temp, file);
}

export async function getJob(id) {
  try { return JSON.parse(await readFile(fileFor(id), 'utf8')); }
  catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw cause;
  }
}
export async function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  await atomicWrite(fileFor(job.id), job);
  return job;
}
export async function mutateJob(id, fn) {
  const previous = locks.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const job = await getJob(id);
    if (!job) throw Object.assign(new Error('Job introuvable.'), { code: 'JOB_NOT_FOUND' });
    const result = await fn(job) || job;
    await saveJob(result);
    return structuredClone(result);
  });
  locks.set(id, next);
  try { return await next; }
  finally { if (locks.get(id) === next) locks.delete(id); }
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
