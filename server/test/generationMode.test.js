import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATION_MODES, normalizeGenerationMode, engineForGenerationMode,
  engineForJob, generationModeForJob, generationSourceForEngine,
} from '../src/generationMode.js';

test('local-only is the safe default for unknown and missing preferences', () => {
  assert.deepEqual(GENERATION_MODES, ['local', 'roblox', 'hybrid']);
  assert.equal(normalizeGenerationMode(undefined), 'local');
  assert.equal(normalizeGenerationMode('unexpected'), 'local');
  assert.equal(engineForGenerationMode(undefined), 'parts');
  assert.equal(engineForGenerationMode('unexpected'), 'parts');
  assert.equal(engineForGenerationMode('local'), 'parts');
});

test('Roblox-only and hybrid modes resolve to strict native and auto', () => {
  assert.equal(engineForGenerationMode('roblox'), 'native');
  assert.equal(engineForGenerationMode('hybrid'), 'auto');
  assert.equal(engineForJob({ generationMode:'local', engine:'auto' }), 'parts');
  assert.equal(engineForJob({ generationMode:'local', engine:'native' }), 'parts');
  assert.equal(engineForJob({ generationMode:'roblox', engine:'parts' }), 'native');
  assert.equal(engineForJob({ generationMode:'hybrid', engine:'parts' }), 'auto');
});

test('settings changes cannot change a snapshotted generation mode', () => {
  const saved = { generationMode:'local', engine:'parts' };
  assert.equal(generationModeForJob(saved), 'local');
  assert.equal(engineForJob(saved), 'parts');
  assert.equal(generationModeForJob({ generationMode:'roblox', engine:'native' }), 'roblox');
});

test('existing jobs without generationMode retain their original generator', () => {
  assert.equal(generationModeForJob({ engine:'auto' }), 'hybrid');
  assert.equal(generationModeForJob({ engine:'native' }), 'roblox');
  assert.equal(generationModeForJob({ engine:'parts' }), 'local');
  assert.equal(engineForJob({ engine:'auto' }), 'auto');
  assert.equal(engineForJob({ engine:'native' }), 'native');
  assert.equal(engineForJob({ engine:'parts' }), 'parts');
  assert.equal(engineForJob({}), 'parts');
});

test('variant provenance distinguishes Roblox native from Parts fallback', () => {
  assert.equal(generationSourceForEngine('native'), 'roblox_native');
  assert.equal(generationSourceForEngine('parts'), 'local_parts');
  assert.equal(generationSourceForEngine('parts_fallback'), 'local_parts');
  assert.equal(generationSourceForEngine(null), null);
});
