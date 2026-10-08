import {clamp,color,number,parameterSchema,part,profileParams,rgb,sizeOf} from './utils.js';
export const id='house';
export const defaults={height:.7,width:.82,depth:.77,roofSlope:.52,wallColor:[196,171,133],roofColor:[126,67,53],material:'WoodPlanks'};
export const schema=parameterSchema({
  height:number(.3,1),width:number(.35,1),depth:number(.35,1),roofSlope:number(.2,.9),
  wallColor:rgb,roofColor:rgb,material:{type:'string',enum:['WoodPlanks','Brick','Concrete','SmoothPlastic']}
});
export function build(params={},ctx={}){
  const s=sizeOf(ctx),p=profileParams(ctx.profile),parts=[];
  const h=clamp(params.height,.3,1,.7)*s[1]*p.height,w=clamp(params.width,.35,1,.82)*s[0]*p.length,
    d=clamp(params.depth,.35,1,.77)*s[2]*p.radius,slope=clamp(params.roofSlope,.2,.9,.52);
  const wall=color(params.wallColor,[196,171,133]),roof=color(params.roofColor,[126,67,53]);
  const mat=['WoodPlanks','Brick','Concrete','SmoothPlastic'].includes(params.material)?params.material:'WoodPlanks';
  const wallHeight=h*(1-.32*slope),thick=Math.max(.15,Math.min(w,d)*.07);
  const push=(name,grp,shape,sz,pos,rot,col,material=mat)=>parts.push(part(name,grp,shape,sz,pos,rot,col,material,true));
  push('front_wall','walls','box',[w,wallHeight,thick],[0,wallHeight/2,-d/2+thick/2],[0,0,0],wall);
  push('back_wall','walls','box',[w,wallHeight,thick],[0,wallHeight/2,d/2-thick/2],[0,0,0],wall);
  for(const sign of [-1,1])push('side_wall_'+sign,'walls','box',[thick,wallHeight,d],
    [sign*(w/2-thick/2),wallHeight/2,0],[0,0,0],wall);
  const roofHeight=h-wallHeight,half=w*.56;
  for(const sign of [-1,1])push('roof_'+sign,'roof','wedge',[half,roofHeight,d*1.1],
    [sign*w*.23,wallHeight+roofHeight/2,0],[0,sign<0?180:0,0],roof,'Slate');
  push('door','door','box',[w*.2,wallHeight*.58,thick*.2],[0,wallHeight*.29,-d/2-thick*.06],[0,0,0],[88,58,42]);
  for(const sign of [-1,1])push('window_'+sign,'windows','box',[w*.17,wallHeight*.22,thick*.25],
    [sign*w*.28,wallHeight*.56,-d/2-thick*.13],[0,0,0],[89,147,170],'Glass');
  return {parts};
}
export default {id,schema,defaults,build};
