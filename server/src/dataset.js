import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.js';
import {libraryPath,readLibrary} from './library.js';
export function isExportableExample(entry){
  return entry?.humanValidated===true&&entry.validationSource==='human_selection'&&
    Number.isFinite(entry.humanRating)&&entry.humanRating>=8&&entry.humanRating<=10&&
    entry.engineUsed!=='native'&&typeof entry.brief==='string'&&entry.brief.trim().length>0&&
    entry.decomposition&&typeof entry.decomposition==='object';
}
export function toTrainingChat(entry){
  return {messages:[
    {role:'system',content:'Génère une décomposition d’asset Roblox low-poly sous forme de primitives JSON. Aucune sortie Lua.'},
    {role:'user',content:JSON.stringify({brief:entry.brief,category:entry.category,sizeStuds:entry.inventory?.sizeStuds||null,
      components:entry.inventory?.components?.map(x=>({id:x.id,name:x.name,role:x.role,parentId:x.parentId}))||[]})},
    {role:'assistant',content:JSON.stringify(entry.decomposition)},
  ]};
}
export async function exportDataset({source=libraryPath,destination=path.join(config.dataRoot,'exports','dataset.jsonl')}={}){
  const examples=(await readLibrary(source)).filter(isExportableExample);
  await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,examples.map(x=>JSON.stringify(toTrainingChat(x))).join('\n')+(examples.length?'\n':''),'utf8');
  return {destination,count:examples.length};
}
