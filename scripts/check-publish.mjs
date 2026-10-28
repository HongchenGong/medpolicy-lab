import { execFileSync } from 'node:child_process';
import { readFileSync,lstatSync } from 'node:fs';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const prohibited=/^(data|backups|tmp|output|node_modules|\.next|test-results|playwright-report)\/|(^|\/)\.env(?!\.example$)|\.private\.|\.(sqlite|db|pem|key|pdf|pptx|docx|xlsx|png|jpe?g)$/i;
const patterns=[/sb_secret_[A-Za-z0-9_-]{20,}/,/gh[pousr]_[A-Za-z0-9]{25,}/,/github_pat_[A-Za-z0-9_]{40,}/,/sk-[A-Za-z0-9_-]{30,}/,/AKIA[A-Z0-9]{16}/,/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,/(?<!\d)230\d{7}(?!\d)/];
let failed=false;
for(const file of files){
 if(prohibited.test(file)||lstatSync(file).isSymbolicLink()){console.error('阻止公开的文件：'+file);failed=true;continue;}
 if(file==='scripts/check-publish.mjs'||file==='pnpm-lock.yaml')continue;
 const text=readFileSync(file,'utf8');if(patterns.some(p=>p.test(text))){console.error('需检查的敏感内容：'+file+'（不显示内容）');failed=true;}
}
if(failed)process.exitCode=1;else console.log(`发布检查通过：${files.length} 个候选文件；未纳入私密配置、数据库、课程原件或截图。`);
