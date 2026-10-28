import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { ensurePrivateBucket,putObject,getObject,objectStream,removeObject } from '../lib/storage';

test('私有对象存储协议：鉴权、不可覆盖、完整性、流式读取及错误处理',async()=>{
 const original=globalThis.fetch,env={...process.env};
 process.env.SUPABASE_URL='https://storage-contract.example';process.env.SUPABASE_SERVICE_ROLE_KEY=randomBytes(24).toString('hex');
 const objects=new Map<string,Buffer>();let created=false,publicBucket=false;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input)),headers=new Headers(init?.headers),p=url.pathname;
  assert.equal(url.hostname,'storage-contract.example');assert.equal(headers.get('Authorization'),'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY);
  if(p.endsWith('/bucket/medpolicy-private'))return Response.json(created?{public:publicBucket}:{error:'missing'},{status:created?200:404});
  if(p.endsWith('/bucket')&&init?.method==='POST'){assert.equal(JSON.parse(String(init.body)).public,false);created=true;return Response.json({ok:true});}
  const name=p.split('/').at(-1)!;
  if(init?.method==='POST'){assert.equal(headers.get('x-upsert'),'false');if(objects.has(name))return Response.json({error:'exists'},{status:409});objects.set(name,Buffer.from(init.body as Uint8Array));return Response.json({ok:true});}
  if(init?.method==='DELETE'){for(const n of JSON.parse(String(init.body)).prefixes)objects.delete(n);return Response.json({ok:true});}
  assert.ok(p.includes('/object/authenticated/'));const b=objects.get(name);return b?new Response(new Uint8Array(b)):new Response(null,{status:404});
 };
 try{
  await ensurePrivateBucket();const name=randomUUID()+'.txt',bytes=Buffer.from('原文件字节必须保留'),hash=createHash('sha256').update(bytes).digest('hex');
  await putObject(name,bytes,'text/plain');await assert.rejects(putObject(name,Buffer.from('changed'),'text/plain'));
  assert.deepEqual(await getObject(name,hash),bytes);
  const chunks:Buffer[]=[];for await(const chunk of objectStream(name,hash))chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);
  await assert.rejects(getObject(name,'invalid'));await assert.rejects(getObject('../secret.txt'));
  await removeObject(name);await assert.rejects(getObject(name));
  publicBucket=true;await assert.rejects(ensurePrivateBucket());
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
