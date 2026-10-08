import { segment, part, bezier } from './archetypes/utils.js';
import Ajv from 'ajv';

export const PRIMITIVE_TYPES=Object.freeze(['box','wedge','cylinder','ball','cone','sweep','revolve','extrude','group']);
export const PRIMITIVE_VERSION='1.0.0';
const vector=(min,max)=>({type:'array',minItems:3,maxItems:3,items:{type:'number',minimum:min,maximum:max}});
const point2={type:'array',minItems:2,maxItems:2,items:{type:'number',minimum:-1,maximum:1}};
const colorSchema={type:'array',minItems:3,maxItems:3,items:{type:'integer',minimum:0,maximum:255}};
export const primitiveSpecSchema={
  type:'object',additionalProperties:false,required:['type','name'],properties:{
    type:{type:'string',enum:PRIMITIVE_TYPES},
    name:{type:'string',maxLength:64},
    position:vector(-1,1),size:vector(0,1),rotation:vector(-360,360),
    from:vector(-1,1),to:vector(-1,1),control:vector(-1,1),
    radius:{type:'number',minimum:0,maximum:1},endRadius:{type:'number',minimum:0,maximum:1},
    segments:{type:'integer',minimum:2,maximum:12},
    profile:{type:'array',minItems:2,maxItems:12,items:point2},
    depth:{type:'number',minimum:0,maximum:1},
    color:colorSchema,material:{type:'string'},canCollide:{type:'boolean'},
    groupId:{type:'string',maxLength:64}
  }
};
export const primitiveGeometrySchema={
  type:'object',additionalProperties:false,required:['components'],properties:{
    components:{type:'array',minItems:1,maxItems:24,items:{
      type:'object',additionalProperties:false,required:['componentId','primitives'],
      properties:{componentId:{type:'string'},primitives:{type:'array',minItems:1,maxItems:10,items:primitiveSpecSchema}}
    }}
  }
};
const validateJson=new Ajv({allErrors:true,strict:false}).compile(primitiveGeometrySchema);
const allowedMaterials=new Set(['Plastic','SmoothPlastic','Wood','WoodPlanks','Metal','CorrodedMetal','Grass',
  'LeafyGrass','Concrete','Brick','Cobblestone','Rock','Slate','Sand','Snow','Ice','Glass','Fabric','Neon','Ground']);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const num=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const validVec=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(x=>Number.isFinite(x));
const colorOf=(v)=>validVec(v,3)?v.map(x=>Math.round(clamp(x,0,255))):[133,149,146];
const sizeFactors={
  balanced:[1,1,1],silhouette:[1.22,1.13,1.12],
  detail:[1.05,1.05,1.05],compact:[.78,.78,.78],expressive:[1.2,1.08,.94],clean:[1,1,1]
};
const safeName=(value,defaultName)=>String(value||defaultName).replace(/[^\p{L}\p{N}_ -]/gu,'').slice(0,60)||defaultName;
const rad=(deg)=>deg*Math.PI/180;
function rotatedBoxExtents(partSpec){
  // Conservative bounding box for transformed Parts, checking actual orientation.
  const [sx,sy,sz]=partSpec.size,[x,y,z]=partSpec.rotation.map(rad);
  const cx=Math.cos(x),sxr=Math.sin(x),cy=Math.cos(y),syr=Math.sin(y),cz=Math.cos(z),szr=Math.sin(z);
  const R=[
    [cy*cz,-cy*szr,syr],
    [cx*szr+sxr*syr*cz,cx*cz-sxr*syr*szr,-sxr*cy],
    [sxr*szr-cx*syr*cz,sxr*cz+cx*syr*szr,cx*cy],
  ];
  return [0,1,2].map(i=>Math.abs(R[i][0])*sx/2+Math.abs(R[i][1])*sy/2+Math.abs(R[i][2])*sz/2);
}
function finiteParts(parts){
  return parts.every(p=>validVec(p.position,3)&&validVec(p.rotation,3)&&validVec(p.size,3)&&
    p.size.every(x=>x>=.2&&x<=200)&&p.position[1]>=0);
}
export function validatePrimitiveStructure(raw,plan){
  const issues=[],ids=new Set((plan?.components||[]).map(x=>x.id));
  if(!validateJson(raw)){
    return [{code:'schema_violation',message:'JSON schema non conforme',
      details:validateJson.errors?.map(e=>({path:e.instancePath,keyword:e.keyword,message:e.message}))}];
  }
  const seen=new Set();
  for(const component of raw.components){
    if(!ids.has(component.componentId))issues.push({code:'missing_parent',componentId:component.componentId});
    if(seen.has(component.componentId))issues.push({code:'duplicate_component',componentId:component.componentId});
    seen.add(component.componentId);
    for(const [index,spec] of (component.primitives||[]).entries()){
      if(!PRIMITIVE_TYPES.includes(spec.type))issues.push({code:'schema_violation',componentId:component.componentId,index,field:'type'});
      for(const field of ['from','to','position','size','control'])if(spec[field]&&!validVec(spec[field],3))
        issues.push({code:'schema_violation',componentId:component.componentId,index,field});
      if(['sweep','cone','cylinder'].includes(spec.type)&& (!validVec(spec.from,3)||!validVec(spec.to,3)))
        issues.push({code:'schema_violation',componentId:component.componentId,index,field:'from/to'});
      if(['revolve','extrude'].includes(spec.type) && (!Array.isArray(spec.profile)||spec.profile.length<2))
        issues.push({code:'schema_violation',componentId:component.componentId,index,field:'profile'});
    }
  }
  for(const id of ids)if(!seen.has(id))issues.push({code:'component_missing',componentId:id});
  return issues;
}
export function interpretPrimitives(raw,plan,{profile='balanced',maxParts=180,minDetail=.2}={}){
  const errors=validatePrimitiveStructure(raw,plan);
  if(errors.length)throw Object.assign(new Error('Décomposition invalide : '+errors[0].code),{code:'PRIMITIVE_STRUCTURE_INVALID',details:errors});
  const scale=(plan?.sizeStuds||[10,10,10]).map(x=>clamp(num(x,10),1,200));
  const factors=sizeFactors[profile]||sizeFactors.balanced;
  const world=(v)=>[v[0]*scale[0]*factors[0],v[1]*scale[1]*factors[1],v[2]*scale[2]*factors[2]];
  const scaleSize=(v)=>v.map((x,i)=>Math.abs(x)*scale[i]*factors[i]);
  const warnings=[],parts=[];
  const add=(p)=>{
    if(!p)return;
    if(!finiteParts([p])){warnings.push({code:'degenerate_part',name:p.name});return;}
    const ext=rotatedBoxExtents(p);
    if(p.position[1]-ext[1]<-.05){
      // Project bottoms to the ground, rather than leaving geometry below Y=0.
      p.position[1]=Number((ext[1]+.01).toFixed(4));
      warnings.push({code:'below_ground_repaired',name:p.name});
    }
    parts.push(p);
  };
  for(const component of raw.components){
    const componentId=component.componentId;
    let activeGroup=componentId;
    for(const [index,s] of component.primitives.entries()){
      if(s.type==='group'){
        activeGroup=safeName(s.groupId||s.name,componentId);
        continue;
      }
      const name=safeName(s.name,componentId+'_'+index),material=allowedMaterials.has(s.material)?s.material:'SmoothPlastic';
      const color=colorOf(s.color),collide=s.canCollide!==false,groupId=safeName(s.groupId||activeGroup,componentId);
      const emit=(p)=>{if(p){p.groupId=groupId;p.canCollide=collide;add(p);}};
      const basePos=world(s.position||[0,.5,0]),baseSize=scaleSize(s.size||[.2,.2,.2]);
      if(['box','wedge','ball'].includes(s.type)){
        emit(part(name,componentId,s.type,baseSize,basePos,s.rotation||[0,0,0],color,material,collide));
        continue;
      }
      if(s.type==='group')continue;
      const from=world(s.from||[0,0,0]),to=world(s.to||[0,1,0]);
      if(['cylinder','sweep','cone'].includes(s.type)){
        const length=Math.hypot(...from.map((x,i)=>to[i]-x));
        if(length<minDetail){warnings.push({code:'degenerate_primitive',name});continue;}
        const a=clamp(num(s.radius,.035),0,.5)*Math.min(scale[0],scale[2]);
        const b=clamp(num(s.endRadius,s.type==='cone'?0:num(s.radius,.035)),0,.5)*Math.min(scale[0],scale[2]);
        const n=s.type==='cylinder'?1:clamp(Math.round(num(s.segments,7)+(profile==='detail'?2:profile==='clean'?-2:0)),2,12);
        for(let i=0;i<n;i++){
          const t0=i/n,t1=(i+1)/n;
          const point=(t)=>s.type==='sweep'&&validVec(s.control,3)?
            bezier(from,world(s.control),to,t):from.map((x,k)=>x+(to[k]-x)*t);
          const first=point(t0),last=point(t1);
          const radius=(a+(b-a)*(t0+t1)/2);
          if(radius*2<minDetail){warnings.push({code:'tiny_detail_skipped',name});continue;}
          const piece=segment(name+'_'+i,componentId,first,last,radius,color,material);
          emit(piece);
        }
        continue;
      }
      if(s.type==='revolve'){
        const sorted=[...(s.profile||[])].filter(p=>validVec(p,2)).sort((a,b)=>a[0]-b[0]);
        for(let i=0;i<sorted.length-1;i++){
          const h=Math.abs(sorted[i+1][0]-sorted[i][0])*scale[1]*factors[1],radius=Math.max(0,(sorted[i][1]+sorted[i+1][1])/2)*Math.min(scale[0],scale[2]);
          if(h<minDetail||radius*2<minDetail){warnings.push({code:'tiny_detail_skipped',name});continue;}
          emit(part(name+'_'+i,componentId,'cylinder',[radius*2,h,radius*2],[basePos[0],Math.max(h/2,(sorted[i][0]+sorted[i+1][0])/2*scale[1]+basePos[1]),basePos[2]],[0,0,0],color,material,collide));
        }
        continue;
      }
      if(s.type==='extrude'){
        // Scanline approximation of arbitrary polygons with axis-aligned bands.
        const poly=(s.profile||[]).filter(p=>validVec(p,2));
        if(poly.length<3){warnings.push({code:'degenerate_primitive',name});continue;}
        const ys=poly.map(p=>p[1]),lo=Math.min(...ys),hi=Math.max(...ys),bands=8;
        const depth=Math.abs(num(s.depth,.1))*scale[2];
        for(let j=0;j<bands;j++){
          const y=lo+(j+.5)/bands*(hi-lo),cross=[];
          for(let k=0;k<poly.length;k++){
            const a=poly[k],b=poly[(k+1)%poly.length];
            if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y))cross.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
          }
          cross.sort((a,b)=>a-b);
          for(let k=0;k+1<cross.length;k+=2){
            const width=(cross[k+1]-cross[k])*scale[0]*factors[0],height=(hi-lo)/bands*scale[1]*factors[1];
            if(Math.min(width,height,depth)<minDetail)continue;
            emit(part(name+'_'+j+'_'+k,componentId,'box',[width,height,depth],
              [basePos[0]+(cross[k]+cross[k+1])/2*scale[0],Math.max(height/2,basePos[1]+y*scale[1]),basePos[2]],
              s.rotation||[0,0,0],color,material,collide));
          }
        }
      }
    }
  }
  if(parts.length>maxParts){
    // Drop low-area details first, retain at least one Part per component.
    const score=p=>p.size.reduce((a,b)=>a*b,1);
    const bySmallest=[...parts].sort((a,b)=>score(a)-score(b));
    const count=new Map();for(const p of parts)count.set(p.componentId,(count.get(p.componentId)||0)+1);
    const discard=new Set();
    for(const p of bySmallest){
      if(parts.length-discard.size<=maxParts)break;
      if(count.get(p.componentId)<=1)continue;
      discard.add(p);count.set(p.componentId,count.get(p.componentId)-1);
    }
    warnings.push({code:'too_many_parts_simplified',original:parts.length,kept:parts.length-discard.size});
    parts.splice(0,parts.length,...parts.filter(p=>!discard.has(p)));
  }
  if(!parts.length)throw Object.assign(new Error('Interpréteur : aucune géométrie non dégénérée.'),{code:'EMPTY_PRIMITIVE_RESULT'});
  const bottom=Math.min(...parts.map(p=>p.position[1]-rotatedBoxExtents(p)[1]));
  if(bottom>.4)warnings.push({code:'floating_geometry',lowest:bottom});
  return {parts,warnings,primitiveVersion:PRIMITIVE_VERSION,definition:raw};
}
