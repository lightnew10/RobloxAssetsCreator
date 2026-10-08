import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inferCategory,loadCategoryPrompt} from '../src/categories.js';
import {config} from '../src/config.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fixtures=JSON.parse(await readFile(path.join(root,'data/eval/objects.json'),'utf8')).objects;
const checks=[];
for(const item of fixtures){
  const selected=inferCategory(item),known=item.category===selected;
  const template=await loadCategoryPrompt(selected);
  const sizeValid=Array.isArray(item.sizeStuds)&&item.sizeStuds.length===3&&
    item.sizeStuds.every(n=>Number.isFinite(n)&&n>=.2&&n<=200);
  checks.push({id:item.id,category:item.category,classifier:selected,matched:known,
    sizeValid,templateAvailable:template.startsWith('# Gabarit'),visualScore:'not_measured'});
}
const passed=checks.filter(x=>x.matched&&x.sizeValid&&x.templateAvailable).length;
const report={createdAt:new Date().toISOString(),fixtures:checks.length,passed,failed:checks.length-passed,
  averageVisualScore:null,baselineVisualComparison:'not_measured',
  note:'Static category/schema test only. Studio captures and human scores are required for a visual comparison.',
  checks};
await mkdir(path.join(config.dataRoot,'runtime'),{recursive:true});
await writeFile(path.join(config.dataRoot,'runtime','evaluation.json'),JSON.stringify(report,null,2));
console.log('Static fixture evaluation: '+passed+'/'+checks.length+' passed. Visual scores NOT measured.');
if(passed!==checks.length){console.error(checks.filter(x=>!x.matched||!x.sizeValid||!x.templateAvailable));process.exitCode=1;}
