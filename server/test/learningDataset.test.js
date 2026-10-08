import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readValidatedExamples, relevantExamples, saveValidatedExample } from '../src/learning.js';
import { exportDataset, isExportableExample } from '../src/dataset.js';
import { createVariantMetric,recordVariantMetric } from '../src/metrics.js';
import { saveLibrarySelection, searchLibrary, readLibrary } from '../src/library.js';

async function isolated(fn) {const dir=await mkdtemp(path.join(os.tmpdir(),'rac-data-test-'));try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
const example=(id,score=9)=>({id,createdAt:new Date().toISOString(),sourceJobId:id,sourceVariantId:'variant',
  humanValidated:true,validationSource:'human_selection',humanRating:score,brief:'cocotier tropical à feuilles longues',
  category:'tree',subtype:'palm',inventory:{sizeStuds:[10,15,10]},
  decomposition:{archetype:'palmTree',params:{height:.8},variation:'balanced'},
  engineUsed:'parts',score});
test('dataset rejects nonvalidated and missing/low score, exports chat JSONL',()=>isolated(async dir=>{
  const source=path.join(dir,'library.jsonl'),destination=path.join(dir,'dataset.jsonl');
  const entries=[example('good',9),{...example('unvalidated',10),humanValidated:false},
    {...example('missing'),humanRating:undefined},example('low',7),
    {...example('native',9),engineUsed:'native'}];
  await writeFile(source,entries.map(x=>JSON.stringify(x)).join('\n')+'\n');
  const output=await exportDataset({source,destination});
  assert.equal(output.count,1);
  const exported=(await readFile(destination,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(exported.length,1);
  assert.deepEqual(exported[0].messages.map(x=>x.role),['system','user','assistant']);
  assert.equal(JSON.parse(exported[0].messages[2].content).archetype,'palmTree');
  assert.equal(isExportableExample({...example('none'),humanValidated:false}),false);
}));
test('save requires explicit selection and score >=8, deduplicates by job/variant',()=>isolated(async dir=>{
  const destination=path.join(dir,'examples.jsonl');
  const job={id:'j1',name:'cocotier',brief:'cocotier tropical',category:'tree',subtype:'palm',plan:{sizeStuds:[12,18,12]},feedback:[]};
  const variant={id:'v1',engineUsed:'parts',humanRating:8.5,geometryDefinition:{archetype:'palmTree',params:{height:.85},variation:'balanced'},review:{score:8.5}};
  assert.equal(await saveValidatedExample(job,{...variant,humanRating:null},{destination}),null);
  assert.equal(await saveValidatedExample(job,{...variant,humanRating:7.9},{destination}),null);
  assert.ok(await saveValidatedExample(job,variant,{destination}));
  assert.equal(await saveValidatedExample(job,variant,{destination}),null);
  assert.equal((await readValidatedExamples(destination)).length,1);
  const similar=await relevantExamples({name:'cocotier',brief:'palmes longues',category:'tree'},3,{source:destination});
  assert.equal(similar[0].archetype,'palmTree');
}));
test('metrics records score, durations, correction ancestry',()=>isolated(async dir=>{
  const job={id:'job',createdAt:'2026-10-08T00:00:00.000Z',variants:[{id:'v1',correctionOf:null},{id:'v2',correctionOf:'v1'}]};
  const v={id:'v1',startedAt:'2026-10-08T00:00:01.000Z',finishedAt:'2026-10-08T00:00:03.000Z',
    engineUsed:'parts',review:{score:8.4},geometryDefinition:{archetype:'palmTree'}};
  const m=createVariantMetric(job,v);assert.equal(m.durationMs,2000);
  assert.equal(m.corrections,1);assert.equal(m.finalScore,8.4);
  const file=path.join(dir,'metrics.jsonl');await recordVariantMetric(job,v,{destination:file});
  assert.equal(JSON.parse((await readFile(file,'utf8')).trim()).archetype,'palmTree');
}));

test('library requires explicit human grade and excludes native Roblox geometry',()=>isolated(async dir=>{
  const destination=path.join(dir,'library.jsonl'),archive=path.join(dir,'archive.jsonl');
  const job={id:'local-job',name:'cocotier',brief:'un palmier stylisé',category:'vegetation',subtype:'palm',
    plan:{sizeStuds:[10,15,10],components:[]},feedback:[{source:'human',text:'palmes plus longues'}]};
  const variant={id:'v1',engineUsed:'parts',geometryDefinition:{primitives:{components:[{
    componentId:'stem',primitives:[{type:'sweep',name:'trunk',from:[0,0,0],to:[0,.9,0],radius:.08}]}]},version:'1.0.0'},
    review:{score:9.7}};
  assert.equal(await saveLibrarySelection(job,variant,null,{destination,archive}),null);
  assert.equal(await saveLibrarySelection(job,variant,7,{destination,archive}),null);
  assert.equal(await saveLibrarySelection(job,{...variant,engineUsed:'native'},9,{destination,archive}),null);
  const saved=await saveLibrarySelection(job,variant,8,{destination,archive});
  assert.equal(saved.humanRating,8);
  assert.equal(saved.decomposition.components[0].componentId,'stem');
  assert.equal(await saveLibrarySelection(job,variant,8,{destination,archive}),null);
  assert.equal((await readLibrary(destination)).length,1);
  assert.equal((await searchLibrary({brief:'palmier',category:'vegetation'},3,{source:destination})).length,1);
}));
