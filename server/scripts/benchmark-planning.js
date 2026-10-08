import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { getProviderRuntime } from '../src/providerSettings.js';
import { proceduralGeometrySchema } from '../src/archetypes/index.js';
const model=process.argv[2]||getProviderRuntime('local').textModel;
const cases=[
  {category:'tree',brief:'Cocotier tropical fin et penché, longues palmes tombantes et noix de coco'},
  {category:'tree',brief:'Grand chêne feuillu avec tronc tordu et ramification asymétrique'},
  {category:'rock',brief:'Rocher volcanique angulaire gris foncé de forme irrégulière'},
  {category:'building',brief:'Petite maison en bois à toit incliné avec porte et fenêtres'},
];
const firstSchema={type:'object',additionalProperties:false,required:['archetype','sizeStuds'],properties:{
 archetype:proceduralGeometrySchema.properties.archetype,
 sizeStuds:{type:'array',minItems:3,maxItems:3,items:{type:'number',minimum:1,maximum:200}},
}};
const completeSchema={type:'object',additionalProperties:false,required:['archetype','sizeStuds','params','variation'],properties:{
 ...proceduralGeometrySchema.properties,sizeStuds:firstSchema.properties.sizeStuds,
}};
async function ask(user,schema){
 const t=Date.now(),res=await fetch(config.ollamaUrl.replace(/\/$/,'')+'/api/chat',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({model,stream:false,think:false,keep_alive:0,
      format:schema,options:{temperature:.1,num_ctx:config.ollamaNumCtx,num_predict:700},
      messages:[{role:'system',content:'Sélectionne un archétype de géométrie Roblox et ses paramètres, JSON uniquement.'},
        {role:'user',content:user}]})
 });
 if(!res.ok)throw Error('Ollama HTTP '+res.status+': '+(await res.text()).slice(0,300));
 const data=await res.json();return {answer:JSON.parse(data.message?.content||'null'),
   durationMs:Date.now()-t,tokens:data.eval_count??null};
}
const results=[];
for(const entry of cases){
 const one=await ask(JSON.stringify(entry),completeSchema).catch(e=>({error:e.message}));
 const stage1=await ask(JSON.stringify(entry),firstSchema).catch(e=>({error:e.message}));
 const stage2=stage1.answer?await ask(JSON.stringify({...entry,stage1:stage1.answer}),proceduralGeometrySchema).catch(e=>({error:e.message})):null;
 results.push({entry,oneStage:one,twoStage:{stage1,stage2,totalDurationMs:(stage1.durationMs||0)+(stage2?.durationMs||0)},
   oneValid:!!one.answer?.params,twoValid:!!stage1.answer?.archetype&&!!stage2?.answer?.params});
 console.log(entry.category,results.at(-1).oneValid?'one PASS':'one FAIL',results.at(-1).twoValid?'two PASS':'two FAIL');
}
const destination=path.join(config.dataRoot,'runtime','benchmark-planning.json');
await mkdir(path.dirname(destination),{recursive:true});
await writeFile(destination,JSON.stringify({at:new Date().toISOString(),model,numCtx:config.ollamaNumCtx,results},null,2),'utf8');
console.log('Rapport : '+destination+' — aucune stratégie adoptée automatiquement.');
