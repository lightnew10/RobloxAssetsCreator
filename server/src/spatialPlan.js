export const spatialComponentSchema={type:'object',additionalProperties:false,required:['name','shape','material'],properties:{
  id:{type:'string'},name:{type:'string'},role:{type:'string'},shape:{type:'string'},material:{type:'string'},
  parentId:{type:'string'},parent:{type:'string'},attachment:{type:'string'},
  relativeSize:{type:'array',items:{type:'number'}},relativePosition:{type:'array',items:{type:'number'}},orientation:{type:'array',items:{type:'number'}},
  curvature:{type:'number'},density:{type:'number'},repetition:{type:'number'},distribution:{type:'string'},
  silhouetteRole:{type:'string'},constraints:{type:'array',items:{type:'string'}}
}};
export const spatialPlanSchema={type:'object',additionalProperties:false,required:['sizeStuds','components','essentialCriteria','captureViews','nativeMethod'],properties:{
  sizeStuds:{type:'array',items:{type:'number'}},components:{type:'array',items:spatialComponentSchema},essentialCriteria:{type:'array',items:{type:'string'}},
  captureViews:{type:'array',items:{type:'string'}},nativeMethod:{type:'string',enum:['generate_mesh','generate_procedural_model']}
}};
export const spatialRelationRepairSchema={type:'object',additionalProperties:false,required:['relationships'],properties:{relationships:{type:'array',maxItems:24,items:{type:'object',additionalProperties:false,required:['componentId','parentId'],properties:{componentId:{type:'string'},parentId:{type:'string'}}}}}};

const bounded=(v,n=120)=>String(v??'').trim().slice(0,n);
const key=(v)=>bounded(v,90).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const idKey=(v)=>key(v).replace(/\s+/g,'_').slice(0,54);
const validDimension=(v)=>Number.isFinite(v)&&v>=.2&&v<=200;
const vec=(v,min=-4,max=4)=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(Number(x)))?v.map(x=>Math.max(min,Math.min(max,Number(x)))):null;

export function coerceSpatialSize(value){
  let c=null;
  if(Array.isArray(value))c=value.slice(0,3).map(Number);
  else if(value&&typeof value==='object')c=[value.width??value.x??value.w,value.height??value.y??value.h,value.depth??value.z??value.d].map(Number);
  else if(typeof value==='string')c=value.match(/-?\d+(?:[.,]\d+)?/g)?.slice(0,3).map(x=>Number(x.replace(',','.')))||[];
  return c?.length===3&&c.every(validDimension)?c:null;
}
function normalizeComponents(raw=[]){
  const used=new Set(),sourceIds=new Map(),entries=[];
  for(const [index,item] of raw.slice(0,24).entries()){
    const source=bounded(item?.id,70),base=idKey(source||item?.name)||('component_'+(index+1));let id=base,n=2;while(used.has(id))id=base+'_'+n++;
    used.add(id);if(source){const a=sourceIds.get(source)||[];a.push(id);sourceIds.set(source,a);}
    const c={id,name:bounded(item?.name,70),role:bounded(item?.role,70),shape:bounded(item?.shape),material:bounded(item?.material)};
    const parentId=bounded(item?.parentId,70),parent=bounded(item?.parent,70),attachment=bounded(item?.attachment,120),relativeSize=vec(item?.relativeSize,.01,4),relativePosition=vec(item?.relativePosition,-4,4),orientation=vec(item?.orientation,-360,360);
    if(parentId)c.parentId=parentId;else if(parent)c.parent=parent;if(attachment)c.attachment=attachment;if(relativeSize)c.relativeSize=relativeSize;if(relativePosition)c.relativePosition=relativePosition;if(orientation)c.orientation=orientation;
    if(Number.isFinite(Number(item?.curvature)))c.curvature=Math.max(-1,Math.min(1,Number(item.curvature)));
    if(Number.isFinite(Number(item?.density)))c.density=Math.max(0,Math.min(1,Number(item.density)));
    if(Number.isFinite(Number(item?.repetition)))c.repetition=Math.max(1,Math.min(256,Math.round(Number(item.repetition))));
    if(bounded(item?.distribution,160))c.distribution=bounded(item.distribution,160);if(bounded(item?.silhouetteRole,160))c.silhouetteRole=bounded(item.silhouetteRole,160);
    const constraints=Array.isArray(item?.constraints)?item.constraints.slice(0,8).map(x=>bounded(x,160)).filter(Boolean):[];if(constraints.length)c.constraints=constraints;if(!c.role)delete c.role;
    if(c.name&&c.shape)entries.push(c);
  }
  return{components:entries,sourceIds};
}
const unique=(map,k)=>{const a=map.get(k)||[];return a.length===1?a[0]:null;};
// The Roblox Model is an implicit container, not a geometry component.
// Only detach absent virtual roots when the reference is unambiguously a
// container (known literal or a root_* ID shared by multiple components).
function virtualRootReference(ref, siblings) {
  const id=idKey(ref);
  return ['root','asset_root','model_root','scene_root','world_root'].includes(id)
    || (id.startsWith('root_') && siblings>=2);
}
function dedupeIssues(issues) {
  const seen=new Set();
  return issues.filter(issue=>{
    const key=[issue.code,issue.componentId||'',issue.parentReference||issue.parentId||''].join('|');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
function cycleIssues(components){
  const byId=new Map(components.map(c=>[c.id,c])),out=[];
  for(const c of components){const seen=new Set([c.id]);let parent=c.parentId;while(parent){if(seen.has(parent)){out.push({code:'parent_cycle',componentId:c.id,component:c.name,parentId:parent});break;}seen.add(parent);parent=byId.get(parent)?.parentId;}}
  return out;
}
export function repairSpatialParents(components=[],{sourceIds=new Map()}={}){
  const out=components.map(c=>({...c})),ids=new Set(out.map(c=>c.id)),exact=new Map(),names=new Map(),roles=new Map();
  const add=(m,k,id)=>{if(!k)return;const a=m.get(k)||[];a.push(id);m.set(k,a);};
  for(const c of out){add(exact,c.name,c.id);add(names,key(c.name),c.id);add(roles,key(c.role),c.id);}
  const repairs=[],unresolved=[];
  const referenceCounts=new Map();
  for(const c of out){
    const ref=bounded(c.parentId||c.parent,90);
    if(ref)referenceCounts.set(idKey(ref),(referenceCounts.get(idKey(ref))||0)+1);
  }
  for(const c of out){
    const requested=bounded(c.parentId||c.parent,90);delete c.parent;if(!requested){delete c.parentId;continue;}
    let parent=ids.has(requested)?requested:unique(sourceIds,requested)||unique(exact,requested)||unique(names,key(requested))||unique(roles,key(requested)),reason=ids.has(requested)?'stable_id':'alias';
    if(!parent && virtualRootReference(requested,referenceCounts.get(idKey(requested))||0)){
      delete c.parentId;
      repairs.push({
        code:'virtual_root_detached',
        componentId:c.id,
        component:c.name,
        from:requested,
        to:null,
        reason:'implicit_roblox_model_container',
      });
      continue;
    }
    if(!parent){
      const wanted=new Set(key(requested).split(' ').filter(t=>t.length>2));
      const candidates=out.filter(x=>x.id!==c.id).map(x=>{const tokens=new Set(key((x.name||'')+' '+(x.role||'')).split(' ').filter(t=>t.length>2));const overlap=[...wanted].filter(t=>tokens.has(t)).length;return{id:x.id,score:overlap/Math.max(1,wanted.size,tokens.size)};}).filter(x=>x.score>=.5).sort((a,b)=>b.score-a.score);
      if(candidates[0]?.score>=.66&&(!candidates[1]||candidates[0].score-candidates[1].score>=.2)){parent=candidates[0].id;reason='unique_token_match';}
      else unresolved.push({code:candidates.length>1?'ambiguous_parent':'missing_parent',componentId:c.id,component:c.name,parentReference:requested,candidates:candidates.slice(0,4)});
    }
    if(parent===c.id){c.parentId=requested;unresolved.push({code:'self_parent',componentId:c.id,component:c.name,parentReference:requested});continue;}
    if(parent){c.parentId=parent;c.parent=out.find((entry)=>entry.id===parent)?.name||parent;if(parent!==requested||reason!=='stable_id')repairs.push({code:'parent_reference_resolved',componentId:c.id,component:c.name,from:requested,to:parent,reason});}
    else {c.parentId=requested;c.parent=requested;}
  }
  unresolved.push(...cycleIssues(out));
  return{components:out,repairs,unresolved};
}
export function repairAiSpatialPlan(raw={}){
  const rawComponents=(raw?.components||[]).slice(0,24),normalized=normalizeComponents(rawComponents),repaired=repairSpatialParents(normalized.components,{sourceIds:normalized.sourceIds}),repairs=[...repaired.repairs];
  const dropped=rawComponents.length-normalized.components.length;if(dropped)repairs.push({code:'invalid_components_dropped',count:dropped,reason:'missing_name_or_shape'});
  return{input:{...raw,components:repaired.components},repairs,unresolved:repaired.unresolved,rawComponents:structuredClone(rawComponents),normalizedComponents:structuredClone(repaired.components)};
}
export function applySpatialRelationRepairs(rawOrPrepared,relationships=[]){
  const base=structuredClone(rawOrPrepared?.input||rawOrPrepared||{}),components=base.components||[],ids=new Set(components.map(c=>c.id)),applied=[],rejected=[];
  for(const r of relationships){const id=bounded(r?.componentId,70),parent=bounded(r?.parentId,70),c=components.find(x=>x.id===id);if(!c||(parent&&!ids.has(parent))||parent===id){rejected.push({componentId:id,parentId:parent||null,reason:!c?'unknown_component':parent===id?'self_parent':'unknown_parent'});continue;}const before=c.parentId||null;if(parent)c.parentId=parent;else delete c.parentId;delete c.parent;applied.push({code:'ai_relation_repair',componentId:id,from:before,to:parent||null,reason:'targeted_relation_resolution'});}
  const p=repairAiSpatialPlan(base);return{...p,repairs:[...applied,...p.repairs],rejected};
}
export function validateSpatialStructure(plan){
  const components=plan?.components||[],ids=new Set(),issues=[];
  for(const c of components){if(!c.id||ids.has(c.id))issues.push({code:'duplicate_or_empty_component_id',componentId:c.id||null,component:c.name||null});if(c.id)ids.add(c.id);if(c.relativeSize?.some(v=>!Number.isFinite(v)||v<=0))issues.push({code:'invalid_relative_size',componentId:c.id,component:c.name});}
  for(const c of components){if(c.parentId&&!ids.has(c.parentId))issues.push({code:'missing_parent',componentId:c.id,component:c.name,parentId:c.parentId});if(c.parentId===c.id)issues.push({code:'self_parent',componentId:c.id,component:c.name});}
  issues.push(...cycleIssues(components));return{passed:issues.length===0,issues};
}
export function normalizeSpatialPlan(raw,brief=null,fallbackSize=null){
  const fixed=coerceSpatialSize(brief?.size),requested=coerceSpatialSize(raw?.sizeStuds),fallback=coerceSpatialSize(fallbackSize),sizeStuds=fixed||requested||fallback;
  if(!sizeStuds)throw Object.assign(new Error('Dimensions du plan 3D invalides.'),{code:'ASSET_SPATIAL_DIMENSIONS_INVALID'});
  const prepared=repairAiSpatialPlan(raw),components=prepared.input.components,essentialCriteria=(brief?.essentials||raw?.essentialCriteria||[]).slice(0,10).map(x=>bounded(x,90)).filter(Boolean),captureViews=(brief?.views||raw?.captureViews||[]).slice(0,3).map(x=>bounded(x)).filter(Boolean);
  if(!components.length||!essentialCriteria.length||captureViews.length!==3)throw Object.assign(new Error('Plan 3D incomplet : composants, critères ou captures manquants.'),{code:'ASSET_SPATIAL_PLAN_INCOMPLETE'});
  const plan={sizeStuds,components,essentialCriteria,captureViews,nativeMethod:raw?.nativeMethod==='generate_mesh'?'generate_mesh':'generate_procedural_model',dimensionFallback:!fixed&&!requested&&fallback?{used:true,rejected:raw?.sizeStuds??null,replacement:sizeStuds,reason:'Dimensions IA absentes, incomplètes ou hors limites ; dimensions sûres issues du profil de l’objet.'}:null,structureNormalization:{repairs:prepared.repairs,unresolved:prepared.unresolved}};
  const structure=validateSpatialStructure(plan),issues=dedupeIssues([...prepared.unresolved,...structure.issues]);
  if(issues.length){const e=new Error('Plan 3D structurellement invalide : '+issues.map(x=>x.code).join(', ')+'.');e.code='ASSET_SPATIAL_STRUCTURE_INVALID';e.details=issues;throw e;}
  return plan;
}
export function acceptanceCriteria(plan){return(plan?.spatial?.essentialCriteria||[]).map(name=>({name,essential:true}));}
