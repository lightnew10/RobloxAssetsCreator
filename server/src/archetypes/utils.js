// Independent parametric construction utilities; no Roblox proprietary code.
export const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max,Math.max(min,Number(value))) : fallback;
export const round = (n) => Number(n.toFixed(4));
export const dim = (x) => round(Math.max(0.08,x));
export const color = (v, fallback) => Array.isArray(v) && v.length===3 ? v.map((n,i)=>Math.round(clamp(n,0,255,fallback[i]))) : [...fallback];
export const sizeOf = (ctx) => Array.isArray(ctx?.sizeStuds) && ctx.sizeStuds.length===3 ? ctx.sizeStuds.map(n=>clamp(n,1,200,10)) : [10,12,10];
export function rng(seed=1){let x=(Number(seed)||1)>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
export const mix=(a,b,t)=>a+(b-a)*t;
export const deg=(x)=>x*180/Math.PI;
export function bezier(a,b,c,t){return [0,1,2].map(i=>(1-t)*(1-t)*a[i]+2*(1-t)*t*b[i]+t*t*c[i]);}
export function part(name,componentId,shape,size,position,rotation,colorValue,material,canCollide=false){
  return {name,componentId,shape,size:size.map(dim),position:position.map(round),rotation:rotation.map(round),
    color:colorValue,material,canCollide};
}
// Roblox's Parts builder treats size[1] as cylinder axial length and rotates local Y.
export function segment(name,group,a,b,radius,colorValue,material='SmoothPlastic'){
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz);
  if(length<0.04)return null;
  // CFrame.Angles(x,0,z): local Y becomes (-sin(z),cos(x)cos(z),sin(x)cos(z)).
  const rx=deg(Math.atan2(dz,dy)),rz=-deg(Math.asin(Math.max(-1,Math.min(1,dx/length))));
  return part(name,group,'cylinder',[radius*2,length,radius*2],
    [(a[0]+b[0])/2,Math.max(0,(a[1]+b[1])/2),(a[2]+b[2])/2],
    [rx,0,rz],colorValue,material);
}
export function bounds(parts){
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(const p of parts)for(let i=0;i<3;i++){
    low[i]=Math.min(low[i],p.position[i]-p.size[i]/2);
    high[i]=Math.max(high[i],p.position[i]+p.size[i]/2);
  }
  return high.map((v,i)=>round(v-low[i]));
}
export function parameterSchema(fields) {
  return {type:'object',additionalProperties:false,properties:fields};
}
export const number=(min,max)=>({type:'number',minimum:min,maximum:max});
export const integer=(min,max)=>({type:'integer',minimum:min,maximum:max});
export const rgb={type:'array',minItems:3,maxItems:3,items:{type:'integer',minimum:0,maximum:255}};
export function profileParams(id){
  return {
    silhouette:{height:1.12,curvature:1.65,length:1.22,radius:0.95,count:1,segments:1},
    detail:{height:1.06,curvature:1.1,length:1.08,radius:1,count:1.33,segments:1.45},
    compact:{height:0.76,curvature:0.85,length:0.73,radius:0.82,count:0.85,segments:1},
    expressive:{height:1.04,curvature:1.9,length:1.12,radius:0.98,count:1.1,segments:1.1},
    clean:{height:1.02,curvature:0.85,length:1.02,radius:1.08,count:0.78,segments:0.75},
    balanced:{height:1,curvature:1,length:1,radius:1,count:1,segments:1}
  }[id] || {height:1,curvature:1,length:1,radius:1,count:1,segments:1};
}
