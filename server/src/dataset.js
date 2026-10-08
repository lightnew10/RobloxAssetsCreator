import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { examplesPath, readValidatedExamples } from './learning.js';

export function isExportableExample(entry){
  return entry?.humanValidated===true && entry.validationSource==='human_selection' &&
    Number.isFinite(entry.score) && entry.score>=8 && entry.score<=10 &&
    typeof entry.brief==='string' && entry.brief.trim().length>0 &&
    ['palmTree','broadleaf','rock','house'].includes(entry.archetype) &&
    entry.params && typeof entry.params==='object' && !Array.isArray(entry.params);
}
export function toTrainingChat(entry){
  return {messages:[
    {role:'system',content:'Choisis un archetype de geometrie 3D Roblox et ses parametres. JSON uniquement.'},
    {role:'user',content:JSON.stringify({brief:entry.brief,category:entry.category,subtype:entry.subtype,sizeStuds:entry.plan?.sizeStuds||null})},
    {role:'assistant',content:JSON.stringify({archetype:entry.archetype,params:entry.params,variation:entry.variation||'balanced'})},
  ]};
}
export async function exportDataset({source=examplesPath,destination=path.resolve('dataset.jsonl')}={}){
  const examples=(await readValidatedExamples(source)).filter(isExportableExample);
  await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,examples.map(x=>JSON.stringify(toTrainingChat(x))).join('\n')+(examples.length?'\n':''),'utf8');
  return {destination,count:examples.length};
}
