import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { one,run,tx,closeDatabase } from '../lib/db';
import { ensurePrivateBucket,putObject,getObject } from '../lib/storage';
const tables=['users','settings','modules','assignments','subtasks','submissions','reviews','resources','resource_modules','files','milestones','contributions','peer_reviews','audit_log'];
async function main(){
 if(!process.env.DATABASE_URL||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('请先配置目标云端数据库和私有存储');
 const source=path.resolve(process.argv[2]||'./data');const db=new DatabaseSync(path.join(source,'medpolicy.sqlite'),{readOnly:true});
 try{
  if(await one('SELECT id FROM users LIMIT 1'))throw new Error('目标已有数据，已停止迁移，避免覆盖');
  db.exec('BEGIN');
  const snapshot=Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table).all() as Record<string,any>[]]));db.exec('COMMIT');
  await ensurePrivateBucket();
  for(const f of snapshot.files){
   const bytes=readFileSync(path.join(source,'uploads',f.storage_name));if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new Error('本地文件完整性校验失败');
   let exists=false;try{await getObject(f.storage_name,f.sha256);exists=true;}catch{}
   if(!exists)await putObject(f.storage_name,bytes,f.mime);
  }
  await tx(async()=>{
   if(await one('SELECT id FROM users LIMIT 1'))throw new Error('目标在迁移期间已被初始化，已停止');
   for(const table of tables)for(const row of snapshot[table]){
    const keys=Object.keys(row);if(keys.some(k=>! /^[a-z_]+$/.test(k)))throw new Error('源数据库字段不合法');
    await run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k]));
   }
   for(const table of ['assignments','audit_log'])await one(`SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE((SELECT MAX(id) FROM ${table}),1),EXISTS(SELECT 1 FROM ${table}))`);
   await run("UPDATE settings SET value='true' WHERE key='force_password_change'");
  });
  console.log('迁移完成，保留原账号哈希及历史；旧会话未迁移。文件数：'+snapshot.files.length);
 }finally{db.close();await closeDatabase();}
}
main().catch(()=>{console.error('迁移未完成。请核对目标连接、空库条件及原文件完整性；未覆盖已有目标数据。');process.exitCode=1;});
