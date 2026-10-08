import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.js';
import {readLibrary} from './library.js';

async function jsonl(file){
  try{
    return (await readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).flatMap(line=>{
      try{return [JSON.parse(line)];}catch{return [];}
    });
  }catch(e){if(e.code==='ENOENT')return [];throw e;}
}
export async function learningStats(){
  const [library,metrics]=await Promise.all([
    readLibrary(),
    jsonl(path.join(config.dataRoot,'runtime','metrics.jsonl'))
  ]);
  const byCategory={};
  for(const example of library)byCategory[example.category]=(byCategory[example.category]||0)+1;
  const byEngine={};
  for(const entry of metrics){
    if(!Number.isFinite(entry.finalScore))continue;
    const bucket=byEngine[entry.engineUsed]||={count:0,sum:0};
    bucket.count++;bucket.sum+=entry.finalScore;
  }
  const engines=Object.fromEntries(Object.entries(byEngine).map(([engine,x])=>[engine,{
    count:x.count,avgScore:Math.round(x.sum/x.count*100)/100
  }]));
  let evaluation=null;
  try{
    const data=JSON.parse(await readFile(path.join(config.dataRoot,'runtime','evaluation.json'),'utf8'));
    evaluation={fixtures:data.fixtures,passed:data.passed,averageVisualScore:data.averageVisualScore||null,
      baselineComparison:data.baselineVisualComparison||'not_measured'};
  }catch(e){if(e.code!=='ENOENT')evaluation={error:'evaluation_not_available'};}
  return {totalValidated:library.length,byCategory,engines,evaluation};
}
