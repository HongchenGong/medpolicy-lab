import { Readable } from 'node:stream';
import { readFileSync,writeFileSync,unlinkSync,mkdirSync,createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { uploadsDir } from './db';
export const remoteStorage=()=>Boolean(process.env.SUPABASE_URL);
function config(){
 const url=process.env.SUPABASE_URL?.replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;const bucket=process.env.STORAGE_BUCKET||'medpolicy-private';
 if(!url||!key||!/^https:\/\//.test(url)||! /^[a-z0-9-]{3,63}$/.test(bucket))throw new Error('云端私有文件存储配置不完整');
 return {url,key,bucket};
}
async function request(route:string,init:RequestInit={}){
 const {url,key}=config();const r=await fetch(url+'/storage/v1/'+route,{...init,headers:{apikey:key,Authorization:'Bearer '+key,...init.headers},signal:AbortSignal.timeout(60000)});return r;
}
export async function ensurePrivateBucket(){
 const {bucket}=config();let r=await request('bucket/'+bucket);
 if(r.status===404){r=await request('bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:20*1024*1024})});if(!r.ok&&r.status!==409)throw new Error('无法建立私有资料存储桶');r=await request('bucket/'+bucket);}
 if(!r.ok)throw new Error('无法验证私有资料存储桶');const info=await r.json();if(info.public!==false)throw new Error('资料存储桶必须设为私有，已阻止启动');
}
function safeName(name:string){if(!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(name))throw new Error('无效存储路径');return name;}
export async function putObject(name:string,bytes:Buffer,mime:string){
 safeName(name);
 if(!remoteStorage()){mkdirSync(uploadsDir,{recursive:true,mode:0o700});writeFileSync(path.join(uploadsDir,name),bytes,{flag:'wx',mode:0o600});return;}
 const {bucket}=config();const r=await request('object/'+bucket+'/'+name,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:new Uint8Array(bytes)});if(!r.ok)throw new Error('资料上传未完成，请重试；原有版本保持不变');
}
export async function getObject(name:string,expectedHash?:string){
 safeName(name);let bytes:Buffer;
 if(remoteStorage()){const {bucket}=config();const r=await request('object/authenticated/'+bucket+'/'+name);if(!r.ok)throw new Error('无法读取资料原文件');bytes=Buffer.from(await r.arrayBuffer());}
 else bytes=readFileSync(path.join(uploadsDir,name));
 if(expectedHash&&createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new Error('资料完整性校验失败');return bytes;
}
export async function removeObject(name:string){
 safeName(name);
 if(!remoteStorage()){try{unlinkSync(path.join(uploadsDir,name));}catch{}return;}
 const {bucket}=config();const r=await request('object/'+bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[name]})});if(!r.ok)throw new Error('未完成上传的清理失败');
}

// Lazy streams keep ZIP memory usage bounded even when the final package is large.
export function objectStream(name:string,expectedHash:string){
 safeName(name);
 return Readable.from((async function*(){
  const hash=createHash('sha256');let size=0;
  if(remoteStorage()){
   const {bucket}=config();const response=await request('object/authenticated/'+bucket+'/'+name);
   if(!response.ok||!response.body)throw new Error('无法读取资料原文件');
   const reader=response.body.getReader();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024)throw new Error('资料超出大小限制');hash.update(value);yield Buffer.from(value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }else for await(const chunk of createReadStream(path.join(uploadsDir,name))){hash.update(chunk as Buffer);yield chunk;}
  if(hash.digest('hex')!==expectedHash)throw new Error('资料完整性校验失败');
 })());
}
