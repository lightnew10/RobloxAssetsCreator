import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { getJob, mutateJob, saveJob } from '../src/store.js';
import { continuousBatchTargetReached, nextContinuousBatch, normalizeBatchTarget, rateVariant } from '../src/pipeline.js';

test('batch target accepts a positive count or unlimited mode', () => {
  for (const value of [undefined, null, '']) assert.equal(normalizeBatchTarget(value), null);
  for (const value of [1, 3, 5, 10, '10']) assert.equal(normalizeBatchTarget(value), Number(value));
  for (const value of [0, -1, 1.5, 'abc', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => normalizeBatchTarget(value), { code: 'JOB_INPUT_INVALID' });
  assert.equal(continuousBatchTargetReached({ batchTarget: 3, completedBatchNumber: 2 }), false);
  assert.equal(continuousBatchTargetReached({ batchTarget: 3, completedBatchNumber: 3 }), true);
  assert.equal(continuousBatchTargetReached({ completedBatchNumber: 10 }), false);
});

test('continuous batches advance only after three finished variants and stop on request', () => {
  const batch = { activeBatchNumber: 12, variants: [1,2,3].map((id) => ({ id: String(id), batchNumber: 12, status: 'done' })) };
  assert.deepEqual(nextContinuousBatch(batch), { batchNumber: 12, nextBatchNumber: 13, variantIds: ['1','2','3'] });
  assert.equal(nextContinuousBatch({ ...batch, stopRequested: true }), null);
  assert.equal(nextContinuousBatch({ ...batch, variants: batch.variants.slice(0,2) }), null);
  assert.equal(nextContinuousBatch({ ...batch, variants: [{ ...batch.variants[0], status: 'pending' }, ...batch.variants.slice(1)] }), null);
  assert.deepEqual(nextContinuousBatch({ ...batch, variants: [...batch.variants, { id: 'patch', batchNumber: 12, correctionOf: '1', status: 'failed' }] })?.variantIds, ['1','2','3']);
});

test('a completed variant can be rated twice while its batch is generating', async () => {
  const id = randomUUID();
  const variantId = randomUUID();
  try {
    await saveJob({ id, status: 'generating', continuousGeneration: true, variants: [
      { id: variantId, status: 'done', review: { score: 8.5 }, captures: [] },
    ], events: [], createdAt: new Date().toISOString() });
    await rateVariant(id, variantId, { rating: 6, note: 'Silhouette faible' });
    await rateVariant(id, variantId, { rating: 7.5, note: 'Après une autre vue' });
    const job = await getJob(id);
    assert.equal(job.status, 'generating');
    assert.equal(job.variants[0].humanRating, 7.5);
    assert.deepEqual(job.variants[0].humanRatingHistory.map((entry) => entry.rating), [6, 7.5]);
    assert.equal(job.events.filter((entry) => entry.type === 'variant.rated').length, 2);
    assert.equal(job.selectedVariantId, undefined);
    await assert.rejects(rateVariant(id, variantId, { rating: 11 }), { code: 'HUMAN_RATING_INVALID' });
    await mutateJob(id, (item) => { item.selectedVariantId = variantId; item.status = 'saved'; return item; });
    await assert.rejects(rateVariant(id, variantId, { rating: 9 }), { code: 'RATING_LOCKED' });
  } finally {
    await rm(path.join(config.jobsRoot, id + '.json'), { force: true });
  }
});
