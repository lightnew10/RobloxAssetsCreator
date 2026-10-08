import {mkdir,appendFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config} from './config.js';
import {resolveCategory} from './categories.js';
export const LIBRARY_VERSION=2;
export const libraryPath=path.join(config.dataRoot,'runtime','library.jsonl');
export const libraryArchivePath=path.join(config.dataRoot,'runtime','library-archive.jsonl');
const norm=(x)=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const keywords=(text)=>new Set(norm(text).match(/[a-z0-9]{3,}/g)||[]);
const rated=(x)=>x?.humanValidated===true&&x?.validationSource==='human_selection'&&
  Number.isFinite(x.humanRating)&&x.humanRating>=8&&x.humanRating<=10;
let writes=Promise.resolve();
export async function readLibrary(source=libraryPath){
  let text;
  try{text=await readFile(source,'utf8');}
  catch(e){if(e.code==='ENOENT')return [];throw e;}
  return text.split(/\r?\n/).filter(Boolean).flatMap(line=>{
    try{const entry=JSON.parse(line);return rated(entry)?[entry]:[];}catch{return [];}
  });
}
export function exampleFromSelection(job,variant,userRating){
  const score=typeof userRating==='number'?userRating:NaN;
  if(!Number.isFinite(score)||score<8||score>10||!job?.id||!variant?.id)return null;
  // Native results are not training examples without express platform authorization.
  if(variant.engineUsed==='native')return null;
  const definition=variant.geometryDefinition||null;
  const decomposition=definition?.primitives||null;
  const structured=decomposition || (definition?.archetype && definition?.params ?
    {archetype:definition.archetype,params:definition.params,variation:definition.variation}:null);
  if(!structured)return null;
  return {
    version:LIBRARY_VERSION,id:randomUUID(),createdAt:new Date().toISOString(),
    sourceJobId:job.id,sourceVariantId:variant.id,
    humanValidated:true,validationSource:'human_selection',humanRating:score,
    name:job.name,brief:job.brief,language:/[éèêàùç]/i.test(job.brief)?'fr':'unknown',
    keywords:[...keywords([job.name,job.brief,job.subtype].join(' '))].slice(0,80),
    category:job.plan?.category||job.category,subtype:job.subtype,
    visualAnalysis:job.referenceAnalysis||null,
    referencePaths:[],// filled from file materialization if the user provided photos
    inventory:job.plan||null,decomposition:structured,
    schemaVersion:job.schemaVersion||1,interpreterVersion:definition?.version||'legacy_archetype',
    engineUsed:variant.engineUsed,aiReview:variant.review||null,
    feedback:(job.feedback||[]).filter(x=>x?.source!=='auto_review').map(x=>({text:String(x.text||'').slice(0,1000),mode:x.mode||null})),
    correctionOf:variant.correctionOf||null,
  };
}
export async function saveLibrarySelection(job,variant,userRating,{destination=libraryPath,archive=libraryArchivePath,max=2000}={}){
  const entry=exampleFromSelection(job,variant,userRating);
  if(!entry)return null;
  const task=writes.catch(()=>{}).then(async()=>{
    const all=await readLibrary(destination);
    if(all.some(x=>x.sourceJobId===job.id&&x.sourceVariantId===variant.id))return null;
    const dir=path.dirname(destination);
    await mkdir(dir,{recursive:true});
    const refs=Array.isArray(job.referenceImages)?job.referenceImages:[];
    for(let i=0;i<Math.min(4,refs.length);i++){
      const m=String(refs[i]).match(/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
      if(!m)continue;
      const binary=Buffer.from(m[2],'base64');
      if(binary.length===0||binary.length>8*1024*1024)continue;
      const ext=m[1]==='jpeg'?'jpg':m[1],base=path.join(dir,'library_refs');
      await mkdir(base,{recursive:true});
      const fileName=job.id+'_'+variant.id+'_'+i+'.'+ext;
      await writeFile(path.join(base,fileName),binary);
      entry.referencePaths.push(path.posix.join('library_refs',fileName));
    }
    await appendFile(destination,JSON.stringify(entry)+'\n');
    // Avoid deleting old knowledge: move lowest rated/oldest examples to an archive.
    const entries=[...all,entry];
    if(entries.length>max){
      const rank=[...entries].sort((a,b)=>(b.humanRating-a.humanRating)||
        String(b.createdAt).localeCompare(String(a.createdAt)));
      const keep=rank.slice(0,max),archived=rank.slice(max);
      await appendFile(archive,archived.map(x=>JSON.stringify(x)).join('\n')+'\n');
      // Replace with a temp then retry atomic rename on Windows.
      // JSONL is not JSON; write temp explicitly and preserve the last valid file if renaming fails.
      const {rename}=await import('node:fs/promises');
      const tmp=destination+'.'+randomUUID()+'.tmp';
      await writeFile(tmp,keep.map(x=>JSON.stringify(x)).join('\n')+'\n');
      await rename(tmp,destination);
    }
    return entry;
  });
  writes=task;
  return task;
}
export async function searchLibrary({name='',brief='',category='',subtype=''},limit=3,{source=libraryPath}={}){
  const all=await readLibrary(source),query=keywords([name,brief,subtype].join(' '));
  const desiredCategory=resolveCategory(null,{name,brief,category,subtype});
  const ranked=all.map(entry=>{
    const words=keywords([entry.name,entry.brief,entry.subtype].join(' '));
    const matched=[...query].filter(word=>words.has(word)).length;
    const union=new Set([...query,...words]).size;
    return {entry,similarity:matched/Math.max(1,union),
      rank:(norm(desiredCategory)===norm(entry.category)?100:0)+(norm(subtype)===norm(entry.subtype)&&subtype?12:0)+
        10*matched/Math.max(1,union)};
  }).sort((a,b)=>b.rank-a.rank||String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)));
  return ranked.slice(0,Math.max(0,Math.min(3,limit))).map(x=>x.entry);
}
