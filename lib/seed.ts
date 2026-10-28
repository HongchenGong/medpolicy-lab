import { MODULES,MILESTONES } from './catalog';
import { all,run,tx,now,setSetting,audit } from './db';
import { hashPassword } from './auth';
import { loadSeedConfig,seedConfigSchema,type SeedConfig } from './seed-config';
export async function seed(adminPassword:string,forceChange=false,config:SeedConfig=loadSeedConfig()){
 seedConfigSchema.parse(config);
 if((await all('SELECT id FROM users')).length)throw new Error('数据库已有账号，初始化不会覆盖现有密码或数据。');
 if(adminPassword.length<12||adminPassword===config.memberPassword)throw new Error('管理员密码至少12位且必须独立设置。');
 const members=config.members,hashes:string[]=[];
 for(let i=0;i<members.length;i++)hashes.push(await hashPassword(i===0?adminPassword:config.memberPassword));
 await tx(async()=>{
  if((await all('SELECT id FROM users')).length)throw new Error('数据库已有账号，初始化不会覆盖现有密码或数据。');
  for(const [i,[name,id]]of members.entries())await run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',id,name,i===0?'ADMIN':'MEMBER',hashes[i],i===0?0:1,0,now());
  for(const [i,m]of MODULES.entries()){
   await run('INSERT INTO modules(id,title,category,purpose,questions,deliverables,start_at,due_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',m.id,m.title,m.category,m.purpose,JSON.stringify(m.questions),JSON.stringify(m.deliverables),'2026-10-28T01:00:00.000Z','2026-10-30T10:00:00.000Z',now());
   await run('INSERT INTO assignments(module_id,user_id,assigned_by,start_at) VALUES(?,?,?,?)',m.id,members[i+1][1],members[0][1],now());
  }
  for(const [i,[title,at,description]]of MILESTONES.entries())await run('INSERT INTO milestones VALUES(?,?,?,?)','M'+(i+1),title,new Date(at).toISOString(),description);
  await setSetting('force_password_change',String(forceChange));await setSetting('public_progress','true');await setSetting('peer_open','false');await setSetting('peer_summaries','false');
  await audit(members[0][1],'project.initialize','project',{users:12,modules:11,forcePasswordChange:forceChange});
 });
}
