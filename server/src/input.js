import {assertAllowedBrief} from './contentPolicy.js';
// Pure input validation, no Studio dependency. Photos stay as local data URLs.
const photo=/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i;
export function normalizeAssetInput(input={}){
  const bounded=(x,max)=>String(x||'').trim().slice(0,max);
  const images=(Array.isArray(input.referenceImages)?input.referenceImages:[]).slice(0,4)
    .filter(x=>typeof x==='string').filter(x=>{
      const m=x.match(photo);return m && m[2].length*3/4<=5*1024*1024;
    });
  const text=bounded(input.brief||input.name,5000);
  const brief=text||(images.length?'Reconstruis l’objet visible sur la photo en low-poly Roblox, sans inventer de détails non visibles.':'');
  const name=bounded(input.name||text.slice(0,72)||(images.length?'Objet depuis une photo':''),80);
  if(!brief||!name)throw Object.assign(new Error('Fournis un texte ou une photo PNG/JPEG/WebP valide (5 Mo max).'),{code:'JOB_INPUT_INVALID'});
  assertAllowedBrief(brief);
  return {name,brief,referenceImages:images};
}
