import { inflateSync } from 'node:zlib';

// Exploratory *color + broad layout* descriptor, NOT a CLIP/semantic score.
// Only 8-bit non-interlaced RGB/RGBA PNG is handled; unsupported inputs are skipped.
export function pngDescriptor(base64){
  const file=Buffer.from(base64,'base64');
  if(file.length>16*1024*1024 || file.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return null;
  let at=8,width=0,height=0,bpp=0,compressed=[];
  while(at+12<=file.length){
    const length=file.readUInt32BE(at),type=file.toString('ascii',at+4,at+8);
    if(length>file.length-at-12) return null;
    const chunk=file.subarray(at+8,at+8+length);
    if(type==='IHDR'){
      width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);
      if(chunk[8]!==8 || (chunk[9]!==2 && chunk[9]!==6) || chunk[12]!==0)return null;
      bpp=chunk[9]===6?4:3;
    }
    if(type==='IDAT')compressed.push(chunk);
    at+=length+12;
    if(type==='IEND')break;
  }
  if(!width||!height||width*height>4e6||!bpp||!compressed.length)return null;
  const rowSize=width*bpp,raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(rowSize+1)*height+10});
  if(raw.length<(rowSize+1)*height)return null;
  const prev=Buffer.alloc(rowSize),row=Buffer.alloc(rowSize),feature=new Float64Array(4*4*4*4*4);
  let offset=0;
  for(let y=0;y<height;y++){
    const filter=raw[offset++];
    if(filter>4)return null;
    for(let x=0;x<rowSize;x++){
      const value=raw[offset++],left=x>=bpp?row[x-bpp]:0,above=prev[x],
        upperLeft=x>=bpp?prev[x-bpp]:0;
      let predictor=0;
      if(filter===1)predictor=left;
      else if(filter===2)predictor=above;
      else if(filter===3)predictor=Math.floor((left+above)/2);
      else if(filter===4){
        const p=left+above-upperLeft,pa=Math.abs(p-left),pb=Math.abs(p-above),pc=Math.abs(p-upperLeft);
        predictor=pa<=pb&&pa<=pc?left:pb<=pc?above:upperLeft;
      }
      row[x]=(value+predictor)&255;
    }
    const stride=Math.max(1,Math.floor(width/96));
    if(y%Math.max(1,Math.floor(height/96))===0)
      for(let x=0;x<width;x+=stride){
        const i=x*bpp;
        if(bpp===4&&row[i+3]<128)continue;
        const cellX=Math.min(3,Math.floor(x/width*4)),cellY=Math.min(3,Math.floor(y/height*4));
        const r=row[i]>>6,g=row[i+1]>>6,b=row[i+2]>>6;
        feature[((cellY*4+cellX)*64)+(r*16+g*4+b)]++;
      }
    row.copy(prev);
  }
  const norm=Math.hypot(...feature);
  return norm?Array.from(feature,n=>n/norm):null;
}
export function referenceSimilarity(refs,captures){
  const reference=refs.find(x=>x.mimeType==='image/png');
  const image=captures.find(x=>x.mimeType==='image/png');
  if(!reference||!image)return {available:false,reason:'PNG reference and PNG capture required'};
  try{
    const a=pngDescriptor(reference.data),b=pngDescriptor(image.data);
    if(!a||!b)return {available:false,reason:'Unsupported PNG layout'};
    const cosine=a.reduce((v,n,i)=>v+n*b[i],0);
    return {available:true,method:'spatial_color_histogram_png_v1',
      similarity:Math.round(Math.min(1,Math.max(0,cosine))*1000)/1000,
      warning:'Experimental coarse color/layout comparison; not CLIP, not an aesthetic or semantic score.'};
  }catch(cause){return {available:false,reason:'PNG decoding failed: '+cause.message.slice(0,100)};}
}
