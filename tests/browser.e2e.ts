import { MEMBERS,memberPassword,testConfig } from './fixtures';
import { chromium,expect,request as apiRequest } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import AdmZip from 'adm-zip';
const delay=(n:number)=>new Promise(r=>setTimeout(r,n));
async function main(){
 process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'medpolicy-browser-'));process.env.COOKIE_SECURE='false';delete process.env.APP_ORIGIN;
 const {seed}=await import('../lib/seed');const password=randomBytes(24).toString('hex');await seed(password,true,testConfig);
 const output=path.resolve('output/screenshots');mkdirSync(output,{recursive:true});
 const zip=new AdmZip();zip.addFile('[Content_Types].xml',Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));zip.addFile('word/document.xml',Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>浏览器验收研究材料。</w:t></w:r></w:p></w:body></w:document>'));
 const docPath=path.join(process.env.DATA_DIR,'research.docx');writeFileSync(docPath,zip.toBuffer());
 let server:ChildProcess;const base='http://127.0.0.1:3101';
 async function start(){server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3101'],{env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});let log='';server.stdout?.on('data',d=>log+=d);server.stderr?.on('data',d=>log+=d);for(let i=0;i<50;i++){try{if((await fetch(base+'/login')).ok)return;}catch{}await delay(200);}throw new Error('Server did not start: '+log);}
 async function stop(){if(server&&!server.killed){const closed=new Promise<void>(r=>server.once('exit',()=>r()));server.kill('SIGTERM');await closed;}}
 await start();const browser=await chromium.launch({channel:'chrome',headless:true});const errors:string[]=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),admin=await context.newPage();admin.on('pageerror',e=>errors.push(e.message));
  await admin.goto(base+'/login');await admin.screenshot({path:path.join(output,'login-desktop.png'),fullPage:true});
  await admin.getByLabel('学号',{exact:true}).fill(MEMBERS[0][1]);await admin.getByLabel('密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录工作台'}).click();await expect(admin.getByRole('heading',{name:MEMBERS[0][0]+'，研究从这里推进'})).toBeVisible();
  await admin.screenshot({path:path.join(output,'dashboard-desktop.png'),fullPage:true});
  await admin.goto(base+'/timeline');await expect(admin.getByRole('heading',{name:'把研究进度放在同一张图上'})).toBeVisible();await expect(admin.locator('.gantt-bar')).toHaveCount(11);await admin.getByRole('button',{name:'编辑R01计划'}).click();await admin.getByLabel('截止时间（北京时间）').fill('2026-10-31T18:00');await admin.getByRole('button',{name:'保存任务设置'}).click();await expect(admin.locator('dialog')).toHaveCount(0);await admin.screenshot({path:path.join(output,'timeline-desktop.png'),fullPage:true});
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}),member=await mobileContext.newPage();member.on('pageerror',e=>errors.push(e.message));
  await member.goto(base+'/login');await expect(member.getByLabel('学号',{exact:true})).toBeVisible();await member.getByLabel('学号',{exact:true}).fill(MEMBERS[1][1]);await member.getByLabel('密码',{exact:true}).fill(memberPassword);await member.getByRole('button',{name:'登录工作台'}).click();await expect(member.getByRole('heading',{name:'请先修改初始密码'})).toBeVisible();await member.getByLabel('当前密码',{exact:true}).fill(memberPassword);await member.getByLabel('新密码（至少10位）',{exact:true}).fill('Browser-member-pass-2026');await member.getByLabel('再次输入新密码',{exact:true}).fill('Browser-member-pass-2026');await member.getByRole('button',{name:'修改密码',exact:true}).click();await expect(member.getByRole('heading',{name:'药品审评审批与监管制度',exact:true})).toBeVisible();
  await member.screenshot({path:path.join(output,'my-task-mobile.png'),fullPage:true});
  await member.getByRole('button',{name:'提交材料',exact:true}).click();await member.getByLabel('研究摘要',{exact:true}).fill('本模块解释药品监管全流程，并明确政府监管的卫生经济学依据。');await member.locator('input[type=file]').setInputFiles(docPath);await member.locator('[name=source_title_1]').fill('课程教材的监管分析');await member.locator('[name=source_url_1]').fill('课程教材第19页');await member.locator('[name=source_title_2]').fill('国家医保局政策资料');await member.locator('[name=source_url_2]').fill('https://www.nhsa.gov.cn/');await member.getByLabel('本次修改说明',{exact:true}).fill('独立初稿，待组长核对政策来源。');await member.getByRole('button',{name:'提交研究材料',exact:true}).click();await expect(member.getByRole('status')).toContainText('已保存');
  await admin.goto(base+'/reviews');await expect(admin.locator('.submission-card')).toHaveCount(1);await admin.getByRole('button',{name:'录入评分与审核'}).click();for(const [label,value]of [['教材理论准确性（20分）','18'],['政策与证据可信度（25分）','23'],['理论与现实结合（20分）','18'],['思考深度与原创性（20分）','17'],['汇报素材可复用性（10分）','8'],['表达与学术规范（5分）','5']])await admin.getByLabel(label,{exact:true}).fill(value);await admin.getByLabel('主要问题',{exact:true}).fill('政策发布日期需补齐。');await admin.getByLabel('修改意见 / 审核依据',{exact:true}).fill('补充政策原文发布日期后重新提交，保留理论分析。');await admin.getByLabel('审核结论',{exact:true}).selectOption('REVISION');await admin.getByRole('button',{name:'保存评价与结论'}).click();await expect(admin.locator('dialog')).toHaveCount(0);await admin.screenshot({path:path.join(output,'review-desktop.png'),fullPage:true});
  await member.reload();await member.getByRole('button',{name:/审核与版本/}).click();await expect(member.getByText('补充政策原文发布日期后重新提交，保留理论分析。',{exact:true})).toBeVisible();
  const widths=await member.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));expect(widths.page).toBeLessThanOrEqual(widths.viewport);await member.screenshot({path:path.join(output,'feedback-mobile.png'),fullPage:true});
  const before=await context.request.get(base+'/api/state').then(r=>r.json());expect(before.submissions.length).toBe(1);const fileId=before.submissions[0].files[0].id;const downloaded=await context.request.get(base+'/api/files/'+fileId);expect(downloaded.ok()).toBeTruthy();expect((await downloaded.body()).equals(zip.toBuffer())).toBeTruthy();
  const settingsResponse=await context.request.patch(base+'/api/settings',{headers:{Origin:base},data:{force_password_change:false}});expect(settingsResponse.ok()).toBeTruthy();
  
  await Promise.all(MEMBERS.slice(1).map(async([,id],index)=>{const api=await apiRequest.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});try{const login=await api.post('/api/login',{data:{studentId:id,password:index===0?'Browser-member-pass-2026':memberPassword}});expect(login.ok()).toBeTruthy();const updated=await api.patch('/api/modules/R'+String(index+1).padStart(2,'0'),{data:{progress:20+index,actual_hours:index+1}});expect(updated.ok()).toBeTruthy();}finally{await api.dispose();}}));
  const shared=await context.request.get(base+'/api/state').then(r=>r.json());expect(shared.modules.every((m:any,i:number)=>m.progress===20+i)).toBeTruthy();
  await stop();await start();const after=await context.request.get(base+'/api/state');expect(after.ok()).toBeTruthy();const afterJson=await after.json();expect(afterJson.submissions[0].reviews[0].total).toBe(89);expect((await context.request.get(base+'/api/files/'+fileId)).ok()).toBeTruthy();
  for(const route of ['/dashboard','/tasks','/submissions','/reviews','/timeline','/members','/peer-review','/resources','/admin','/export','/account']){await admin.goto(base+route);await expect(admin.locator('main h1')).toBeVisible();}
  expect(errors).toEqual([]);
  console.log('浏览器验收通过：桌面管理员、手机成员改密与DOCX提交、真实HTTP评分退回、文件下载、11条甘特图、期限修改、全部页面、11个独立成员会话并发写入与组长读取、服务重启及移动端无横向溢出。');
  await context.close();await mobileContext.close();
 }finally{await browser.close();await stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
