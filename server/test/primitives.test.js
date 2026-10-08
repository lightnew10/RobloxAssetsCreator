import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretPrimitives,validatePrimitiveStructure,primitiveGeometrySchema,PRIMITIVE_TYPES} from '../src/primitives.js';
import {inferCategory,resolveCategory,inventorySchema,loadCategoryPrompt,CATEGORIES} from '../src/categories.js';
const plan={sizeStuds:[10,12,10],components:[{id:'body',name:'corps'}]};
const common={name:'test',material:'SmoothPlastic',color:[140,170,80]};
const specs=[
 {type:'box',position:[0,.5,0],size:[.4,.5,.3]},
 {type:'wedge',position:[0,.4,0],size:[.5,.4,.5]},
 {type:'ball',position:[0,.6,0],size:[.4,.4,.4]},
 {type:'cylinder',from:[0,0,0],to:[0,.8,0],radius:.09},
 {type:'cone',from:[0,0,0],to:[0,.8,0],radius:.12,segments:7},
 {type:'sweep',from:[0,0,0],control:[.2,.4,0],to:[.3,.8,0],radius:.1,endRadius:.03,segments:7},
 {type:'revolve',position:[0,0,0],profile:[[0,.15],[.2,.22],[.8,.11],[1,.08]]},
 {type:'extrude',position:[0,.2,0],profile:[[-.2,0],[.2,0],[.25,.7],[-.25,.7]],depth:.3},
 {type:'group',groupId:'handles'}
];
for(const spec of specs)test('primitive '+spec.type+' converts to valid Parts',()=>{
 const raw={components:[{componentId:'body',primitives:[{...common,...spec}]}]};
 assert.deepEqual(validatePrimitiveStructure(raw,plan),[]);
 const first=interpretPrimitives(raw,plan),second=interpretPrimitives(raw,plan);
 assert.deepEqual(first,second);
 if(spec.type==='group') assert.ok(first.parts.length===0 || first.parts.every(p=>p.groupId==='handles'));
 else {
   assert.ok(first.parts.length>0,spec.type);
   for(const part of first.parts){
     assert.ok(['box','ball','wedge','cylinder'].includes(part.shape));
     assert.ok(part.size.every(n=>n>=.2&&n<=200));
     assert.ok(part.position[1]>=0);
     assert.equal(part.componentId,'body');
   }
 }
});
test('nonexistent component rejected and named in structured error',()=>{
 assert.ok(validatePrimitiveStructure({components:[{componentId:'missing',primitives:[{type:'box',name:'bad'}]}]},plan)
    .some(x=>x.code==='missing_parent'));
 assert.throws(()=>interpretPrimitives({components:[{componentId:'missing',primitives:[{type:'box',name:'bad'}]}]},plan),
    e=>e.code==='PRIMITIVE_STRUCTURE_INVALID');
});
test('minimal size and ceiling checked, no silently overwritten component mapping',()=>{
 const raw={components:[{componentId:'body',primitives:Array.from({length:10},(_,i)=>({
   ...common,name:'block'+i,type:'box',position:[0,.02,0],size:[.2,.2,.2]
 }))}]};
 const out=interpretPrimitives(raw,plan,{maxParts:3});
 assert.ok(out.parts.length<=3);
 assert.ok(out.parts.every(p=>p.position[1]>=p.size[1]/2));
 assert.ok(out.warnings.some(w=>w.code==='too_many_parts_simplified'));
});
test('profile silhouette and compact differ deterministically in size',()=>{
 const raw={components:[{componentId:'body',primitives:[{...common,type:'box',size:[.4,.4,.4],position:[0,.4,0]}]}]};
 const a=interpretPrimitives(raw,plan,{profile:'silhouette'}),b=interpretPrimitives(raw,plan,{profile:'compact'});
 assert.notDeepEqual(a.parts[0].size,b.parts[0].size);
});
test('category templates are data files, classification is closed and deterministic',async()=>{
 assert.ok(CATEGORIES.includes(inferCategory({name:'voiture rouge'})));
 assert.equal(inferCategory({name:'voiture rouge'}),'vehicle');
 assert.equal(resolveCategory('animal',{name:'voiture rouge'}),'vehicle');
 assert.ok(inventorySchema.properties.category.enum.includes('generic'));
 assert.ok((await loadCategoryPrompt('vegetation')).includes('Végétal'));
 assert.ok((await loadCategoryPrompt('../../hidden')).includes('Générique'));
 assert.ok(PRIMITIVE_TYPES.includes('sweep'));
 assert.equal(primitiveGeometrySchema.properties.components.maxItems,24);
});
