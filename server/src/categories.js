import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spatialPlanSchema} from './spatialPlan.js';
export const CATEGORIES=Object.freeze(['handheld','vehicle','building','vegetation','animal','furniture','infrastructure','generic']);
export const inventorySchema={
  ...spatialPlanSchema,
  required:[...spatialPlanSchema.required,'category'],
  properties:{...spatialPlanSchema.properties,category:{type:'string',enum:CATEGORIES}}
};
const WORDS={
  handheld:/poign[ée]e|handle|crayon|stylo|pen|pencil|sword|outil|tool|chargeur|connector|embout/i,
  vehicle:/voiture|car\b|truck|camion|v[ée]lo|bike|roues|wheels/i,
  building:/maison|house|building|boutique|shop|tour\b|tower|cabane|chalet/i,
  vegetation:/palm|cocot|tree|arbre|buisson|shrub|flower|fleur|plant|plante|feuillage/i,
  animal:/chat|cat\b|chien|dog\b|oiseau|bird|animal|cheval|horse/i,
  furniture:/chaise|chair|table|lit\b|bed\b|mobilier|bureau|desk|fauteuil/i,
  infrastructure:/route|road|pont|bridge|cl[oô]ture|fence|lampadaire|streetlight|rail/i
};
export function inferCategory(input={}){
  const hint=[input.category,input.subtype,input.name,input.brief].filter(Boolean).join(' ');
  for(const [category,pattern] of Object.entries(WORDS))if(pattern.test(hint))return category;
  return 'generic';
}
export function resolveCategory(proposed,input={}){
  const explicit=String(input.category||'').toLowerCase();
  const aliases={tree:'vegetation',bush:'vegetation',rock:'generic',building:'building',furniture:'furniture',
    prop:'generic',road:'infrastructure',bridge:'infrastructure'};
  if(CATEGORIES.includes(explicit) && explicit!=='generic')return explicit;
  if(aliases[explicit]&&aliases[explicit]!=='generic')return aliases[explicit];
  const deterministic=inferCategory(input);
  if(!CATEGORIES.includes(proposed))return deterministic;
  // An explicit recognized category or a strong keyword is more reliable than a
  // free-form AI guess that conflicts with the user's brief.
  if(deterministic!=='generic' && proposed!==deterministic)return deterministic;
  return proposed;
}
const promptDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../prompts/categories');
export async function loadCategoryPrompt(category){
  const safe=CATEGORIES.includes(category)?category:'generic';
  try{return await readFile(path.join(promptDir,safe+'.md'),'utf8');}
  catch(cause){if(cause.code==='ENOENT')return 'Catégorie : '+safe+'. Utilise uniquement les primitives génériques.';throw cause;}
}
