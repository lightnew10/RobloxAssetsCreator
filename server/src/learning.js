import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const file = path.join(config.dataRoot, 'runtime', 'learning.json');

const key = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80);
async function read() {
  try { return JSON.parse(await readFile(file,'utf8')); } catch { return { version:1, lessons:[] }; }
}
async function write(data) {
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify(data,null,2),'utf8');
  await rename(tmp,file);
}
export async function relevantLessons({name,category,subtype},limit=12) {
  const data=await read();
  const nameKey=key(name), categoryKey=key(category), subtypeKey=key(subtype);
  return (data.lessons||[]).filter((lesson)=>
    (subtypeKey && lesson.subtypeKey===subtypeKey) ||
    (categoryKey && lesson.categoryKey===categoryKey) ||
    (nameKey && lesson.nameKey===nameKey)
  ).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);
}
export async function learnFromSelection(job,variant) {
  const data=await read();
  data.lessons ||= [];
  const texts=[
    ...(job.feedback||[]).filter((entry)=>entry.source !== 'auto_review').map((entry)=>entry.text),
    variant?.review?.improvement ? 'Critique finale : '+variant.review.improvement : '',
    ...(variant?.review?.criteria||[]).filter((c)=>c.score>=8).map((c)=>'Critère validé : '+c.name+' — '+c.comment),
  ].map((x)=>String(x||'').trim()).filter(Boolean);
  const seen=new Set(data.lessons.map((x)=>x.text));
  const added=[];
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
