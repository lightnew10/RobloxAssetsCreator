import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackGeometry, geometryAudit, variationProfiles } from '../src/geometry.js';

test('fallback geometry segments curved leaves instead of one ball proxy', () => {
  const plan={
    sizeStuds:[12,30,12],
    components:[
      {id:'trunk',name:'Tronc',role:'trunk',relativeSize:[.1,.75,.1],relativePosition:[0,.35,0],curvature:.15},
      {id:'leaves',name:'Longues feuilles',role:'foliage',relativeSize:[.8,.14,.18],relativePosition:[0,.82,0],curvature:.55,repetition:8,parentId:'trunk'},
    ],
  };
  const geometry=fallbackGeometry(plan,123,variationProfiles[0]);
  assert.ok(geometry.parts.length>=30);
  assert.ok(geometry.parts.filter(x=>x.componentId==='leaves').length>=24);
  const audit=geometryAudit(geometry,plan);
  assert.equal(audit.issues.some(x=>x.code==='curve_undersegmented'),false);
});
