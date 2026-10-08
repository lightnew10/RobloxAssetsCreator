import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAssetInput} from '../src/input.js';

test('single phrase alone becomes name and brief',()=>{
 const normalized=normalizeAssetInput({brief:'Une voiture rouge low-poly'});
 assert.equal(normalized.brief,'Une voiture rouge low-poly');
 assert.equal(normalized.name,'Une voiture rouge low-poly');
 assert.equal(normalized.referenceImages.length,0);
});
test('photo alone provides a neutral brief but stays local',()=>{
 const photo='data:image/png;base64,'+Buffer.from('test').toString('base64');
 const normalized=normalizeAssetInput({referenceImages:[photo]});
 assert.match(normalized.brief,/photo/);
 assert.equal(normalized.referenceImages[0],photo);
});
test('empty, malformed, too-large input rejected',()=>{
 assert.throws(()=>normalizeAssetInput({}),e=>e.code==='JOB_INPUT_INVALID');
 assert.throws(()=>normalizeAssetInput({referenceImages:['data:image/gif;base64,AAAA']}),e=>e.code==='JOB_INPUT_INVALID');
 const giant='data:image/png;base64,'+'A'.repeat(8*1024*1024);
 assert.throws(()=>normalizeAssetInput({referenceImages:[giant]}),e=>e.code==='JOB_INPUT_INVALID');
});
test('limit four image references without modifying original data URLs',()=>{
 const url='data:image/jpeg;base64,'+Buffer.from('test').toString('base64');
 const selected=normalizeAssetInput({name:'crayon',referenceImages:Array.from({length:6},()=>url)});
 assert.equal(selected.referenceImages.length,4);
});

test('explicitly protected brands/characters are rejected without network access',()=>{
 assert.throws(()=>normalizeAssetInput({brief:'Une statue Mario fidèle au jeu Nintendo'}),e=>e.code==='CONTENT_RESTRICTED');
 assert.throws(()=>normalizeAssetInput({brief:'Le logo officiel de cette marque'}),e=>e.code==='CONTENT_RESTRICTED');
 assert.equal(normalizeAssetInput({brief:'Une mascotte originale low-poly'}).brief,'Une mascotte originale low-poly');
});
