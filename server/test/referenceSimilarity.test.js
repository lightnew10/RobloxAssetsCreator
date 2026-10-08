import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pngDescriptor,referenceSimilarity } from '../src/referenceSimilarity.js';
function chunk(type,content){
  const len=Buffer.alloc(4);len.writeUInt32BE(content.length);
  return Buffer.concat([len,Buffer.from(type),content,Buffer.alloc(4)]);
}
function png(rgb){
  const h=Buffer.alloc(13);h.writeUInt32BE(4,0);h.writeUInt32BE(4,4);h[8]=8;h[9]=2;
  const line=Buffer.from([0,...Array.from({length:4},()=>rgb).flat()]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),
    chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:4},()=>line)))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
test('identical PNG is similar; dissimilar RGB differs',()=>{
  const a=png([220,20,20]),b=png([20,20,220]);
  assert.equal(pngDescriptor(a).length,1024);
  assert.equal(referenceSimilarity([{mimeType:'image/png',data:a}],[{mimeType:'image/png',data:a}]).similarity,1);
  assert.ok(referenceSimilarity([{mimeType:'image/png',data:a}],[{mimeType:'image/png',data:b}]).similarity<.1);
});
test('unsupported images remain non-blocking',()=>{
  assert.equal(referenceSimilarity([{mimeType:'image/jpeg',data:'abc'}],[{mimeType:'image/png',data:'def'}]).available,false);
});
