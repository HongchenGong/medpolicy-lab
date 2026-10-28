import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { seed } from '../lib/seed';
import { loadSeedConfig } from '../lib/seed-config';
import { closeDatabase } from '../lib/db';
import { dataDir } from '../lib/db';
async function hidden(prompt:string):Promise<string>{
 if(!process.stdin.isTTY)throw new Error('请使用交互式终端，或传入 --generate 安全生成密码。');
 process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let result='';const onData=(chunk:Buffer)=>{for(const char of chunk.toString()){
  if(char==='\u0003'){cleanup();reject(new Error('已取消'));return;}
  if(char==='\r'||char==='\n'){cleanup();resolve(result);return;}
  if(char==='\u007f'){result=result.slice(0,-1);continue;}if(char>=' ')result+=char;
 }};function cleanup(){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',onData);process.stdout.write('\n');}process.stdin.on('data',onData);});
}
async function main(){
 const generate=process.argv.includes('--generate');
 const password=generate?randomBytes(24).toString('base64url'):await hidden('设置组长独立密码（至少12位，输入不回显）：');
 if(!generate&&password!==await hidden('再次输入密码：'))throw new Error('两次密码不一致');
 const config=loadSeedConfig();await seed(password,process.argv.includes('--force-password-change'),config);
 if(generate){const file=path.join(dataDir,'admin-initial-password.txt');writeFileSync(file,`MedPolicy Lab 本地初始化凭据\n管理员：${config.members[0][0]}\n学号：${config.members[0][1]}\n密码：${password}\n\n请妥善保存、登录后修改密码并删除此文件。切勿上传到代码仓库或公开分享。\n`,{mode:0o600,flag:'wx'});console.log('随机管理员密码已写入仅本机用户可读文件：'+file);}
 console.log('初始化完成：12个独立账号，11个研究模块；组长不分配研究模块。普通成员首次使用学号登录。');
}
main().finally(closeDatabase).catch(e=>{console.error(e.message);process.exitCode=1;});
