const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)));
const finite=(v)=>Number.isFinite(Number(v));
const key=(v)=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const mean=(a,f=0)=>a.length?a.reduce((s,v)=>s+v,0)/a.length:f;

function family(value){
  const t=key(typeof value==='string'?value:[value?.role,value?.name,value?.shape,value?.silhouetteRole].filter(Boolean).join(' '));
  if(/trunk|tronc|stem|tige/.test(t))return'trunk';
  if(/branch|branche|limb|rameau/.test(t))return'branch';
  if(/leaf|feuille|frond|foliage|feuillage|crown|couronne|canopy/.test(t))return'foliage';
  if(/fruit|coconut|coco/.test(t))return'fruit';
  if(/flower|blossom|fleur/.test(t))return'flower';
  if(/rock|stone|roche|pierre|boulder/.test(t))return'rock';
  if(/wall|mur|facade/.test(t))return'wall';
  if(/roof|toit/.test(t))return'roof';
  if(/road|route|path|chemin|track/.test(t))return'road';
  if(/support|pillar|column|pilier|poteau/.test(t))return'support';
  if(/deck|platform|plateforme|floor|sol/.test(t))return'deck';
  if(/door|window|opening|porte|fenetre|ouverture/.test(t))return'opening';
  return'generic';
}
const target=(path,value,reason)=>({path,value:Number(Number(value).toFixed(4)),reason,source:'spatial_plan'});

export function deriveSpatialParameterTargets(plan,spec){
  if(!plan?.components?.length||!spec)return[];
  const groups=new Map();
  for(const c of plan.components){const f=family(c),list=groups.get(f)||[];list.push(c);groups.set(f,list);}
  const out=[],trunks=groups.get('trunk')||[],branches=groups.get('branch')||[],leaves=groups.get('foliage')||[];
  if(spec.generator==='tree'&&trunks.length){
    const c=trunks[0];
    if(c.relativeSize){
      out.push(target('trunk.heightRatio',clamp(c.relativeSize[1],.25,.95),'Hauteur du composant '+c.id));
      out.push(target('trunk.widthRatio',clamp(mean([c.relativeSize[0],c.relativeSize[2]].filter(finite).map(Number),spec.trunk.widthRatio),.02,.3),'Largeur du composant '+c.id));
    }
    if(finite(c.curvature))out.push(target('trunk.curve',clamp(Math.abs(c.curvature),0,.5),'Courbure du composant '+c.id));
    if(c.orientation?.some(v=>Math.abs(Number(v))>.1))out.push(target('trunk.lean',clamp((Number(c.orientation[2]||0)-Number(c.orientation[0]||0))/180,-.5,.5),'Inclinaison du composant '+c.id));
  }
  if(spec.generator==='tree'&&branches.length){
    const sizes=branches.flatMap(c=>c.relativeSize?[Math.max(...c.relativeSize.map(Number))]:[]);
    if(sizes.length)out.push(target('branches.lengthRatio',clamp(mean(sizes),.02,.8),'Longueur moyenne des branches du plan'));
    const reps=branches.filter(c=>finite(c.repetition)).map(c=>Number(c.repetition));
    out.push(target('branches.count',clamp(reps.length?reps.reduce((a,b)=>a+b,0):branches.length,1,24),'Nombre/répétition des branches du plan'));
    const origins=branches.flatMap(c=>c.relativePosition&&finite(c.relativePosition[1])?[Number(c.relativePosition[1])]:[]);
    if(origins.length)out.push(target('branches.originHeightRatio',clamp(mean(origins),.15,1),'Hauteur de départ des branches'));
    const curves=branches.filter(c=>finite(c.curvature)).map(c=>Math.abs(Number(c.curvature)));
    if(curves.length)out.push(target('branches.curve',clamp(mean(curves),0,1),'Courbure moyenne des branches'));
  }
  if(['tree','bush'].includes(spec.generator)&&leaves.length){
    const sizes=leaves.filter(c=>c.relativeSize).map(c=>c.relativeSize.map(Number));
    if(sizes.length){
      out.push(target('foliage.leafLengthRatio',clamp(mean(sizes.map(s=>Math.max(s[0],s[2]))),.05,1.5),'Longueur des feuilles/frondes du plan'));
      out.push(target('foliage.leafWidthRatio',clamp(mean(sizes.map(s=>Math.max(.01,Math.min(s[0],s[2])))),.02,.7),'Largeur des feuilles/frondes du plan'));
    }
    const curves=leaves.filter(c=>finite(c.curvature)).map(c=>Math.abs(Number(c.curvature)));
    if(curves.length)out.push(target('foliage.leafCurvature',clamp(mean(curves),0,1),'Courbure des feuilles/frondes du plan'));
    const densities=leaves.filter(c=>finite(c.density)).map(c=>Number(c.density));
    if(densities.length)out.push(target('foliage.density',clamp(mean(densities),.08,1),'Densité de feuillage du plan'));
    const ys=leaves.flatMap(c=>c.relativePosition&&finite(c.relativePosition[1])?[Number(c.relativePosition[1])]:[]);
    if(ys.length)out.push(target('foliage.centerHeightRatio',clamp(mean(ys),0,1),'Centre vertical du feuillage'));
    if(/asym|irregular|irregulier|decentre|decentr/.test(leaves.map(c=>key(c.distribution)).join(' ')))out.push(target('foliage.asymmetry',.45,'Distribution asymétrique demandée'));
  }
  return out;
}
export function mergeParameterTargets(derived=[],explicit=[]){
  const m=new Map();for(const t of [...derived,...explicit])if(t?.path&&finite(t.value))m.set(t.path,{...t,value:Number(t.value)});return[...m.values()];
}
export function variationProfileFor(plan,index=0,count=3,spec=null){
  const directions=plan?.variationDirections||[],direction=directions[index%Math.max(1,directions.length)]||('Variation '+(index+1));
  const profiles=[
    {strategy:'balanced',changes:[]},
    {strategy:'asymmetric_lean',changes:[['trunk.lean','increase',.08],['foliage.asymmetry','increase',.18],['branches.radialSpread','increase',-.08]]},
    {strategy:'extended_irregular',changes:[['branches.lengthRatio','multiply',1.12],['branches.curve','increase',.08],['foliage.leafLengthRatio','multiply',1.15],['foliage.density','multiply',.9],['foliage.asymmetry','increase',.1]]}
  ];
  const p=profiles[index%profiles.length];
  const parameterChanges=p.changes.map(([path,operation,value])=>({path,operation,value})).filter(c=>{if(!spec)return true;const[g,f]=c.path.split('.');return finite(spec?.[g]?.[f]);});
  return{id:'variation_'+(index+1)+'_of_'+Math.max(1,count),index,direction,strategy:p.strategy,parameterChanges};
}
const vectorOk=(v,pos=false)=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x)&&(!pos||Number(x)>0));
function assign(parts,components){
  const exact=new Map(components.map(c=>[key(c.name),c.id])),groups=new Map(),counters=new Map();
  for(const c of components){const f=family(c),a=groups.get(f)||[];a.push(c.id);groups.set(f,a);}
  return parts.map(part=>{
    if(part.componentId&&components.some(c=>c.id===part.componentId))return{...part};
    let id=exact.get(key(part.name));const f=family(part.name),candidates=groups.get(f)||[];
    if(!id&&candidates.length){const n=counters.get(f)||0;id=candidates[n%candidates.length];counters.set(f,n+1);}
    return id?{...part,componentId:id}:{...part};
  });
}
function materialize(c,plan,provenance){
  if(!vectorOk(c.relativeSize,true)||!vectorOk(c.relativePosition))return[];
  const size=c.relativeSize.map((v,i)=>clamp(v,.01,2)*Number(plan.sizeStuds[i])),position=c.relativePosition.map((v,i)=>Number(v)*Number(plan.sizeStuds[i]));
  const rotation=vectorOk(c.orientation)?c.orientation.map(Number):[0,0,0],f=family(c),t=key([c.role,c.name,c.shape].join(' '));
  const shape=/leaf|frond|feuille/.test(t)?'wedge':['trunk','branch','support'].includes(f)?'cylinder':/ball|sphere|round/.test(key(c.shape))?'ball':/wedge/.test(key(c.shape))?'wedge':'block';
  const color=f==='foliage'?[65,133,62]:['trunk','branch'].includes(f)?[116,83,52]:[110,110,105],curve=Math.abs(Number(c.curvature||0)),segments=['foliage','branch','trunk'].includes(f)&&curve>.08?Math.max(3,Math.min(8,Math.ceil(3+curve*5))):1;
  const axis=size.indexOf(Math.max(...size)),out=[];
  for(let i=0;i<segments;i++){const q=(i+.5)/segments-.5,ss=[...size],pp=[...position],rr=[...rotation];ss[axis]=Math.max(.08,size[axis]/segments*1.08);pp[axis]+=q*size[axis];pp[axis===1?0:1]+=curve*size[axis===1?0:1]*.55*(q*q-.25);rr[(axis+2)%3]+=curve*55*q;out.push({name:c.id+'_contract_'+(i+1),shape,position:pp.map(v=>Number(v.toFixed(4))),size:ss.map(v=>Number(Math.max(.08,v).toFixed(4))),color,material:String(c.material||'SmoothPlastic').slice(0,40),rotation:rr.map(v=>Number(v.toFixed(3))),componentId:c.id,provenance,contractRepair:true});}
  return out;
}
function coverage(components,parts){
  const m=new Map();for(const p of parts)if(p.componentId){const a=m.get(p.componentId)||[];a.push(p.name);m.set(p.componentId,a);}
  return components.map(c=>{const matched=parts.filter(p=>p.componentId===c.id);return{componentId:c.id,name:c.name,role:c.role||family(c),family:family(c),parentId:c.parentId||null,status:matched.length?'constructed':'missing',partNames:matched.map(p=>p.name),partShapes:[...new Set(matched.map(p=>p.shape))],partCount:matched.length,expectedShape:c.shape||null,curvature:finite(c.curvature)?Number(c.curvature):0,relativeSize:c.relativeSize||null,deterministicGeometryAvailable:vectorOk(c.relativeSize,true)&&vectorOk(c.relativePosition)}});
}
const readPath=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o);
export function effectiveParameterTargets(targets=[],spec=null,variationProfile=null){
  const base=new Map((targets||[]).filter(t=>t?.path&&finite(t.value)).map(t=>[t.path,{...t,value:Number(t.value)}]));
  for(const change of variationProfile?.parameterChanges||[]){
    const observed=readPath(spec,change.path);
    if(!finite(observed))continue;
    const previous=base.get(change.path);
    base.set(change.path,{...(previous||{}),path:change.path,baseValue:previous?.value??null,value:Number(observed),reason:variationProfile.direction||previous?.reason||'Controlled variant difference',source:'variation_profile',variationId:variationProfile.id});
  }
  return[...base.values()];
}
function parameterCoverage(targets,spec){return(targets||[]).map(t=>{const observed=readPath(spec,t.path),expected=Number(t.value),tol=Math.max(.015,Math.abs(expected)*.03),applied=finite(observed)&&Math.abs(Number(observed)-expected)<=tol;return{path:t.path,expected,observed:finite(observed)?Number(observed):null,status:applied?'applied':'ignored',reason:t.reason||null};});}
function bounds(parts){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of parts){if(!vectorOk(p.position)||!vectorOk(p.size,true))continue;for(let i=0;i<3;i++){min[i]=Math.min(min[i],Number(p.position[i])-Number(p.size[i])/2);max[i]=Math.max(max[i],Number(p.position[i])+Number(p.size[i])/2);}}
  return min.every(Number.isFinite)&&max.every(Number.isFinite)?{min,max,size:min.map((v,i)=>max[i]-v)}:null;
}
export function attachConstructionContract({geometry,spatialPlan,assetSpec,parameterTargets=[],provenance={}}){
  if(!geometry?.parts||!spatialPlan?.components?.length)return{...geometry,constructionContract:null};
  const prov={sourcePlanVersion:provenance.sourcePlanVersion??null,sourceReferenceIds:provenance.sourceReferenceIds||[],sourceParameterTargets:provenance.sourceParameterTargets||parameterTargets.map(t=>t.path),sourceFeedbackIds:provenance.sourceFeedbackIds||[],generationAttemptId:provenance.generationAttemptId||null};
  let parts=assign(geometry.parts,spatialPlan.components).map(p=>({...p,provenance:{...prov,...(p.provenance||{})}})),report=coverage(spatialPlan.components,parts),repairs=[];
  for(const miss of report.filter(x=>x.status==='missing'&&x.deterministicGeometryAvailable)){const c=spatialPlan.components.find(x=>x.id===miss.componentId),added=materialize(c,spatialPlan,prov);if(added.length){parts.push(...added);repairs.push({code:'missing_component_materialized',componentId:c.id,partCount:added.length,reason:'plan_has_explicit_size_and_position'});}}
  parts=assign(parts,spatialPlan.components);report=coverage(spatialPlan.components,parts);
  return{...geometry,parts,constructionContract:{version:1,provenance:prov,componentCoverage:report,parameterCoverage:parameterCoverage(parameterTargets,assetSpec),repairs}};
}
export function auditGeometryContract(plan,geometry){
  const c=geometry?.constructionContract?.componentCoverage||coverage(plan?.components||[],geometry?.parts||[]),p=geometry?.constructionContract?.parameterCoverage||[],failures=[],warnings=[];
  for(const x of c.filter(v=>v.status!=='constructed'))(x.deterministicGeometryAvailable?failures:warnings).push({code:x.deterministicGeometryAvailable?'component_missing':'component_unverifiable',componentId:x.componentId,component:x.name});
  for(const x of c.filter(v=>v.status==='constructed')){
    const expected=key(x.expectedShape),allBall=x.partShapes?.length===1&&x.partShapes[0]==='ball',elongated=Array.isArray(x.relativeSize)&&Math.max(...x.relativeSize.map(Number))/Math.max(.001,Math.min(...x.relativeSize.map(Number)))>=2.5;
    const ballAllowed=/ball|sphere|round|cluster|clump|mass/.test(expected);
    if(allBall&&!ballAllowed&&['foliage','branch','trunk','road','wall','roof','support'].includes(x.family))failures.push({code:'structural_proxy_mismatch',componentId:x.componentId,component:x.name,expectedShape:x.expectedShape,observedShapes:x.partShapes});
    if(Math.abs(Number(x.curvature||0))>.15&&elongated&&['foliage','branch','trunk'].includes(x.family)&&Number(x.partCount||0)<3)failures.push({code:'insufficient_curve_segments',componentId:x.componentId,component:x.name,curvature:x.curvature,partCount:x.partCount});
  }
  for(const x of p.filter(v=>v.status!=='applied'))failures.push({code:'parameter_ignored',parameter:x.path,expected:x.expected,observed:x.observed});
  for(const [i,part] of (geometry?.parts||[]).entries())if(!vectorOk(part.position)||!vectorOk(part.size,true)||!vectorOk(part.rotation))failures.push({code:'invalid_part_geometry',part:part.name||i});
  const b=bounds(geometry?.parts||[]);if(b&&plan?.sizeStuds?.length===3)for(let i=0;i<3;i++){const r=b.size[i]/Math.max(.001,Number(plan.sizeStuds[i]));if(r<.35||r>2.5)failures.push({code:'bounding_box_mismatch',axis:'XYZ'[i],expected:Number(plan.sizeStuds[i]),observed:b.size[i]});}
  return{passed:failures.length===0,failures,warnings,componentCoverage:c,parameterCoverage:p,bounds:b,repairCount:geometry?.constructionContract?.repairs?.length||0};
}
export function structuredProblemsFromContract(audit){return(audit?.failures||[]).map(f=>({componentId:f.componentId||null,parameter:f.parameter||null,expected:f.expected??null,observed:f.observed??null,severity:['component_missing','invalid_part_geometry'].includes(f.code)?1:.85,problem:f.code,recommendedAction:f.code==='component_missing'?'rebuild':'patch'}));}
