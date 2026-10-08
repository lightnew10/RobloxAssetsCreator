import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, definitionFingerprint, geometryFingerprint } from '../src/change/fingerprint.js';
import { correctionOutcome } from '../src/pipeline.js';

const part = { name: 'leaf', componentId: 'foliage', shape: 'wedge', size: [1,2,3], position: [0,1,0], rotation: [0,0,0], color: [1,2,3], material: 'Grass' };
test('canonical fingerprints ignore key order and tiny rounding noise', () => {
  assert.equal(definitionFingerprint({ archetype: 'palmTree', params: { a: 1, b: 2 } }), definitionFingerprint({ params: { b: 2, a: 1.00004 }, archetype: 'palmTree' }));
  assert.equal(geometryFingerprint({ parts: [part] }), geometryFingerprint({ parts: [{ ...part, size: [1.0004,2,3] }] }));
});
test('comparison reports modified fields but requires definition and geometry changes', () => {
  const before = { geometryDefinition: { archetype: 'palmTree', params: { frondCount: 8 } }, geometry: { parts: [part] } };
  const unchanged = structuredClone(before);
  assert.equal(compareVersions(before, unchanged).changed, false);
  const after = { geometryDefinition: { archetype: 'palmTree', params: { frondCount: 10 } }, geometry: { parts: [{ ...part, size: [2,2,3] }] } };
  assert.deepEqual(compareVersions(before, after).changedFields, ['params.frondCount']);
  assert.equal(compareVersions(before, after).changed, true);
  assert.equal(compareVersions(before, { ...after, geometry: before.geometry }).changed, false);
});
test('an unchanged correction cannot be resolved by a positive AI review', () => {
  assert.equal(correctionOutcome({ changed: false, definitionChanged: false, geometryChanged: false }, true, true, { resolved: true }), 'no_effect');
  assert.equal(correctionOutcome({ changed: true, definitionChanged: true, geometryChanged: true }, false, true, { resolved: true }), 'no_effect');
  assert.equal(correctionOutcome({ changed: true, definitionChanged: true, geometryChanged: true }, true, true, { resolved: true }), 'resolved');
  assert.equal(correctionOutcome({ changed: true, definitionChanged: true, geometryChanged: true }, true, true, null), 'unresolved');
});
