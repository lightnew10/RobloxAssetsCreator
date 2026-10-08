import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, definitionForVariant, ensurePrimitiveIds } from '../src/change/patch.js';
import { archetypes } from '../src/archetypes/index.js';
import { planCorrections } from '../src/review/defects.js';
import { feedbackType } from '../src/change/feedbackTypes.js';

test('param patch changes only the intended bounded field', () => {
  const source = definitionForVariant({ geometryDefinition: { archetype: 'palmTree', params: { frondCount: 8 } } });
  const result = applyPatch(source, { target: 'params', ops: [{ op: 'set', path: 'frondCount', value: 99 }, { op: 'set', path: 'unknown', value: 1 }], reason: 'more leaves' });
  assert.equal(result.definition.params.frondCount, 20);
  assert.equal(result.definition.params.frondWidth, .105);
  assert.equal(source.params.frondCount, 8);
  assert.equal(result.applied.length, 1);
  assert.deepEqual(result.rejected.map((entry) => entry.reason), ['unknown_path']);
});
test('primitive patch targets a stable id without changing its neighbor', () => {
  const source = ensurePrimitiveIds({ primitives: { components: [{ componentId: 'foliage', primitives: [
    { type: 'box', name: 'left', size: [.2,.2,.2] }, { type: 'box', name: 'right', size: [.2,.2,.2] },
  ] }] } });
  const [left, right] = source.primitives.components[0].primitives;
  const result = applyPatch(source, { target: 'parts', ops: [{ op: 'set', path: `foliage.${left.id}.size.0`, value: .4 }], reason: 'wider' });
  assert.equal(result.definition.primitives.components[0].primitives[0].size[0], .4);
  assert.deepEqual(result.definition.primitives.components[0].primitives[1], right);
  assert.equal(source.primitives.components[0].primitives[0].size[0], .2);
  assert.equal(result.applied.length, 1);
});
test('legacy Parts become patchable and palm defaults preserve baseline geometry', () => {
  const legacy = definitionForVariant({ geometry: { parts: [{ name:'rock', componentId:'rock', shape:'box', size:[1,1,1], position:[0,.5,0], rotation:[0,0,0], color:[1,2,3], material:'Rock', canCollide:true }] } });
  assert.equal(legacy.parts.length, 1);
  const id = legacy.parts[0].id;
  assert.equal(applyPatch(legacy, { target:'parts', ops:[{ op:'scale', path:`rock.${id}.size.0`, value:2 }], reason:'wide' }).definition.parts[0].size[0], 2);
  const context = { sizeStuds:[10,12,10], profile:'balanced', seed:123 };
  for (const archetype of Object.values(archetypes)) assert.deepEqual(archetype.build({}, context), archetype.build(archetype.defaults, context));
});
test('palm frond feedback selects frond width through data roles', () => {
  const planned = planCorrections([{ status:'valid', issue:'too_thin', component:'fronds' }], 'palmTree', archetypes.palmTree.schema);
  assert.equal(planned.changes[0].param, 'frondWidth');
});
test('feedback type prefers selected vocabulary then aliases and generic count language', () => {
  assert.equal(feedbackType({ issues:['too_thin'], text:'autre chose' }), 'too_thin');
  assert.equal(feedbackType({ text:'les palmes sont trop fines' }), 'too_thin');
  assert.equal(feedbackType({ text:'pas assez de branches' }), 'too_few_branches');
});
