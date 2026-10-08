import {clamp,color,integer,number,parameterSchema,part,profileParams,rgb,rng,sizeOf} from './utils.js';
export const id='rock';
export const defaults={height:.68,width:.8,lumps:7,roughness:.23,rockColor:[109,111,117],material:'Rock'};
export const schema=parameterSchema({
  height:number(.25,1),width:number(.25,1),lumps:integer(3,15),roughness:number(0,.65),
  rockColor:rgb,material:{type:'string',enum:['Rock','Slate','SmoothPlastic','Concrete']}
});
export function build(params={},ctx={}){
  const s=sizeOf(ctx),p=profileParams(ctx.profile),random=rng(ctx.seed),parts=[];
  const height=clamp(params.height,.25,1,.68)*s[1]*p.height;
  const width=clamp(params.width,.25,1,.8)*Math.min(s[0],s[2])*p.length;
  const count=Math.round(clamp(params.lumps,3,15,7)*p.count),rough=clamp(params.roughness,0,.65,.23);
  const base=color(params.rockColor,[109,111,117]),material=['Rock','Slate','Concrete','SmoothPlastic'].includes(params.material)?params.material:'Rock';
  parts.push(part('core','rock','ball',[width*.68,height*.85,width*.7],[0,height*.43,0],[0,0,0],base,material,true));
  for(let i=0;i<count;i++){
    const a=i*2*Math.PI/count+(random()-.5)*rough;
    const radial=width*(.16+.23*random()),hh=height*(.32+.47*random());
    const size=[width*(.24+.16*random()),hh,width*(.24+.16*random())];
    parts.push(part('facet_'+i,'rock',i%3?'wedge':'box',size,
      [Math.cos(a)*radial,hh/2,Math.sin(a)*radial],[(random()-.5)*30,a*180/Math.PI,(random()-.5)*35],
      base.map(n=>Math.round(clamp(n+(random()-.5)*35,0,255,n))),material,true));
  }
  return {parts};
}
export default {id,schema,defaults,build};
