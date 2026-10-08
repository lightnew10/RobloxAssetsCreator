// Structural sanity checks for parametric output, independent of vision AI.
export function validateArchetypeShape(archetype, parts, sizeStuds=[10,10,10]){
  const issues=[];
  const of=(prefix)=>parts.filter(p=>p.name.startsWith(prefix));
  if(!Array.isArray(parts)||!parts.length)return ['empty'];
  if(parts.some(p=>!Number.isFinite(p.position[1])||p.position[1]<0))issues.push('below_ground_center');
  const rooted=(nodes)=>{
    if(!nodes.length){issues.push('missing_root');return;}
    const root=nodes[0];
    if(root.position[1]-root.size[1]/2 > Math.max(.8,sizeStuds[1]*.09)) issues.push('root_floating');
  };
  if(archetype==='palmTree'){
    const trunks=of('trunk_'),fronds=of('frond_'),fruits=of('coconut_');
    rooted(trunks);
    if(!fronds.length)issues.push('missing_fronds');
    if(!fruits.length)issues.push('missing_coconuts');
    if(trunks.length&&fronds.length){
      const topY=Math.max(...trunks.map(p=>p.position[1]+p.size[1]/2));
      const stems=fronds.filter(p=>/_0$/.test(p.name));
      if(!stems.length||stems.some(p=>p.position[1]<topY-sizeStuds[1]*.25))issues.push('fronds_not_at_crown');
    }
  } else if(archetype==='broadleaf'){
    rooted(of('trunk_'));
    if(!of('leaves_').length)issues.push('missing_leaves');
  } else if(archetype==='house'){
    rooted(of('front_wall'));
    if(!of('roof_').length)issues.push('missing_roof');
  } else if(archetype==='rock'){
    rooted(of('core'));
  }
  return issues;
}
