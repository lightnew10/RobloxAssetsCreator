import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
export const metricsPath=path.join(config.dataRoot,'runtime','metrics.jsonl');
let queue=Promise.resolve();
export function createVariantMetric(job,variant){
  const start=Date.parse(variant.startedAt||variant.createdAt||job.createdAt);
  const end=Date.parse(variant.finishedAt||new Date().toISOString());
  const lookup=new Map((job.variants||[]).map(v=>[v.id,v]));
  let correctionRound=0,ancestor=variant.correctionOf,seen=new Set([variant.id]);
  while(ancestor && lookup.has(ancestor) && !seen.has(ancestor)){
    seen.add(ancestor);correctionRound++;ancestor=lookup.get(ancestor).correctionOf;
  }
  const descendantCorrections=(job.variants||[]).filter(x=>x.correctionOf===variant.id).length;
  return {
    at:new Date(end).toISOString(),jobId:job.id,variantId:variant.id,
    engineUsed:variant.engineUsed||null,archetype:variant.geometryDefinition?.archetype||null,
    corrections:Math.max(correctionRound,descendantCorrections),
    correctionRound,finalScore:Number.isFinite(variant.review?.score)?variant.review.score:null,
    durationMs:Number.isFinite(end-start)?Math.max(0,end-start):null,
  };
}
export async function recordVariantMetric(job,variant,{destination=metricsPath}={}){
  const entry=createVariantMetric(job,variant);
  const task=queue.catch(()=>{}).then(async()=>{await mkdir(path.dirname(destination),{recursive:true});await appendFile(destination,JSON.stringify(entry)+'\n','utf8');return entry;});
  queue=task;
  return task;
}
