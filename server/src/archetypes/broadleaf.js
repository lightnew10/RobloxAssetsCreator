import {bezier,clamp,color,integer,number,parameterSchema,part,profileParams,rgb,rng,segment,sizeOf} from './utils.js';
export const id='broadleaf';
export const defaults={height:.82,curvature:.12,baseRadius:.07,branchCount:6,crownWidth:.52,segments:5,trunkColor:[100,72,48],leafColor:[72,149,73],material:'Wood'};
export const schema=parameterSchema({
  height:number(.3,1.1),curvature:number(-.55,.55),baseRadius:number(.025,.24),
  branchCount:integer(3,12),crownWidth:number(.2,.85),segments:integer(3,10),
  trunkColor:rgb,leafColor:rgb,material:{type:'string',enum:['Wood','SmoothPlastic','Grass','LeafyGrass']}
});
export function build(params={},ctx={}){
  const s=sizeOf(ctx),p=profileParams(ctx.profile),random=rng(ctx.seed),parts=[];
  const h=clamp(params.height,.3,1.1,.82)*s[1]*p.height, bend=clamp(params.curvature,-.55,.55,.12)*p.curvature;
  const r=clamp(params.baseRadius,.025,.24,.07)*Math.min(s[0],s[2])*p.radius;
  const width=clamp(params.crownWidth,.2,.85,.52)*Math.min(s[0],s[2])*p.length;
  const count=Math.round(clamp(params.branchCount,3,12,6)*p.count);
  const trunk=color(params.trunkColor,[100,72,48]),leaf=color(params.leafColor,[72,149,73]);
  const base=[0,0,0],mid=[bend*h*.20,h*.48,0],tip=[bend*h*.34,h*.72,bend*h*.08];
  const pieces=7;
  for(let i=0;i<pieces;i++){
    const piece=segment('trunk_'+i,'trunk',bezier(base,mid,tip,i/pieces),bezier(base,mid,tip,(i+1)/pieces),r*(1-.38*i/pieces),trunk,'Wood');
    if(piece)parts.push(piece);
  }
  const subdiv=Math.round(clamp(params.segments,3,10,5)*p.segments);
  for(let i=0;i<count;i++){
    const angle=i*2*Math.PI/count+(random()-.5)*.12;
    const length=width*(.64+.35*random()),height=tip[1]+h*(.1+random()*.12);
    const end=[tip[0]+Math.cos(angle)*length,height,tip[2]+Math.sin(angle)*length];
    for(let j=0;j<subdiv;j++){
      const a=[tip[0]+(end[0]-tip[0])*j/subdiv,tip[1]+(end[1]-tip[1])*j/subdiv,tip[2]+(end[2]-tip[2])*j/subdiv];
      const b=[tip[0]+(end[0]-tip[0])*(j+1)/subdiv,tip[1]+(end[1]-tip[1])*(j+1)/subdiv,tip[2]+(end[2]-tip[2])*(j+1)/subdiv];
      parts.push(segment('branch_'+i+'_'+j,'branch',a,b,r*.35*(1-j/subdiv*.65),trunk,'Wood'));
    }
    for(let k=0;k<4;k++){
      const t=.45+k*.14,center=[tip[0]+(end[0]-tip[0])*t,tip[1]+(end[1]-tip[1])*t+h*.1,
        tip[2]+(end[2]-tip[2])*t];
      const a=(.24+random()*.08)*width;
      parts.push(part('leaves_'+i+'_'+k,'foliage','ball',[a,a*.9,a],center,[0,0,0],leaf.map(n=>Math.round(clamp(n+(random()-.5)*24,0,255,n))),'Grass'));
    }
  }
  return {parts:parts.filter(Boolean).slice(0,180)};
}
export default {id,schema,defaults,build};
