import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { writeAtomicJson } from '../src/atomicJson.js';
import { getJob, mutateJob, saveJob } from '../src/store.js';

const target = 'C:/test/jobs/example.json';

function fakeFilesystem({ failRenames = 0, failCode = 'EPERM' } = {}) {
  const files = new Map([[target, 'LAST_GOOD_SNAPSHOT']]);
  const events = [];
  let attempts = 0;
  const fsApi = {
    async mkdir(dir) { events.push(['mkdir', dir]); },
    async writeFile(name, content) { events.push(['write', name]); files.set(name, content); },
    async rename(from, to) {
      attempts += 1;
      events.push(['rename', from, to]);
      if (attempts <= failRenames) throw Object.assign(new Error('File is in use'), { code: failCode });
      assert.equal(files.has(from), true, 'temporary snapshot exists before commit');
      files.set(to, files.get(from));
      files.delete(from);
    },
    async unlink(name) {
      events.push(['unlink', name]);
      if (!files.delete(name)) throw Object.assign(new Error('Missing temp'), { code: 'ENOENT' });
    },
  };
  return { fsApi, files, events, get attempts() { return attempts; } };
}

test('retries transient Windows EPERM and keeps previous snapshot until atomic commit', async () => {
  const fs = fakeFilesystem({ failRenames: 3 });
  const waits = [];
  const reports = [];
  await writeAtomicJson(target, { counter: 2 }, {
    fsApi: fs.fsApi, maxAttempts: 5, firstDelayMs: 1, maxDelayMs: 3,
    pause: async ms => {
      waits.push(ms);
      assert.equal(fs.files.get(target), 'LAST_GOOD_SNAPSHOT', 'target remains valid while rename fails');
    },
    onRetry: event => reports.push(event),
  });
  assert.equal(fs.attempts, 4);
  assert.deepEqual(waits, [1, 2, 3]);
  assert.equal(reports.length, 3);
  assert.deepEqual(JSON.parse(fs.files.get(target)), { counter: 2 });
  assert.equal([...fs.files.keys()].filter(name => name.endsWith('.tmp')).length, 0);
});

test('persistent EPERM leaves the original file intact and removes temporary file', async () => {
  const fs = fakeFilesystem({ failRenames: 20 });
  await assert.rejects(writeAtomicJson(target, { counter: 5 }, {
    fsApi: fs.fsApi, maxAttempts: 3, firstDelayMs: 1, pause: async () => {},
  }), error => error.code === 'JOB_SAVE_BLOCKED' && error.details.originalCode === 'EPERM' &&
    error.details.attempts === 3);
  assert.equal(fs.attempts, 3);
  assert.equal(fs.files.get(target), 'LAST_GOOD_SNAPSHOT');
  assert.equal([...fs.files.keys()].filter(name => name.endsWith('.tmp')).length, 0);
});

test('non-transient errors are never retried or hidden', async () => {
  const fs = fakeFilesystem({ failRenames: 3, failCode: 'ENOSPC' });
  await assert.rejects(writeAtomicJson(target, { counter: 2 }, {
    fsApi: fs.fsApi, pause: async () => { throw new Error('should not retry'); },
  }), error => error.code === 'ENOSPC');
  assert.equal(fs.attempts, 1);
  assert.equal(fs.files.get(target), 'LAST_GOOD_SNAPSHOT');
  assert.equal([...fs.files.keys()].filter(name => name.endsWith('.tmp')).length, 0);
});

test('initial saves and concurrent mutations of the same job cannot overwrite each other', async () => {
  const id = randomUUID();
  const file = path.join(config.jobsRoot, id + '.json');
  try {
    const job = { id, counter: 0, createdAt: new Date().toISOString() };
    await Promise.all([saveJob(job), ...[]]);
    await Promise.all(Array.from({ length: 24 }, () => mutateJob(id, item => { item.counter += 1; return item; })));
    assert.equal((await getJob(id)).counter, 24);
  } finally {
    await rm(file, { force: true });
  }
});
