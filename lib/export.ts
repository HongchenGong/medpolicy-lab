import archiver from 'archiver';
import { PassThrough,Readable } from 'node:stream';
import { objectStream } from './storage';
import ExcelJS from 'exceljs';
import { all, one, type Row } from './db';
import { COURSE_RULE } from './catalog';
export const PRESENTATION_BRIEF = `# MedPolicy Lab｜最终汇报制作说明

温州医科大学《卫生经济学》第7组，共12人。研究主题：药品与医用耗材监管：从审评审批到集中带量采购。
请根据11份已审核研究材料和老师的课程要求，制作2026年11月3日下午的15分钟汇报。
按“教材内容 → 现实议题 → 必答思考”组织内容。

## 两项必答问题
1. 集中带量采购使药械价格大幅下降后，如何保障质量与供应稳定？
2. 监管如何平衡患者可及性与企业创新激励？

## 在ChatGPT与Canva可画中完成
1. 内容整合与逻辑重组，保留来源和统计口径。
2. 12—15页左右的PPT，设计适合15分钟的节奏。
3. 案例及数据图表可视化，不创造材料中不存在的数字。
4. 页面美化，保持专业、清晰、学术化。
5. 课堂互动设计。
6. 完整逐页中文讲稿与每页时间建议。
7. PowerPoint演讲者备注。
8. 最终PPTX导出。

组长负责整合、讲稿和课堂汇报。R11为独立综合分析，不替其他成员重做研究。
区分教材理论、核验后的政策事实和研究推断；如发现矛盾或缺证据，标明待确认，不自行补造。
${COURSE_RULE}

本网站仅管理材料与审核，不调用ChatGPT或Canva API，不计算正式课程成绩。
`;
export function csv(rows: unknown[][]) { return '\uFEFF' + rows.map(row => row.map(v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s))
    s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }).join(',')).join('\r\n'); }
const slug = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
export async function makeZip(final: boolean) {
    const entries:Array<{name:string;bytes?:Buffer;file?:Row}>=[];
    const zip={addFile:(name:string,bytes:Buffer)=>entries.push({name,bytes})};
    const root=final?'MedPolicyLab_Final/':'MedPolicyLab_Working/';
    const manifest: unknown[][] = [['成员姓名', '研究模块', '最终文件名称', '审核状态', '最终版本', '主要研究内容摘要', '来源索引', '提交人学号', '提交时间', 'SHA256']];
    for (const m of (await all('SELECT * FROM modules ORDER BY id'))) {
        const subs = final ? [(await one("SELECT s.*,u.name FROM submissions s JOIN users u ON u.id=s.submitted_by WHERE s.module_id=? ORDER BY s.version DESC LIMIT 1", m.id))!] : (await all('SELECT s.*,u.name FROM submissions s JOIN users u ON u.id=s.submitted_by WHERE s.module_id=? ORDER BY s.version', m.id));
        for (const s of subs) {
            const dir = root + `${m.id}_${slug(s.name)}/` + (final ? '' : `V${s.version}/`);
            const files = (await all('SELECT * FROM files WHERE submission_id=?', s.id));
            const sources = JSON.parse(s.sources) as {
                title: string;
                url: string;
            }[];
            zip.addFile(dir + 'Sources.md', Buffer.from(sources.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n')));
            zip.addFile(dir + 'Research_Summary.md', Buffer.from(`# ${m.id} ${m.title}\n\n提交人：${s.name}（${s.submitted_by}）\n版本：V${s.version}\n\n${s.summary}\n\n${s.content || '研究正文见本目录原始附件。'}`));
            for (const f of files) {
                entries.push({name:dir+`${f.id.slice(0,8)}_${slug(f.original_name)}`,file:f});
                manifest.push([s.name, m.id, f.original_name, s.status, `V${s.version}`, s.summary, sources.map(r => r.url).join(' | '), s.submitted_by, s.created_at, f.sha256]);
            }
            if (!files.length)
                manifest.push([s.name, m.id, 'Research_Summary.md', s.status, `V${s.version}`, s.summary, sources.map(r => r.url).join(' | '), s.submitted_by, s.created_at, '']);
        }
    }
    for (const f of (await all('SELECT f.* FROM files f JOIN resources r ON r.id=f.resource_id ORDER BY r.created_at')))
        entries.push({name:root+'References/'+f.id.slice(0,8)+'_'+slug(f.original_name),file:f});
    zip.addFile(root + 'Presentation_Brief.md', Buffer.from(PRESENTATION_BRIEF));
    zip.addFile(root + 'Submission_Manifest.csv', Buffer.from(csv(manifest)));
    const output=new PassThrough({highWaterMark:64*1024}),archive=archiver('zip',{zlib:{level:3}});
    archive.on('error',e=>output.destroy(e));archive.on('warning',e=>output.destroy(e));
    output.on('close',()=>archive.abort());archive.pipe(output);
    for(const entry of entries)archive.append(entry.file?objectStream(entry.file.storage_name,entry.file.sha256):entry.bytes!,{name:entry.name});
    void archive.finalize().catch(e=>output.destroy(e));
    return Readable.toWeb(output) as ReadableStream<Uint8Array>;
}
export async function peerWorkbook() {
    const book = new ExcelJS.Workbook();
    book.creator = 'MedPolicy Lab';
    const sheet = book.addWorksheet('互评明细');
    sheet.columns = [{ header: '评价人', key: 'author', width: 16 }, { header: '被评价人', key: 'target', width: 16 }, { header: '评分（1—5）', key: 'score', width: 16 }, { header: '文字意见', key: 'comment', width: 70 }, { header: '时间（UTC）', key: 'created_at', width: 28 }];
    const rows = (await all('SELECT a.name author,t.name target,p.* FROM peer_reviews p JOIN users a ON a.id=p.author_id JOIN users t ON t.id=p.target_id ORDER BY p.target_id,p.created_at'));
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    const summary = book.addWorksheet('贡献与互评汇总');
    summary.addRow(['姓名', '角色', '互评数量', '互评均分（内部）', '提交次数', '按时提交次数', '已通过或冻结版本', '提交工时（各版本本次投入之和）', '额外协作工时']);
    for (const u of (await all('SELECT id,name,role FROM users ORDER BY role,id'))) {
        const p = (await one('SELECT COUNT(*) n,AVG(score) avg FROM peer_reviews WHERE target_id=?', u.id))!;
        const s = (await one("SELECT COUNT(*) n,COALESCE(SUM(on_time),0) ontime,SUM(CASE WHEN status IN ('APPROVED','FROZEN') THEN 1 ELSE 0 END) approved,COALESCE(SUM(actual_hours),0) hours FROM submissions WHERE submitted_by=?", u.id))!;
        summary.addRow([u.name, u.role, p.n, p.avg ?? '', s.n, s.ontime, s.approved ?? 0, s.hours, (await one('SELECT COALESCE(SUM(hours),0) h FROM contributions WHERE user_id=?', u.id))?.h]);
    }
    summary.addRow([]);
    summary.addRow([COURSE_RULE]);
    summary.columns.forEach(c => { c.width = 25; });
    summary.getRow(1).font = { bold: true };
    return Buffer.from(await book.xlsx.writeBuffer());
}
