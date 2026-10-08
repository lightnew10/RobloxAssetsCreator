import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const file = path.join(config.dataRoot, 'runtime', 'learning.json');
export const examplesPath = path.join(config.dataRoot, 'runtime', 'examples.jsonl');
const key = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80);
const tokens=(text)=>new Set(String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{3,}/g)||[]);

async function read() {
  try { return JSON.parse(await readFile(file,'utf8')); }
  catch(cause){if(cause.code==='ENOENT')return {version:1,lessons:[]};throw cause;}
}
async function write(data) {
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify(data,null,2),'utf8');
  await rename(tmp,file);
}
export async function readValidatedExamples(source=examplesPath){
  let data;
  try {data=await readFile(source,'utf8');}
  catch(cause){if(cause.code==='ENOENT')return [];throw cause;}
  return data.split(/\r?\n/).filter(Boolean).flatMap(line=>{
    try{
      const entry=JSON.parse(line);
      return entry?.humanValidated===true && entry.validationSource==='human_selection' &&
        Number.isFinite(entry.score) && entry.score>=8 && entry.score<=10 ? [entry] : [];
    }catch{return [];}
  });
}
let exampleQueue=Promise.resolve();
export async function saveValidatedExample(job,variant,{destination=examplesPath}={}){
  // Human selection alone is not enough: never promote a low/unknown score.
  const score=variant?.review?.score;
  if(!Number.isFinite(score)||score<8||score>10||!job?.id||!variant?.id)return null;
  const definition=variant.geometryDefinition || null;
  const example={
    id:randomUUID(),createdAt:new Date().toISOString(),sourceJobId:job.id,sourceVariantId:variant.id,
    humanValidated:true,validationSource:'human_selection',
    name:job.name,brief:job.brief,category:job.category,subtype:job.subtype,
    plan:job.plan,archetype:definition?.archetype||null,params:definition?.params||null,
    variation:definition?.variation||null,score,
    critique:variant.review,feedback:(job.feedback||[]).filter(x=>x?.source!=='auto_review')
      .map(x=>({text:String(x.text||'').slice(0,1200),mode:x.mode||null})),
    engineUsed:variant.engineUsed||null,
  };
  const task=exampleQueue.catch(()=>{}).then(async()=>{
    const existing=await readValidatedExamples(destination);
    if(existing.some(x=>x.sourceJobId===job.id&&x.sourceVariantId===variant.id))return null;
    await mkdir(path.dirname(destination),{recursive:true});
    await appendFile(destination,JSON.stringify(example)+'\n','utf8');
    return example;
  });
  exampleQueue=task;
  return task;
}
export async function relevantExamples({name,brief,category,subtype},limit=3,{source=examplesPath}={}){
  const list=await readValidatedExamples(source),query=tokens([name,brief,subtype].join(' '));
  const scored=list.map(x=>{
    const words=tokens([x.name,x.brief,x.subtype].join(' '));
    const overlap=[...query].filter(t=>words.has(t)).length;
    const similarity=overlap / Math.max(1,new Set([...query,...words]).size);
    const sameCategory=key(category)===key(x.category);
    return {entry:x,rank:(sameCategory?100:0)+(key(subtype)&&key(subtype)===key(x.subtype)?15:0)+similarity*10};
  }).sort((a,b)=>b.rank-a.rank||String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)));
  return scored.slice(0,Math.max(0,Math.min(3,limit))).map(x=>x.entry);
}
export async function relevantLessons({name,category,subtype},limit=12){
  const data=await read();
  const nameKey=key(name),categoryKey=key(category),subtypeKey=key(subtype);
  return (data.lessons||[]).filter(lesson=>lesson.validatedBy==='human_selection'&&(
    (subtypeKey&&lesson.subtypeKey===subtypeKey)||
    (categoryKey&&lesson.categoryKey===categoryKey)||
    (nameKey&&lesson.nameKey===nameKey)
  )).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);
}
export async function learnFromSelection(job,variant){
  // Only executed from explicit user selection, never from an automatic review.
  const example=await saveValidatedExample(job,variant);
  const data=await read();data.lessons||=[];
  const texts=[
    ...(job.feedback||[]).filter(x=>x?.source!=='auto_review').map(x=>x.text),
    variant?.review?.improvement?'Critique finale : '+variant.review.improvement:'',
    ...(variant?.review?.criteria||[]).filter(c=>c.score>=8).map(c=>'Critère validé : '+c.name+' — '+c.comment),
  ].map(x=>String(x||'').trim()).filter(Boolean);
  const seen=new Set(data.lessons.map(x=>x.text)),added=[];
  for(const text of texts){
    if(seen.has(text))continue;
    const lesson={
      id:randomUUID(),createdAt:new Date().toISOString(),sourceJobId:job.id,sourceVariantId:variant?.id||null,
      nameKey:key(job.name),categoryKey:key(job.category),subtypeKey:key(job.subtype),text:text.slice(0,1200),
      validatedBy:'human_selection',score:variant?.review?.score??null,
    };
    data.lessons.push(lesson);seen.add(text);added.push(lesson);
  }
  if(data.lessons.length>2000)data.lessons.splice(0,data.lessons.length-2000);
  await write(data);
  return added;
}
