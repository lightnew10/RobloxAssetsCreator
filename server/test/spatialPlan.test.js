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
