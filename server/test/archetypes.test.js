import test from 'node:test';
import assert from 'node:assert/strict';
import { archetypes, archetypeIds, buildProceduralGeometry, proceduralGeometrySchema } from '../src/archetypes/index.js';
import { bounds } from '../src/archetypes/utils.js';
import { geometryAudit, geometrySchema } from '../src/geometry.js';

const spatial={sizeStuds:[15,20,15],components:[
  {id:'trunkA',name:'tronc principal',curvature:.1},
  {id:'leafA',name:'feuillage',curvature:.2},
  {id:'fruitA',name:'noix de coco'},
]};
for(const id of archetypeIds){
  test(id+' deterministic bounds, ground, seeds, and distinct silhouette',()=>{
    const kind=archetypes[id];
    assert.equal(kind.id,id);
    assert.equal(kind.schema.type,'object');
    const one=kind.build({},{sizeStuds:[15,20,15],profile:'balanced',seed:42});
    const same=kind.build({},{sizeStuds:[15,20,15],profile:'balanced',seed:42});
    const expanded=kind.build({},{sizeStuds:[15,20,15],profile:'silhouette',seed:42});
    const compact=kind.build({},{sizeStuds:[15,20,15],profile:'compact',seed:42});
    assert.deepEqual(one,same,'same seed and profile');
    assert.ok(one.parts.length>0&&one.parts.length<=180);
    for(const p of [one,...[expanded,compact]].flatMap(x=>x.parts)){
      assert.ok(['box','wedge','ball','cylinder'].includes(p.shape),p.name);
      assert.ok(p.position[1]>=0,p.name+' center must be >= ground');
      assert.ok(p.size.every(n=>Number.isFinite(n)&&n>0&&n<=200),p.name+' size in bounds');
      assert.equal(p.position.length,3);assert.equal(p.rotation.length,3);
      assert.ok(p.position.every(Number.isFinite));
      assert.ok(p.color.every(n=>Number.isInteger(n)&&n>=0&&n<=255));
      assert.equal(typeof p.canCollide,'boolean');
    }
    assert.notDeepEqual(bounds(expanded.parts),bounds(compact.parts),'silhouette and compact differ in bounding box');
  });
}
test('strict archetype enum and fallback Parts remain available',()=>{
  assert.deepEqual(proceduralGeometrySchema.properties.archetype.enum,archetypeIds);
  assert.equal(geometrySchema.oneOf.length,2);
  assert.ok(geometrySchema.oneOf[1].properties.parts);
});
test('procedural builder maps real plan component ids, keeps variation authority',()=>{
  const plan={...spatial,components:spatial.components.filter(x=>x.id!=='fruitA')};
  const p=buildProceduralGeometry({archetype:'palmTree',params:{frondCount:12},variation:'balanced'},plan,{id:'silhouette'},123);
  assert.ok(p.parts.every(x=>plan.components.some(c=>c.id===x.componentId)));
  assert.equal(p.definition.variation,'silhouette');
  assert.ok(geometryAudit({parts:p.parts},plan).partCount>0);
});
test('palm trunk rooted and fronds originate in upper crown',()=>{
  const p=archetypes.palmTree.build({},{sizeStuds:[14,18,14],profile:'balanced',seed:1}).parts;
  const trunk=p.filter(x=>x.name.startsWith('trunk_')),fronds=p.filter(x=>x.name.startsWith('frond_'));
  assert.ok(trunk.length>=6&&fronds.length>=20);
  assert.ok(trunk[0].position[1] <= trunk[1].position[1]);
  const maxTrunkY=Math.max(...trunk.map(x=>x.position[1]));
  assert.ok(fronds.filter(x=>x.position[1]>=maxTrunkY-5).length>=fronds.length/3);
});

test('shared parameter schema supports all archetype materials and ranges',()=>{
  const fields=proceduralGeometrySchema.properties.params.properties;
  for(const material of ['Wood','Rock','Slate','WoodPlanks','Grass','SmoothPlastic'])
    assert.ok(fields.material.enum.includes(material),material);
  assert.ok(fields.height.maximum>=1.1);
});
