import { randomUUID, createHash } from 'node:crypto';
import { putObject,getObject,removeObject } from './storage';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { uploadsDir, run, now, one, assignee, type Row } from './db';
import { assert } from './auth';
export const MAX_FILE = 20 * 1024 * 1024, MAX_BODY = 65 * 1024 * 1024;
const types: Record<string, string> = { '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/plain' };
export type PreparedFile = {
    name: string;
    mime: string;
    bytes: Buffer;
    hash: string;
    storage: string;
    id: string;
};
export async function boundedBody(req: Request, limit = MAX_BODY) {
    const len = Number(req.headers.get('content-length') || 0);
    assert(len <= limit, 413, '上传总量过大');
    const reader = req.body?.getReader();
    if (!reader)
        return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        size += value.length;
        if (size > limit) {
            await reader.cancel();
            assert(false, 413, '上传总量过大');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}
export async function form(req: Request) { const bytes = await boundedBody(req); return new Response(new Uint8Array(bytes), { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData(); }
export function inspectFile(name: string, bytes: Buffer): PreparedFile {
    const safe = path.basename(name.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').normalize('NFC').slice(0, 150);
    const ext = path.extname(safe).toLowerCase();
    assert(types[ext], 400, '文件类型不支持，请上传DOCX、XLSX、PPTX、PDF、PNG、JPG、TXT、CSV或MD');
    assert(bytes.length > 0 && bytes.length <= MAX_FILE, 400, '每个文件需大于0且不超过20MB');
    if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
        assert(bytes.subarray(0, 2).toString() === 'PK', 400, 'Office文件格式与扩展名不符');
        let entries;
        try {
            entries = new AdmZip(bytes).getEntries();
        }
        catch {
            assert(false, 400, 'Office文件损坏');
        }
        assert(entries.length <= 5000 && entries.reduce((n, e) => n + e.header.size, 0) <= 150 * 1024 * 1024, 400, 'Office解压体积超过安全限制');
        assert(entries.some(e => e.entryName === '[Content_Types].xml'), 400, '不是有效的Office文档');
        const main = { '.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml' }[ext]!;
        assert(entries.some(e => e.entryName === main), 400, 'Office类型与扩展名不符');
        assert(!entries.some(e => /vbaproject|activex|\.\.\//i.test(e.entryName)), 400, '不接受宏、ActiveX或不安全路径');
    }
    else if (ext === '.pdf')
        assert(bytes.subarray(0, 5).toString() === '%PDF-', 400, 'PDF格式与扩展名不符');
    else if (ext === '.png')
        assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 400, 'PNG格式无效');
    else if (['.jpg', '.jpeg'].includes(ext))
        assert(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255, 400, 'JPG格式无效');
    else
        assert(!bytes.includes(0), 400, '文本文件包含无效二进制内容');
    return { name: safe, mime: types[ext], bytes, hash: createHash('sha256').update(bytes).digest('hex'), storage: randomUUID() + ext, id: randomUUID() };
}
export async function prepareFiles(f: FormData, key = 'files') {
    const values = f.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);
    assert(values.length <= 5, 400, '每次最多上传5个文件');
    return Promise.all(values.map(async (v) => inspectFile(v.name, Buffer.from(await v.arrayBuffer()))));
}
export async function saveFiles(files: PreparedFile[], owner: {
    submission?: string;
    resource?: string;
    review?: string;
}, user: string) {
    for (const f of files) {
        await putObject(f.storage,f.bytes,f.mime);
        (await run('INSERT INTO files(id,submission_id,resource_id,review_id,original_name,storage_name,mime,size,sha256,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', f.id, owner.submission || null, owner.resource || null, owner.review || null, f.name, f.storage, f.mime, f.bytes.length, f.hash, user, now()));
    }
}
export async function cleanup(files:PreparedFile[]){for(const f of files){try{if(!await one('SELECT id FROM files WHERE storage_name=?',f.storage))await removeObject(f.storage);}catch{console.error('[storage] unconfirmed upload retained for recovery');}}}
export async function readStored(file:Row){return getObject(file.storage_name,file.sha256);}
export async function canReadSubmission(user: Row, s: Row) { return user.role === 'ADMIN' || s.submitted_by === user.id || (await assignee(s.module_id)) === user.id; }
export async function canReadFile(user: Row, file: Row) {
    if (user.role === 'ADMIN')
        return true;
    if (file.resource_id)
        return (await one('SELECT visible FROM resources WHERE id=?', file.resource_id))?.visible === 1;
    const s = file.submission_id ? (await one('SELECT * FROM submissions WHERE id=?', file.submission_id)) : (await one('SELECT s.* FROM submissions s JOIN reviews r ON s.id=r.submission_id WHERE r.id=?', file.review_id));
    return !!s && (await canReadSubmission(user, s));
}
