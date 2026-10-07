import test from 'node:test';
import assert from 'node:assert/strict';

test('critical server modules import without side effects', async () => {
  const [pipeline, providers, studio, trace] = await Promise.all([
    import('../src/pipeline.js'),
    import('../src/providers.js'),
    import('../src/studioBridge.js'),
    import('../src/trace.js'),
  ]);
  assert.equal(typeof pipeline.createAssetJob, 'function');
  assert.equal(typeof pipeline.requestCorrection, 'function');
  assert.equal(typeof providers.structuredChat, 'function');
  assert.equal(typeof studio.getStudioStatus, 'function');
  assert.equal(typeof trace.traceArtifact, 'function');
});
