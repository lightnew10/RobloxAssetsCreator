import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateOfflineJob} from '../src/offlineSimulation.js';
import {buildPartsLuau} from '../src/assetStudio.js';
import {ollamaMemoryDiagnostic,visionStructuredChat} from '../src/providers.js';
const inventory={sizeStuds:[8,10,8],
 components:[{id:'body',name:'body',shape:'cylinder',material:'Wood'}],
 essentialCriteria:['recognizable shape'],captureViews:['front','side','top'],nativeMethod:'generate_procedural_model'};
const details={components:[{componentId:'body',primitives:[{
 type:'sweep',name:'body',from:[0,0,0],control:[.1,.5,0],to:[.2,.9,0],radius:.07,
 segments:8,color:[90,65,43],material:'Wood'}]}]};
test('offline pipeline uses JSON primitives and exposes truthful mock capture metadata',()=>{
 const a=simulateOfflineJob({inventory,details}),b=simulateOfflineJob({inventory,details});
 assert.deepEqual(a.geometry,b.geometry);
 assert.equal(a.geometryAudit.passed,true);
 assert.equal(a.geometry.parts[0].componentId,'body');
 assert.equal(a.placeId,undefined);
 assert.ok(a.placeholders.every(x=>x.simulated&&!x.imageAvailable));
 assert.equal(a.placeholders.length,3);
});
test('Studio Luau builds submodels and positions pivot before returning bounds',()=>{
 const job={id:'aaaaaaaa-0000-0000-0000-111111111111',name:'test',brief:'une poignée',category:'handheld',schemaVersion:2,
   plan:{category:'handheld'}};
 const variant={id:'bbbbbbbb-0000-0000-0000-222222222222',order:0,
   geometry:{parts:[{name:'handle',componentId:'body',groupId:'structure',shape:'box',size:[2,2,2],
     position:[0,1,0],rotation:[0,0,0],color:[100,100,100],material:'Wood',canCollide:true}]},
   geometryDefinition:{version:'1.0.0'}};
 const code=buildPartsLuau(job,variant);
 assert.ok(code.includes('model:SetAttribute("RACSchemaVersion",data.schemaVersion)'));
 assert.ok(code.includes('groups[key]'));
 assert.ok(code.includes('model.WorldPivot=CFrame.new('));
 assert.ok(code.indexOf('model.WorldPivot=CFrame.new(')<code.indexOf('return HttpService:JSONEncode({path=model:GetFullName()'));
 assert.ok(code.includes('for _,assetFolder in ipairs(workspace:GetChildren()) do'));
 assert.ok(code.includes('other:GetAttribute("RACJobId")'));
 assert.ok(code.includes('local gap=math.max(350,wantedSize.Magnitude*2,size.Magnitude*2)'));
});
test('Ollama memory diagnostic records split VRAM/CPU and survives offline service',async()=>{
 const warnings=[];
 const log={warn:(...args)=>warnings.push(args),info:()=>{}};
 await ollamaMemoryDiagnostic({log,fetcher:async()=>({ok:true,json:async()=>({
   models:[{name:'local:8b',size:8000000000,size_vram:4000000000}]
 })})});
 assert.ok(warnings.some(x=>String(x[0]).includes('OLLAMA_VRAM')));
 const result=await ollamaMemoryDiagnostic({log,fetcher:async()=>{throw new Error('offline')}});
 assert.deepEqual(result,[]);
 assert.ok(warnings.some(x=>String(x[0]).includes('OLLAMA_PS')));
});
test('images never leave to a nonlocal provider',async()=>{
 await assert.rejects(visionStructuredChat({provider:'openai',images:[{mimeType:'image/png',data:'AAAA'}],
   messages:[{role:'user',content:'test'}],schema:null}),e=>e.code==='LOCAL_VISION_REQUIRED');
});
