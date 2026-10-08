import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverSavedPlan } from '../src/pipeline.js';

test('failed rebuild retains its previous plan for a later patch', async () => {
  const plan = { components:[{ id:'trunk' }] };
  assert.deepEqual(await recoverSavedPlan({ id:'missing', plan:null, rebuildPreviousPlan:plan }), plan);
  assert.deepEqual(await recoverSavedPlan({ id:'missing', plan, rebuildPreviousPlan:null }), plan);
});
