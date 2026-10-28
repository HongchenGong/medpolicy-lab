import { spawn } from 'node:child_process';
import { one,closeDatabase } from '../lib/db';
import { ensurePrivateBucket } from '../lib/storage';
import { seed } from '../lib/seed';
async function main(){
 for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])if(!process.env[key])throw new Error('缺少云端配置：'+key+'；不会退回临时磁盘保存数据');
 const origin=process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL;
 if(!origin||new URL(origin).protocol!=='https:')throw new Error('云端必须配置准确的HTTPS公开地址');
 await ensurePrivateBucket();
 if(!await one('SELECT id FROM users LIMIT 1')){
  if(!process.env.ADMIN_INITIAL_PASSWORD||!process.env.SEED_CONFIG_JSON)throw new Error('首次部署缺少私密账号初始化配置');
  await seed(process.env.ADMIN_INITIAL_PASSWORD,true);
 }
 await closeDatabase();
 const env:NodeJS.ProcessEnv={...process.env,APP_ORIGIN:new URL(origin).origin,COOKIE_SECURE:'true',TRUST_PROXY:'false'};
 delete env.ADMIN_INITIAL_PASSWORD;delete env.SEED_CONFIG_JSON;
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT||'3000'],{env,stdio:'inherit'});
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>child.kill(signal));
 child.once('exit',code=>{process.exitCode=code||0;});
}
main().catch(async()=>{console.error('云端启动检查未通过：请检查数据库TLS、私有存储桶及初始化环境变量。没有覆盖已有数据。');await closeDatabase();process.exitCode=1;});
