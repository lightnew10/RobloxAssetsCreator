import test from 'node:test';
import assert from 'node:assert/strict';
import { runDefectIteration } from '../src/review/iteration.js';
import { archetypes } from '../src/archetypes/index.js';

test('two defects cause one parameter change and stop on accepted at 8', async () => {
  let calls = 0;
  const result = await runDefectIteration({
    review: { score: 7, problems: [
      { component: 'fronds', issue: 'too_few_leaves', severity: 'medium' },
      { component: 'fronds', issue: 'texture_too_flat', severity: 'low' },
    ] },
    archetypeId: 'palmTree', schema: archetypes.palmTree.schema,
    params: { frondCount: 8 },
    generate: async (params) => {
      calls += 1;
      assert.equal(params.frondCount, 10);
      return { score: 8, problems: [] };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.planned.instructions.length, 1);
  assert.equal(result.keep.keep, true);
  assert.deepEqual(result.stop, { stop: true, reason: 'accepted' });
});
