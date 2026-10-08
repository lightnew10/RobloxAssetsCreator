import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpatialPlan, repairAiSpatialPlan } from '../src/spatialPlan.js';

test('repairs a parent reference by component name', () => {
  const raw = {
    sizeStuds:[12,30,12],
    components:[
      {id:'trunk',name:'Tronc',shape:'cylinder',material:'Wood'},
      {id:'leaf',name:'Feuille',shape:'long curved leaf',material:'Grass',parentId:'Tronc',curvature:.4,repetition:6},
    ],
    essentialCriteria:['tronc lisible','feuilles longues','silhouette de palmier'],
    captureViews:['face','side','top'],
    nativeMethod:'generate_mesh',
  };
  const prepared=repairAiSpatialPlan(raw);
  assert.equal(prepared.unresolved.length,0);
  const plan=normalizeSpatialPlan(prepared.input,null,[10,10,10]);
  assert.equal(plan.components.find(x=>x.id==='leaf').parentId,'trunk');
});

test('rejects a truly unresolved parent instead of hiding it', () => {
  const raw={
    sizeStuds:[8,8,8],
    components:[
      {id:'body',name:'Body',shape:'box',material:'SmoothPlastic'},
      {id:'detail',name:'Detail',shape:'box',material:'SmoothPlastic',parentId:'does_not_exist'},
    ],
    essentialCriteria:['body','detail','proportions'],
    captureViews:['face','side','top'],
    nativeMethod:'generate_procedural_model',
  };
  assert.throws(()=>normalizeSpatialPlan(raw,null,[8,8,8]),/structurellement invalide/i);
});


test('repairs the real-world coconut palm incident without inventing a root part', () => {
  const raw={
    sizeStuds:[12,30,12],
    components:[
      {id:'tronc',name:'Tronc',shape:'cylinder',material:'Wood',parentId:'root_coconut_palm',relativeSize:[.15,.8,.15]},
      {id:'feuillage',name:'Feuillage',shape:'leaf',material:'Grass',parentId:'root_coconut_palm',repetition:8},
      {id:'noix',name:'Noix',shape:'ball',material:'Wood',parentId:'root_coconut_palm',repetition:3},
    ],
    essentialCriteria:['tronc courbé','feuilles longues','noix visibles'],
    captureViews:['front','side','top'],
    nativeMethod:'generate_procedural_model',
  };
  const plan=normalizeSpatialPlan(raw,null,[10,10,10]);
  assert.deepEqual(plan.components.map(x=>x.id),['tronc','feuillage','noix']);
  assert.ok(plan.components.every(x=>x.parentId===undefined));
  assert.equal(plan.structureNormalization.repairs.filter(x=>x.code==='virtual_root_detached').length,3);
  assert.equal(plan.structureNormalization.unresolved.length,0);
});

test('keeps valid, explicit parents rather than detaching them as a virtual root', () => {
  const raw={
    sizeStuds:[8,12,8],
    components:[
      {id:'root_tree',name:'Tronc réel',shape:'cylinder',material:'Wood'},
      {id:'leaf',name:'Feuille',shape:'leaf',material:'Grass',parentId:'root_tree'},
      {id:'fruit',name:'Fruit',shape:'ball',material:'Wood',parentId:'root_tree'},
    ],
    essentialCriteria:['tronc','feuilles','fruits'],
    captureViews:['front','side','top'],
    nativeMethod:'generate_mesh',
  };
  const plan=normalizeSpatialPlan(raw,null,[8,12,8]);
  assert.equal(plan.components.find(x=>x.id==='leaf').parentId,'root_tree');
  assert.equal(plan.components.find(x=>x.id==='fruit').parentId,'root_tree');
  assert.equal(plan.structureNormalization.repairs.filter(x=>x.code==='virtual_root_detached').length,0);
});

test('does not silently detach an arbitrary absent essential parent', () => {
  const raw={
    sizeStuds:[8,12,8],
    components:[
      {id:'leaf',name:'Feuille',shape:'leaf',material:'Grass',parentId:'trunk_missing'},
      {id:'fruit',name:'Fruit',shape:'ball',material:'Wood',parentId:'trunk_missing'},
    ],
    essentialCriteria:['tronc','feuilles','fruits'],
    captureViews:['front','side','top'],
    nativeMethod:'generate_mesh',
  };
  assert.throws(()=>normalizeSpatialPlan(raw,null,[8,12,8]),cause=>{
    assert.equal(cause.code,'ASSET_SPATIAL_STRUCTURE_INVALID');
    assert.equal(cause.details.filter(x=>x.code==='missing_parent').length,2);
    return true;
  });
});

test('rejects root_* references that may be a missing real component', () => {
  const raw={
    sizeStuds:[8,12,8],
    components:[{id:'leaf',name:'Feuille',shape:'leaf',material:'Grass',parentId:'root_trunk'}],
    essentialCriteria:['tronc','feuilles','proportions'],
    captureViews:['front','side','top'],
    nativeMethod:'generate_mesh',
  };
  assert.throws(()=>normalizeSpatialPlan(raw,null,[8,12,8]),/missing_parent/i);
});

test('rejects genuine parent cycles after normalization', () => {
  const raw={
    sizeStuds:[8,12,8],
    components:[
      {id:'trunk',name:'Tronc',shape:'cylinder',material:'Wood',parentId:'leaf'},
      {id:'leaf',name:'Feuille',shape:'leaf',material:'Grass',parentId:'trunk'},
    ],
    essentialCriteria:['tronc','feuilles','proportions'],
    captureViews:['front','side','top'],
    nativeMethod:'generate_mesh',
  };
  assert.throws(()=>normalizeSpatialPlan(raw,null,[8,12,8]),/parent_cycle/i);
});


test('does not hide a missing real trunk shared by several details', () => {
  const raw={
    sizeStuds:[10,12,10],
    components:[
      {id:'leaf',name:'Feuille',shape:'leaf',material:'Grass',parentId:'root_trunk'},
      {id:'fruit',name:'Fruit',shape:'ball',material:'Wood',parentId:'root_trunk'},
    ],
    essentialCriteria:['tronc','feuillage','fruits'],
    captureViews:['front','side','top'],
    nativeMethod:'generate_mesh',
  };
  assert.throws(()=>normalizeSpatialPlan(raw,null,[10,12,10]),cause=>{
    assert.equal(cause.code,'ASSET_SPATIAL_STRUCTURE_INVALID');
    assert.equal(cause.details.filter(x=>x.code==='missing_parent').length,2);
    return true;
  });
});
