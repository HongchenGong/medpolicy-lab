import { backup } from 'node:sqlite';
import { mkdirSync,cpSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { db,uploadsDir } from '../lib/db';
async function main(){
 const target=path.resolve(process.argv[2]||`backups/${new Date().toISOString().replaceAll(':','-')}`);mkdirSync(target,{recursive:true,mode:0o700});
 // Uploads are append-only. Snapshot SQLite first, then copy files so every referenced file exists.
 await backup(db(),path.join(target,'medpolicy.sqlite'));
 cpSync(uploadsDir,path.join(target,'uploads'),{recursive:true,force:false});
 writeFileSync(path.join(target,'RESTORE.txt'),'停止应用后，将 medpolicy.sqlite 和 uploads 复制到新的空 DATA_DIR。不要保留旧数据库的 -wal/-shm 文件。验证后再启动。备份含个人资料，请妥善保管。\n',{mode:0o600});
 console.log('备份完成：'+target);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
