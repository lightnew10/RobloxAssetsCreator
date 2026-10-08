import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { listCorrectionsForFeedbackType, recordCorrection, saveCapture } from '../src/change/store.js';

test('only resolved and human validated corrections are retrieved across categories', async () => {
  const testRoot = path.join(config.dataRoot, 'runtime');
  await mkdir(testRoot, { recursive:true });
  const dir = await mkdtemp(path.join(testRoot, 'rac-change-test-'));
  const destination = path.join(dir, 'corrections.jsonl');
  try {
    await Promise.all([
      recordCorrection({ kind:'attempt', id:'rock', at:'2026-10-08T10:00:00Z', feedbackType:'too_thin', category:'rock', status:'resolved', patch:{ target:'params' } }, { destination }),
      recordCorrection({ kind:'attempt', id:'palm', at:'2026-10-08T11:00:00Z', feedbackType:'too_thin', category:'vegetation', status:'resolved' }, { destination }),
    ]);
    await recordCorrection({ kind:'validation', correctionId:'rock', approved:true }, { destination });
    const found = await listCorrectionsForFeedbackType('too_thin', { source:destination, category:'vegetation' });
    assert.deepEqual(found.map((entry) => entry.id), ['rock']);
    assert.equal((await readFile(destination, 'utf8')).trim().split('\n').length, 3);
    const first = await saveCapture(Buffer.from('capture bytes'), 'png', { directory:path.join(dir, 'captures') });
    const second = await saveCapture(Buffer.from('capture bytes'), 'png', { directory:path.join(dir, 'captures') });
    assert.equal(first.path, second.path);
  } finally { await rm(dir, { recursive:true, force:true }); }
});
