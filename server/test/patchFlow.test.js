import test from 'node:test';
import assert from 'node:assert/strict';
import { archetypes } from '../src/archetypes/index.js';
import { applyPatch, definitionForVariant } from '../src/change/patch.js';
import { compareVersions } from '../src/change/fingerprint.js';
import { normalizeGeometry } from '../src/geometry.js';

const plan = { components: [], sizeStuds:[14,18,14] };
const context = { sizeStuds:plan.sizeStuds, profile:'balanced', seed:42 };
function version(definition) {
  return { geometryDefinition:definition, geometry:normalizeGeometry(archetypes.palmTree.build(definition.params, context), plan) };
}
test('palm frond width and count feedback change real deterministic geometry without regenerating the definition', () => {
  const initial = definitionForVariant({ geometryDefinition:{ archetype:'palmTree', params:{ frondCount:8 }, variation:'balanced' } });
  const wider = applyPatch(initial, { target:'params', ops:[{ op:'set', path:'frondWidth', value:.18 }], reason:'palmes trop fines' });
  assert.deepEqual(wider.applied.map((op)=>op.path), ['frondWidth']);
  assert.equal(compareVersions(version(initial), version(wider.definition)).changed, true);
  const more = applyPatch(wider.definition, { target:'params', ops:[{ op:'set', path:'frondCount', value:12 }], reason:'il manque des feuilles' });
  assert.deepEqual(more.applied.map((op)=>op.path), ['frondCount']);
  assert.equal(compareVersions(version(wider.definition), version(more.definition)).changed, true);
  assert.equal(initial.params.frondCount, 8);
});
