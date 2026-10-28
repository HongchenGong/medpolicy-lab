import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { one, run, tx, now, audit,closeDatabase } from '../lib/db';
import { inspectFile, saveFiles, cleanup } from '../lib/files';
async function main(){
const source = process.argv[2];
if (!source)
    throw new Error('用法：pnpm import:course /课程资料绝对路径');
const adminId = (await one("SELECT id FROM users WHERE role='ADMIN'"))?.id;
if (!adminId)
    throw new Error('请先初始化账号');
const map: Record<string, string[]> = {
    '3卫生服务需求.pdf': ['R09'], '保险及其特征.pdf': ['R01', 'R09'],
    '卫生服务生产、成本 组织及其行为特征.pdf': ['R03', 'R04', 'R08', 'R10'],
    '卫生技术评价 Health Technology Assessment.pdf': ['R02', 'R05', 'R06', 'R07', 'R09', 'R10', 'R11'],
    '公共卫生经济学（健康外部性）.pdf': ['R01', 'R11'], '健康需求.pdf': ['R09'],
    '卫生人力资源 （Health workforce).pdf': ['R08']
};
const hints: Record<string, string> = {
    R03: '课程PDF《卫生服务生产、成本 组织及其行为特征》第19—20页：规模经济讨论长期平均成本随产量增加而下降的区间。应用到以量换价时，请明确产能、成本结构与需求确定性的假设，不能把规模经济当作必然结果。',
    R08: '课程PDF《卫生服务生产、成本 组织及其行为特征》第11、13、19页涉及成本、边际成本与规模经济。可作为分析成本和产能的理论起点；保供措施须另寻真实政策证据。',
    R06: '课程PDF《卫生技术评价 Health Technology Assessment》第15页强调：最小成本法需要有充分证据支持健康结局等效，并考虑安全性等差异。请据此区分价格比较与质量证据，不能仅凭便宜就判断优劣。',
    R07: '课程PDF《卫生技术评价 Health Technology Assessment》第15页强调最小成本法的等效与安全性前提。将其用于耗材分析时，应核验临床适配和结局可比性。',
    R09: '课程PDF《3卫生服务需求》第31页区分总医疗费用P与共付率r，示例自付额NP=r×P，并讨论时间成本。研究集采时还需核实具体医保支付规则，不能把采购降幅直接等同于患者自付降幅。'
};
let count = 0;
for (const name of readdirSync(source).filter(n => /\.(pdf|pptx)$/i.test(n))) {
    const f = inspectFile(name, readFileSync(path.join(source, name)));
    if ((await one('SELECT id FROM files WHERE sha256=? AND resource_id IS NOT NULL', f.hash)))
        continue;
    const id = randomUUID();
    try {
        (await tx(async () => { (await run('INSERT INTO resources VALUES(?,?,?,?,?,?,1)', id, name.replace(/\.[^.]+$/, ''), '教师PPT', '用户提供的课程讲义原始文件。模块关联为研究参考建议，不代表课件中含有本次集采案例数据。', adminId, now())); for (const m of map[name] || [])
            (await run('INSERT INTO resource_modules VALUES(?,?)', id, m)); (await saveFiles([f], { resource: id }, adminId)); (await audit(adminId, 'resource.import', id, { name, sha256: f.hash })); }));
    }
    catch (e) {
        (await cleanup([f]));
        throw e;
    }
    count++;
}
(await tx(async () => { for (const [id, hint] of Object.entries(hints))
    (await run("UPDATE modules SET hints=? WHERE id=? AND hints=''", hint, id)); }));
console.log(`导入 ${count} 份原始资料（按文件哈希防重复），相关理论提示已关联。`);

}
main().finally(closeDatabase).catch(e=>{console.error(e.message);process.exitCode=1;});
