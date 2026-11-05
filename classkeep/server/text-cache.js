import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hashBytes} from './core.js';

// Call only after ownership / repository permission validation. Keys never contain user paths.
export class TextExtractionCache{
 constructor(directory){this.directory=directory;this.pending=new Map();}
 async get(signature,path,load,extract){
  const key=hashBytes(Buffer.from('text-v1:'+signature+':'+extname(path).toLowerCase()));
  if(this.pending.has(key)){const r=await this.pending.get(key);return {...r,hit:true};}
  const work=this.readOrExtract(key,path,load,extract);this.pending.set(key,work);
  try{return await work;}finally{this.pending.delete(key);}
 }
 async readOrExtract(key,path,load,extract){
  const filename=join(this.directory,key+'.json');
  try{
   const stat=await readFile(filename,'utf8');if(stat.length>1500000)throw Error('invalid cache');
   const value=JSON.parse(stat);
   if(value.version!==1||!Array.isArray(value.chunks)||value.chunks.length>500||value.chunks.some(c=>typeof c.text!=='string'||c.text.length>180000))throw Error('invalid cache');
   const chunks=value.chunks;chunks.truncated=!!value.truncated;return {chunks,hit:true};
  }catch{}
  const bytes=await load();if(bytes.length>10*1024*1024)throw Error('파일당 본문 읽기 한도를 초과했습니다.');
  const chunks=await extract(path,bytes);
  await mkdir(this.directory,{recursive:true});const temporary=filename+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,JSON.stringify({version:1,chunks,truncated:!!chunks.truncated}));await rename(temporary,filename);}catch{await unlink(temporary).catch(()=>{});}
  return {chunks,hit:false};
 }
}
