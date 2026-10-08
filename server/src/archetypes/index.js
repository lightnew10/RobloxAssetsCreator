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
  const groups=new Map();
  for(const c of components){
    const g=group([c.name,c.role,c.shape].join(' '));
    if(!groups.has(g))groups.set(g,[]);
    groups.get(g).push(c.id);
  }
  const counters=new Map();
  const mapped=parts.map((item)=>{
    const g=group(item.componentId)==='generic'?group(item.name):group(item.componentId);
    const candidates=groups.get(g)||groups.get('generic')||components.map(c=>c.id);
    const next=counters.get(g)||0;
    counters.set(g,next+1);
    return {...item,componentId:candidates[next%candidates.length]};
  });
  // Guarantee every plan component appears if at least one primitive exists per
  // component, without creating a fake parent or corrupting the schema.
  if(mapped.length>=components.length){
    const present=new Set(mapped.map(x=>x.componentId));
    for(const component of components){
      if(present.has(component.id))continue;
      const match=mapped.findIndex((item)=>group(item.componentId)===group(component.name));
      if(match>=0){mapped[match].componentId=component.id;present.add(component.id);}
    }
  }
  return mapped;
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
