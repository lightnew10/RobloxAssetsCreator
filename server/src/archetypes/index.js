import palmTree from './palmTree.js';
import broadleaf from './broadleaf.js';
import rock from './rock.js';
import house from './house.js';
import { bounds, profileParams } from './utils.js';

export const archetypes=Object.freeze({palmTree,broadleaf,rock,house});
export const archetypeIds=Object.freeze(Object.keys(archetypes));

// Used to constrain model output to a small fixed vocabulary. Actual per-archetype
// ranges are revalidated by builders, so bad params cannot build arbitrary instances.
const paramFields=Object.assign({},...Object.values(archetypes).map(entry=>entry.schema.properties));
export const proceduralGeometrySchema={
  type:'object', additionalProperties:false,required:['archetype','params','variation'],
  properties:{
    archetype:{type:'string',enum:archetypeIds},
    params:{type:'object',additionalProperties:false,properties:paramFields},
    variation:{type:'string',enum:['balanced','silhouette','detail','compact','expressive','clean']},
  }
};

export function guessArchetype(input={}){
  const hint=[input.category,input.subtype,input.name,input.brief].filter(Boolean).join(' ').toLowerCase();
  if (/palm|cocotier|coconut|palmi/.test(hint))return 'palmTree';
  if (/rock|stone|roche|pierre|boulder/.test(hint))return 'rock';
  if (/house|maison|building|cabane|chalet/.test(hint))return 'house';
  if (/tree|arbre|cerisier|oak|chêne|feuillu/.test(hint))return 'broadleaf';
  return null;
}
function group(value){
  const t=String(value||'').toLowerCase();
  if(/coconut|coco|fruit|noix/.test(t))return 'fruit';
  if(/leaf|frond|feuill|palme|foliage|couronne|crown/.test(t))return 'foliage';
  if(/trunk|tronc|stem|tige|racine/.test(t))return 'trunk';
  if(/branch|branche/.test(t))return 'branch';
  if(/roof|toit/.test(t))return 'roof';
  if(/window|fenêtre|fenetre/.test(t))return 'windows';
  if(/door|porte/.test(t))return 'door';
  if(/wall|mur/.test(t))return 'walls';
  return 'generic';
}
// The existing spatial plan uses arbitrary component ids. Map generated procedural
// groups onto those ids without inventing missing parents or deleting components.
function assignComponents(parts,plan){
  const components=plan?.components||[];
  if(!components.length)return parts;
  const map=new Map(), used=new Set();
  for(const component of components){
    const g=group([component.name,component.role,component.shape].join(' '));
    const at=parts.findIndex((item,i)=>!used.has(i)&&(
      group(item.name)===g || group(item.componentId)===g || g==='generic'));
    const index=at<0?parts.findIndex((item,i)=>!used.has(i)):at;
    if(index>=0){used.add(index);map.set(index,component.id);}
  }
  return parts.map((item,i)=>({...item,componentId:map.get(i)||components.find(c=>group(c.name)===group(item.name))?.id||components[0].id}));
}

export function buildProceduralGeometry(definition,plan,profile,seed){
  const archetype=archetypes[definition?.archetype];
  if(!archetype)return null;
  // The UI's profile is authoritative: a repeated LLM response cannot flatten V1/V2/V3.
  const variation=profile?.id||definition.variation||'balanced';
  const params=definition.params||{};
  const built=archetype.build(params,{sizeStuds:plan?.sizeStuds,profile:variation,seed});
  if(!Array.isArray(built.parts)||!built.parts.length)throw new Error('Archétype sans géométrie.');
  const parts=assignComponents(built.parts,plan);
  return {parts,definition:{archetype:definition.archetype,params,variation,parameterModifiers:profileParams(variation)},bounds:bounds(parts)};
}
