import {bezier,clamp,color,integer,mix,number,parameterSchema,part,profileParams,rng,rgb,segment,sizeOf} from './utils.js';
export const id='palmTree';
export const schema=parameterSchema({
  height:number(0.3,1.1),curvature:number(-0.65,0.65),baseRadius:number(0.025,0.22),
  frondCount:integer(4,20),frondLength:number(0.18,0.7),segments:integer(3,12),
  trunkColor:rgb,leafColor:rgb,coconutColor:rgb,
  material:{type:'string',enum:['Wood','SmoothPlastic','Grass','LeafyGrass']}
});
export function build(params={},context={}){
  const s=sizeOf(context),v=profileParams(context.profile||'balanced'),random=rng(context.seed);
  const H=clamp(clamp(params.height,.3,1.1,.85)*s[1]*v.height,2,200,10);
  const bend=clamp(params.curvature,-.65,.65,.18)*v.curvature;
  const radius=clamp(params.baseRadius,.025,.22,.065)*Math.min(s[0],s[2])*v.radius;
  const count=Math.round(clamp(params.frondCount,4,20,10)*v.count);
  const leafLen=clamp(params.frondLength,.18,.7,.43)*Math.min(s[0],s[2])*v.length;
  const leafSegments=Math.max(3,Math.min(10,Math.round(clamp(params.segments,3,12,6)*v.segments)));
  const wood=color(params.trunkColor,[112,79,51]),green=color(params.leafColor,[59,147,74]),coco=color(params.coconutColor,[107,73,42]);
  const material=params.material==='SmoothPlastic'?'SmoothPlastic':'Wood';
  const root=[0,0,0],top=[H*bend*.22,H, H*bend*.10],middle=[top[0]*.28,H*.58,top[2]*.2];
  const parts=[];
  const trunkPieces=Math.max(6,Math.min(12,Math.round(H/1.75)));
  for(let i=0;i<trunkPieces;i++){
    const a=bezier(root,middle,top,i/trunkPieces),b=bezier(root,middle,top,(i+1)/trunkPieces);
    const taper=mix(1,.53,i/trunkPieces);
    const item=segment('trunk_'+i,'trunk',a,b,radius*taper,wood,material);
    if(item)parts.push(item);
  }
  // Two ranks of fronds; outer rank starts below the crown and droops more.
  for(let i=0;i<count;i++){
    const lower=i>=Math.ceil(count*.5),angle=2*Math.PI*i/(lower?Math.max(1,count-Math.ceil(count*.5)):Math.ceil(count*.5))
      +(lower?.27:0)+(random()-.5)*.10;
    const origin=[top[0],H-(lower?H*.055:0),top[2]];
    const length=leafLen*(lower?1.08:.88)*(0.92+random()*.16);
    const tip=[origin[0]+Math.cos(angle)*length,Math.max(H*.32,origin[1]-(lower?length*.60:length*.24)),origin[2]+Math.sin(angle)*length];
    const control=[origin[0]+Math.cos(angle)*length*.58,origin[1]+(lower?length*.19:length*.43),origin[2]+Math.sin(angle)*length*.58];
    // Narrow blade made of wedge pieces; width follows a sin-shaped envelope.
    for(let j=0;j<leafSegments;j++){
      const t0=j/leafSegments,t1=(j+1)/leafSegments;
      const a=bezier(origin,control,tip,t0),b=bezier(origin,control,tip,t1);
      const lengthPiece=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
      const width=Math.max(.10,length*.105*Math.pow(Math.sin(Math.PI*(t0+t1)/2),.7));
      const piece=segment('frond_'+i+'_'+j,'foliage',a,b,width*.33,
        green.map((n,k)=>Math.round(clamp(n+(lower?-5:5)+(random()-.5)*12,0,255,n))), 'SmoothPlastic');
      if(piece){piece.shape='wedge';piece.size=[width,lengthPiece,Math.max(.09,width*.18)].map(n=>Math.max(.08,n));parts.push(piece);}
    }
  }
  for(let i=0;i<3;i++){
    const a=i*Math.PI*2/3+.5,rr=radius*(1.8+.25*random());
    parts.push(part('coconut_'+i,'fruit','ball',[radius*.95,radius*.95,radius*.95],
      [top[0]+Math.cos(a)*rr,H-radius*(1.1+i*.15),top[2]+Math.sin(a)*rr],[0,0,0],coco,'SmoothPlastic'));
  }
  return {parts:parts.slice(0,180)};
}
export default {id,schema,build};
