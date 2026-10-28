import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,chmodSync } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool,types,type PoolClient } from 'pg';
import { sqliteSchema,postgresSchema } from './schema';
export const dataDir=path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || './data');
export const uploadsDir=path.join(dataDir,'uploads');
export type Row=Record<string,any>;
export const now=()=>new Date().toISOString();
let instance:DatabaseSync|undefined;
let pool:Pool|undefined;
let initialized:Promise<void>|undefined;
let embedded:import('@electric-sql/pglite').PGlite|undefined;
const localContext=new AsyncLocalStorage<boolean>();
const pgContext=new AsyncLocalStorage<PoolClient>();
let queue:Promise<unknown>=Promise.resolve();
export const cloudDatabase=()=>Boolean(process.env.DATABASE_URL);
const embeddedTest=()=>process.env.NODE_ENV==='test'&&Boolean(process.env.TEST_PGLITE_DIR);
async function locked<T>(fn:()=>Promise<T>):Promise<T>{
 if(localContext.getStore())return fn();
 const result=queue.then(()=>localContext.run(true,fn));queue=result.catch(()=>{});return result;
}
export function db(){
 if(cloudDatabase()||embeddedTest())throw new Error('此操作仅支持本地SQLite');
 if(instance)return instance;
 mkdirSync(uploadsDir,{recursive:true,mode:0o700});
 instance=new DatabaseSync(path.join(dataDir,'medpolicy.sqlite'));chmodSync(path.join(dataDir,'medpolicy.sqlite'),0o600);
 instance.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;'+sqliteSchema+'PRAGMA user_version=1;');return instance;
}
async function initialize(){
 if(!cloudDatabase()&&!embeddedTest()){db();return;}
 if(!initialized)initialized=(async()=>{
  if(embeddedTest()){
   const {PGlite}=await import('@electric-sql/pglite');embedded=new PGlite(process.env.TEST_PGLITE_DIR);await embedded.exec(postgresSchema);return;
  }
  // Keep all application tables outside Supabase's public/Data API schema.
  const connection=new URL(process.env.DATABASE_URL!);
  for(const name of ['sslmode','sslrootcert','sslcert','sslkey'])connection.searchParams.delete(name);
  types.setTypeParser(20,Number);
  pool=new Pool({connectionString:connection.toString(),max:4,connectionTimeoutMillis:15000,idleTimeoutMillis:20000,ssl:{rejectUnauthorized:true,...(process.env.DATABASE_CA_CERT?{ca:process.env.DATABASE_CA_CERT}:{})},options:'-c search_path=medpolicy'});
  const client=await pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(763207)');await client.query('CREATE SCHEMA IF NOT EXISTS medpolicy');await client.query('REVOKE ALL ON SCHEMA medpolicy FROM PUBLIC');await client.query('SET search_path=medpolicy');await client.query(postgresSchema);await client.query('COMMIT');}
  catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 })().catch(e=>{initialized=undefined;throw e;});
 await initialized;
}
export function postgresSql(sql:string){
 // Parameters use '?' outside quoted SQL literals; no string interpolation of values.
 let n=0,quoted=false,result='';
 for(let i=0;i<sql.length;i++){const c=sql[i];if(c==="'"){result+=c;if(quoted&&sql[i+1]==="'"){result+=sql[++i];continue;}quoted=!quoted;}else result+=c==='?'&&!quoted?'$'+(++n):c;}
 return result;
}
async function query(sql:string,params:any[],write=false):Promise<{rows:Row[];changes:number;lastInsertRowid?:number}>{
 await initialize();
 if(cloudDatabase()&&!embeddedTest()){
  const returning=write&&/^\s*INSERT INTO (login_attempts|audit_log|assignments)\s*\(/i.test(sql);
  const q=postgresSql(sql)+(returning?' RETURNING id':'');
  const result=await (pgContext.getStore()||pool!).query(q,params);
  return {rows:result.rows,changes:result.rowCount||0,lastInsertRowid:result.rows[0]?.id};
 }
 return locked(async()=>{
  if(embedded){
   const returning=write&&/^\s*INSERT INTO (login_attempts|audit_log|assignments)\s*\(/i.test(sql);
   const r=await embedded.query<Row>(postgresSql(sql)+(returning?' RETURNING id':''),params);
   return {rows:r.rows,changes:r.affectedRows||0,lastInsertRowid:Number(r.rows[0]?.id)};
  }
  const statement=db().prepare(sql);
  if(write){const r=statement.run(...params);return {rows:[],changes:Number(r.changes),lastInsertRowid:Number(r.lastInsertRowid)};}
  return {rows:statement.all(...params) as Row[],changes:0};
 });
}
export async function all(sql:string,...params:any[]):Promise<Row[]>{return (await query(sql,params)).rows;}
export async function one(sql:string,...params:any[]):Promise<Row|undefined>{return (await all(sql,...params))[0];}
export async function run(sql:string,...params:any[]){return query(sql,params,true);}
export async function tx<T>(fn:()=>T|Promise<T>):Promise<T>{
 await initialize();
 if(cloudDatabase()&&!embeddedTest()){
  if(pgContext.getStore())return fn();
  const client=await pool!.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(763207)');const result=await pgContext.run(client,fn);await client.query('COMMIT');return result;}
  catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 return locked(async()=>{
  const exec=async(s:string)=>{if(embedded)await embedded.exec(s);else db().exec(s);};
  await exec(embedded?'BEGIN':'BEGIN IMMEDIATE');
  try{const result=await fn();await exec('COMMIT');return result;}catch(e){await exec('ROLLBACK');throw e;}
 });
}
export async function closeDatabase(){await queue;if(pool)await pool.end();if(embedded)await embedded.close();if(instance)instance.close();pool=undefined;embedded=undefined;instance=undefined;initialized=undefined;}
export async function audit(actor:string|null,action:string,entity:string,details:unknown={}){await run('INSERT INTO audit_log(actor_id,action,entity,details,created_at) VALUES(?,?,?,?,?)',actor,action,entity,JSON.stringify(details),now());}
export async function setting(key:string){return (await one('SELECT value FROM settings WHERE key=?',key))?.value||'false';}
export async function setSetting(key:string,value:string){await run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value);}
export async function assignee(module:string){return (await one('SELECT user_id FROM assignments WHERE module_id=? AND end_at IS NULL',module))?.user_id;}
