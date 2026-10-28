import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, one, run, tx, now, audit, assignee, setting, setSetting, type Row } from './db';
import { assert, HttpError, requireUser, requireAdmin, currentUser, safeUser, checkOrigin, hashPassword, verifyPassword, newSession, cookie, digest, tokenFrom } from './auth';
import { boundedBody, form, prepareFiles, saveFiles, cleanup, canReadSubmission, canReadFile, readStored } from './files';
import { makeZip, peerWorkbook, csv, PRESENTATION_BRIEF } from './export';
import { RUBRIC } from './catalog';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const send = (bytes: Buffer | string | ReadableStream<Uint8Array>, name: string, mime: string) => new Response(typeof bytes==='string'||bytes instanceof ReadableStream?bytes:new Uint8Array(bytes), { headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
async function body(req: Request) { try {
    return JSON.parse((await boundedBody(req, 256 * 1024)).toString());
}
catch (e) {
    if (e instanceof HttpError)
        throw e;
    throw new HttpError(400, '请求内容不是有效JSON');
} }
const textField = (f: FormData, k: string) => String(f.get(k) || '');
const date = z.string().datetime({ offset: true }).transform(s => new Date(s).toISOString());
async function moduleFor(u: Row, id: string) { const m = (await one('SELECT * FROM modules WHERE id=?', id)); assert(m, 404, '模块不存在'); assert(u.role === 'ADMIN' || (await assignee(id)) === u.id, 403, '只能编辑自己当前负责的模块'); return m; }
async function submissionFor(u: Row, id: string) { const s = (await one('SELECT * FROM submissions WHERE id=?', id)); assert(s, 404, '提交版本不存在'); assert((await canReadSubmission(u, s)), 403, '无权查看此提交'); return s; }
async function latest(s: Row) { assert((await one('SELECT id FROM submissions WHERE module_id=? ORDER BY version DESC LIMIT 1', s.module_id))?.id === s.id, 409, '此版本已不是最新版本，请处理最新提交'); }
async function setStatus(m: string, status: string, u: Row, details: unknown = {}) { const before = (await one('SELECT status FROM modules WHERE id=?', m))?.status; (await run('UPDATE modules SET status=?,progress=?,updated_at=? WHERE id=?', status, ['APPROVED', 'FROZEN'].includes(status) ? 100 : status === 'REVISION' ? 70 : 80, now(), m)); (await audit(u.id, 'module.status', m, { before, after: status, ...details as object })); }
async function state(u:Row){
 const admin=u.role==='ADMIN';
 const [moduleRows,submissionRows,reviewRows,resourceRows,fileRows,links,subtasks,userRows,settingRows,milestones,contributionRows,peerReviews,logs,assignments]=await Promise.all([
  all('SELECT m.*,a.user_id owner_id,u.name owner_name FROM modules m LEFT JOIN assignments a ON a.module_id=m.id AND a.end_at IS NULL LEFT JOIN users u ON u.id=a.user_id ORDER BY m.id'),
  all('SELECT s.*,u.name submitter_name FROM submissions s JOIN users u ON u.id=s.submitted_by ORDER BY s.created_at DESC,s.version DESC'),
  all('SELECT * FROM reviews ORDER BY created_at'),all('SELECT * FROM resources ORDER BY created_at DESC'),
  all('SELECT id,submission_id,resource_id,review_id,original_name,mime,size,sha256 FROM files'),all('SELECT * FROM resource_modules'),all('SELECT * FROM subtasks'),
  all('SELECT id,name,role,must_change,disabled FROM users ORDER BY role,id'),all('SELECT * FROM settings'),all('SELECT * FROM milestones ORDER BY at'),
  all('SELECT c.*,u.name FROM contributions c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC'),
  admin?all('SELECT * FROM peer_reviews ORDER BY created_at DESC'):all('SELECT * FROM peer_reviews WHERE author_id=?',u.id),
  admin?all('SELECT a.*,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100'):Promise.resolve([]),
  admin?all('SELECT * FROM assignments ORDER BY id DESC'):Promise.resolve([])
 ]);
 const enabled=(key:string)=>settingRows.find(s=>s.key===key)?.value==='true';
 const files=(key:string,id:string)=>fileRows.filter(f=>f[key]===id).map(f=>({id:f.id,original_name:f.original_name,mime:f.mime,size:f.size,sha256:f.sha256}));
 const modules=moduleRows.filter(m=>admin||enabled('public_progress')||m.owner_id===u.id).map(m=>({...m,questions:JSON.parse(m.questions),deliverables:JSON.parse(m.deliverables),subtasks:subtasks.filter(s=>s.module_id===m.id)}));
 const submissions=submissionRows.filter(s=>admin||s.submitted_by===u.id||moduleRows.some(m=>m.id===s.module_id&&m.owner_id===u.id)).map(s=>({...s,sources:JSON.parse(s.sources),files:files('submission_id',s.id),reviews:reviewRows.filter(r=>r.submission_id===s.id).map(r=>({...r,scores:JSON.parse(r.scores),files:files('review_id',r.id)}))}));
 const resources=resourceRows.filter(r=>admin||r.visible===1).map(r=>({...r,modules:links.filter(l=>l.resource_id===r.id).map(l=>l.module_id),files:files('resource_id',r.id)}));
 const users=userRows.map(p=>{
  const own=submissionRows.filter(s=>s.submitted_by===p.id),sum=(key:string)=>own.reduce((n,s)=>n+Number(s[key]),0);
  const stats=admin||p.id===u.id||enabled('peer_summaries')?{submissions:own.length,on_time:sum('on_time'),requirements_met:sum('requirements_met'),feedback_addressed:sum('feedback_addressed'),hours:sum('actual_hours'),approved:own.filter(s=>['APPROVED','FROZEN'].includes(s.status)).length}:null;
  return {id:p.id,name:p.name,role:p.role,...(admin?{must_change:p.must_change,disabled:p.disabled}:{}),stats};
 });
 return {user:safeUser(u),modules,submissions,resources,users,milestones,settings:{force_password_change:enabled('force_password_change'),public_progress:enabled('public_progress'),peer_open:enabled('peer_open'),peer_summaries:enabled('peer_summaries')},contributions:contributionRows.filter(c=>admin||c.user_id===u.id||(c.visible===1&&enabled('peer_summaries'))),peerReviews,audit:logs,assignments,serverTime:now()};
}
export async function handle(req: Request, parts: string[]): Promise<Response> {
    try {
        const route = parts.join('/'), method = req.method;
        if(route==='health'&&method==='GET'){await one('SELECT 1 ok');return json({ok:true});}
        if (method !== 'GET')
            checkOrigin(req);
        if (route === 'login' && method === 'POST') {
            assert((await one('SELECT id FROM users LIMIT 1')), 503, '项目尚未初始化，请在服务器运行初始化命令');
            const p = z.object({ studentId: z.string().regex(/^\d{10}$/), password: z.string().min(1).max(200) }).parse(await body(req));
            const ip = process.env.TRUST_PROXY === 'true' ? (req.headers.get('x-real-ip') || 'unknown') : 'local';
            const attempt=await tx(async()=>{
             await run('DELETE FROM login_attempts WHERE at<?',Date.now()-15*60*1000);
             const failed=(await one('SELECT COUNT(*) n FROM login_attempts WHERE account=? AND failed=1',p.studentId))!.n;
             const ipTotal=(await one('SELECT COUNT(*) n FROM login_attempts WHERE ip=?',ip))!.n;
             assert(failed<5&&ipTotal<120,429,'连续失败次数或登录频率过高，请15分钟后再试');
             return (await run('INSERT INTO login_attempts(account,ip,at) VALUES(?,?,?)',p.studentId,ip,Date.now())).lastInsertRowid;
            });
            const user = (await one('SELECT * FROM users WHERE id=?', p.studentId));
            const valid = await verifyPassword(p.password, user?.password_hash || `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`);
            assert(valid && user && !user.disabled, 401, '学号或密码错误，或账号已停用');
            assert((await one('SELECT password_hash FROM users WHERE id=? AND disabled=0', user.id))?.password_hash === user.password_hash, 401, '账号状态已变化，请重新登录');
            (await run('UPDATE login_attempts SET failed=0 WHERE id=?', attempt));
            (await run('DELETE FROM login_attempts WHERE account=? AND failed=1', user.id));
            const token = (await newSession(user.id));
            (await audit(user.id, 'auth.login', user.id));
            return json({ user: safeUser(user), forcePasswordChange: (await setting('force_password_change')) === 'true' }, 200, { 'Set-Cookie': cookie(token) });
        }
        if (route === 'me' && method === 'GET') {
            const u = (await requireUser(req, true));
            return json({ user: safeUser(u), forcePasswordChange: (await setting('force_password_change')) === 'true' });
        }
        if (route === 'logout' && method === 'POST') {
            (await run('DELETE FROM sessions WHERE token_hash=?', digest(tokenFrom(req))));
            return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
        }
        if (route === 'password' && method === 'POST') {
            const u = (await requireUser(req, true)), p = z.object({ current: z.string().max(200), password: z.string().min(10).max(128) }).parse(await body(req));
            assert(p.password !== p.current, 400, '新密码不能与当前密码相同');
            // Limit password verification attempts per session without disclosing another account.
            const key = 'password:' + u.id;
            (await run('DELETE FROM login_attempts WHERE at<?', Date.now() - 15 * 60000));
            assert((await one('SELECT COUNT(*) n FROM login_attempts WHERE account=?', key))!.n < 5, 429, '尝试过多，请15分钟后重试');
            (await run('INSERT INTO login_attempts(account,ip,at) VALUES(?,?,?)', key, 'password', Date.now()));
            const old = (await one('SELECT password_hash FROM users WHERE id=?', u.id))!.password_hash;
            assert(await verifyPassword(p.current, old), 400, '当前密码不正确');
            const hash = await hashPassword(p.password);
            (await tx(async () => { assert((await run('UPDATE users SET password_hash=?,must_change=0 WHERE id=? AND password_hash=?', hash, u.id, old)).changes === 1, 409, '密码已变更，请重新登录'); (await run('DELETE FROM sessions WHERE user_id=?', u.id)); (await run('DELETE FROM login_attempts WHERE account=?', key)); (await audit(u.id, 'auth.password', u.id)); }));
            return json({ ok: true }, 200, { 'Set-Cookie': cookie((await newSession(u.id))) });
        }
        const u = (await requireUser(req));
        if (route === 'state' && method === 'GET')
            return json((await state(u)));
        if (parts[0] === 'files' && parts[1] && method === 'GET') {
            const file = (await one('SELECT * FROM files WHERE id=?', parts[1]));
            assert(file, 404, '文件不存在');
            assert((await canReadFile(u, file)), 403, '无权下载此文件');
            return send((await readStored(file)), file.original_name, file.mime);
        }
        if (parts[0] === 'modules' && parts[1] && method === 'PATCH') {
            const m = (await moduleFor(u, parts[1]));
            const p = z.object({ title: z.string().min(2).max(160).optional(), purpose: z.string().min(2).max(3000).optional(), questions: z.array(z.string().min(1).max(2000)).min(1).max(20).optional(), deliverables: z.array(z.string().min(1).max(2000)).min(1).max(20).optional(), hints: z.string().max(5000).optional(), start_at: date.optional(), due_at: date.optional(), priority: z.enum(['普通', '重要', '紧急']).optional(), estimated_hours: z.number().min(0).max(200).optional(), actual_hours: z.number().min(0).max(1000).optional(), progress: z.number().int().min(0).max(90).optional(), public_summary: z.string().max(3000).optional() }).strict().parse(await body(req));
            assert(Object.keys(p).length > 0, 400, '未提供修改内容');
            if (u.role !== 'ADMIN')
                assert(Object.keys(p).every(k => ['progress', 'actual_hours'].includes(k)), 403, '成员只能更新进度与实际工作量');
            if ('progress' in p || 'actual_hours' in p)
                assert(!['APPROVED', 'FROZEN'].includes(m.status), 409, '已通过内容需组长重新开放后调整');
            assert(new Date(p.start_at || m.start_at) <= new Date(p.due_at || m.due_at), 400, '截止时间不能早于开始时间');
            (await tx(async () => { for (const [key, value] of Object.entries(p))
                (await run(`UPDATE modules SET ${key}=?,updated_at=? WHERE id=?`, Array.isArray(value) ? JSON.stringify(value) : value, now(), m.id)); if (m.status === 'TODO' && (p.progress || 0) > 0) {
                (await run("UPDATE modules SET status='IN_PROGRESS' WHERE id=?", m.id));
                (await audit(u.id, 'module.status', m.id, { before: 'TODO', after: 'IN_PROGRESS' }));
            } (await audit(u.id, 'module.update', m.id, { before: m, changes: p })); }));
            return json({ ok: true });
        }
        if (route === 'assignments/swap' && method === 'POST') {
            requireAdmin(u);
            const p = z.object({ moduleId: z.string(), memberId: z.string() }).parse(await body(req));
            (await moduleFor(u, p.moduleId));
            const target = (await one("SELECT id FROM users WHERE id=? AND role='MEMBER' AND disabled=0", p.memberId));
            assert(target, 400, '只能分配给启用的普通成员');
            const old = (await assignee(p.moduleId));
            assert(old !== p.memberId, 400, '该成员已负责此模块');
            (await tx(async () => { const other = (await one('SELECT module_id FROM assignments WHERE user_id=? AND end_at IS NULL', p.memberId))?.module_id; const time = now(); (await run('UPDATE assignments SET end_at=? WHERE end_at IS NULL AND (module_id=? OR user_id=?)', time, p.moduleId, p.memberId)); (await run('INSERT INTO assignments(module_id,user_id,assigned_by,start_at) VALUES(?,?,?,?)', p.moduleId, p.memberId, u.id, time)); if (other && old)
                (await run('INSERT INTO assignments(module_id,user_id,assigned_by,start_at) VALUES(?,?,?,?)', other, old, u.id, time)); (await audit(u.id, 'assignment.swap', p.moduleId, { from: old, to: p.memberId, otherModule: other })); }));
            return json({ ok: true });
        }
        if (route === 'submissions' && method === 'POST') {
            const f = await form(req);
            const p = z.object({ moduleId: z.string(), content: z.string().max(50000), summary: z.string().min(10).max(3000), sources: z.array(z.object({ title: z.string().min(2).max(300), url: z.string().min(3).max(2000).refine(v => !/^\s*(javascript|data|file):/i.test(v)) })).min(2).max(3), change_note: z.string().min(2).max(3000), actual_hours: z.number().min(0).max(200), requirements_met: z.boolean(), feedback_addressed: z.boolean() }).parse({ moduleId: textField(f, 'moduleId'), content: textField(f, 'content'), summary: textField(f, 'summary'), sources: JSON.parse(textField(f, 'sources') || '[]'), change_note: textField(f, 'change_note'), actual_hours: Number(textField(f, 'actual_hours')), requirements_met: textField(f, 'requirements_met') === 'true', feedback_addressed: textField(f, 'feedback_addressed') === 'true' });
            (await moduleFor(u, p.moduleId));
            assert(u.role === 'MEMBER', 403, '组长不承担研究模块，请由当前负责人提交');
            const files = await prepareFiles(f);
            assert(p.content.trim().length >= 600 || files.some(f => /\.(docx|pdf)$/i.test(f.name)), 400, '请填写不少于600字的核心正文（建议约1000字），或上传一份Word/PDF研究文档；Excel作为补充附件');
            const id = randomUUID();
            try {
                (await tx(async () => { const m = (await moduleFor(u, p.moduleId)); assert(!['APPROVED', 'FROZEN'].includes(m.status), 409, '已通过或冻结的内容需组长重新开放'); const version = Number((await one('SELECT COALESCE(MAX(version),0) v FROM submissions WHERE module_id=?', m.id))!.v) + 1; const time = now(); const status = version === 1 ? 'SUBMITTED' : 'IN_REVIEW'; (await run('INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, m.id, version, u.id, time, p.content, p.summary, JSON.stringify(p.sources), p.change_note, status, Number(time <= m.due_at), Number(p.requirements_met), Number(p.feedback_addressed), p.actual_hours)); (await saveFiles(files, { submission: id }, u.id)); (await run('UPDATE modules SET submitted_at=? WHERE id=?', time, m.id)); (await setStatus(m.id, status, u, { submission: id, version })); (await audit(u.id, 'submission.create', id, { module: m.id, version, files: files.map(f => ({ name: f.name, sha256: f.hash })), hours: p.actual_hours })); }));
            }
            catch (e) {
                (await cleanup(files));
                throw e;
            }
            return json({ ok: true, id }, 201);
        }
        if (route === 'reviews' && method === 'POST') {
            requireAdmin(u);
            const f = await form(req);
            const scores = z.array(z.number().min(0)).length(6).parse(JSON.parse(textField(f, 'scores') || '[]'));
            scores.forEach((v, i) => assert(v <= RUBRIC[i][1], 400, `${RUBRIC[i][0]}超出满分`));
            const p = z.object({ submissionId: z.string(), issues: z.string().max(10000), feedback: z.string().min(2).max(20000), chatgpt_text: z.string().max(50000), conclusion: z.enum(['APPROVED', 'REVISION']) }).parse({ submissionId: textField(f, 'submissionId'), issues: textField(f, 'issues'), feedback: textField(f, 'feedback'), chatgpt_text: textField(f, 'chatgpt_text'), conclusion: textField(f, 'conclusion') });
            const files = await prepareFiles(f);
            const id = randomUUID();
            try {
                (await tx(async () => { const s = (await submissionFor(u, p.submissionId)); (await latest(s)); assert(['SUBMITTED', 'IN_REVIEW', 'REVISION'].includes(s.status), 409, '此版本不可再评分；请重新开放或等待新版本'); assert((await one('SELECT status FROM modules WHERE id=?', s.module_id))?.status !== 'FROZEN', 409, '模块已冻结'); const total = scores.reduce((a, b) => a + b, 0); (await run('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)', id, s.id, u.id, now(), JSON.stringify(scores), total, p.issues, p.feedback, p.chatgpt_text, p.conclusion)); (await saveFiles(files, { review: id }, u.id)); (await run('UPDATE submissions SET status=? WHERE id=?', p.conclusion, s.id)); (await setStatus(s.module_id, p.conclusion, u, { submission: s.id })); (await audit(u.id, 'review.create', s.id, { total, conclusion: p.conclusion, version: s.version, submitted_by: s.submitted_by })); }));
            }
            catch (e) {
                (await cleanup(files));
                throw e;
            }
            return json({ ok: true, id });
        }
        if (parts[0] === 'submissions' && parts[2] && method === 'POST') {
            requireAdmin(u);
            const action = parts[2];
            assert(['start', 'freeze', 'reopen'].includes(action), 404, '操作不存在');
            (await tx(async () => {
                const s = (await submissionFor(u, parts[1]));
                (await latest(s));
                const m = (await one('SELECT * FROM modules WHERE id=?', s.module_id))!;
                if (action === 'start') {
                    assert(['SUBMITTED', 'IN_REVIEW'].includes(s.status), 409, '当前状态不能开始审核');
                    (await run("UPDATE submissions SET status='IN_REVIEW' WHERE id=?", s.id));
                    (await setStatus(s.module_id, 'IN_REVIEW', u, { submission: s.id }));
                }
                if (action === 'freeze') {
                    assert(s.status === 'APPROVED' && m.status === 'APPROVED', 409, '必须先审核通过才能冻结');
                    (await run("UPDATE submissions SET status='FROZEN' WHERE id=?", s.id));
                    (await setStatus(s.module_id, 'FROZEN', u, { submission: s.id }));
                }
                if (action === 'reopen') {
                    assert(['APPROVED', 'FROZEN'].includes(m.status), 409, '只有已通过或冻结模块需要重新开放');
                    (await setStatus(s.module_id, 'REVISION', u, { submission: s.id, preservedVersion: true }));
                }
                (await audit(u.id, 'submission.' + action, s.id, { version: s.version }));
            }));
            return json({ ok: true });
        }
        if (route === 'resources' && method === 'POST') {
            requireAdmin(u);
            const f = await form(req);
            const p = z.object({ title: z.string().min(2).max(200), category: z.enum(['教师PPT', '课程作业要求', '教材资料', '官方政策文件', '其他参考资料']), description: z.string().max(5000), modules: z.array(z.string()).max(11), visible: z.boolean() }).parse({ title: textField(f, 'title'), category: textField(f, 'category'), description: textField(f, 'description'), modules: JSON.parse(textField(f, 'modules') || '[]'), visible: textField(f, 'visible') !== 'false' });
            for (const m of p.modules)
                (await moduleFor(u, m));
            const files = await prepareFiles(f);
            assert(files.length, 400, '请至少选择一个课程资料文件');
            const id = randomUUID();
            try {
                (await tx(async () => { (await run('INSERT INTO resources VALUES(?,?,?,?,?,?,?)', id, p.title, p.category, p.description, u.id, now(), Number(p.visible))); for (const m of new Set(p.modules))
                    (await run('INSERT INTO resource_modules VALUES(?,?)', id, m)); (await saveFiles(files, { resource: id }, u.id)); (await audit(u.id, 'resource.create', id, { title: p.title, modules: p.modules })); }));
            }
            catch (e) {
                (await cleanup(files));
                throw e;
            }
            return json({ ok: true });
        }
        if (parts[0] === 'resources' && parts[1] && method === 'PATCH') {
            requireAdmin(u);
            assert((await one('SELECT id FROM resources WHERE id=?', parts[1])), 404, '资料不存在');
            const p = z.object({ visible: z.boolean(), modules: z.array(z.string()).max(11) }).parse(await body(req));
            for (const m of p.modules)
                (await moduleFor(u, m));
            (await tx(async () => { (await run('UPDATE resources SET visible=? WHERE id=?', Number(p.visible), parts[1])); (await run('DELETE FROM resource_modules WHERE resource_id=?', parts[1])); for (const m of new Set(p.modules))
                (await run('INSERT INTO resource_modules VALUES(?,?)', parts[1], m)); (await audit(u.id, 'resource.update', parts[1], p)); }));
            return json({ ok: true });
        }
        if (parts[0] === 'members' && parts[1] && method === 'PATCH') {
            requireAdmin(u);
            const target = (await one('SELECT * FROM users WHERE id=?', parts[1]));
            assert(target && target.role === 'MEMBER', 400, '此入口仅管理普通成员，组长请在账号页修改密码');
            const p = z.object({ password: z.string().min(10).max(128).optional(), disabled: z.boolean().optional() }).strict().parse(await body(req));
            const hash = p.password ? await hashPassword(p.password) : null;
            (await tx(async () => { if (hash) {
                (await run('UPDATE users SET password_hash=?,must_change=1 WHERE id=?', hash, target.id));
                (await run('DELETE FROM login_attempts WHERE account=?', target.id));
            } if (p.disabled !== undefined)
                (await run('UPDATE users SET disabled=? WHERE id=?', Number(p.disabled), target.id)); (await run('DELETE FROM sessions WHERE user_id=?', target.id)); (await audit(u.id, 'member.update', target.id, { passwordReset: !!hash, disabled: p.disabled })); }));
            return json({ ok: true });
        }
        if (route === 'settings' && method === 'PATCH') {
            requireAdmin(u);
            const p = z.object({ force_password_change: z.boolean().optional(), public_progress: z.boolean().optional(), peer_open: z.boolean().optional(), peer_summaries: z.boolean().optional() }).strict().parse(await body(req));
            (await tx(async () => { for (const [k, v] of Object.entries(p))
                (await setSetting(k, String(v))); (await audit(u.id, 'settings.update', 'project', p)); }));
            return json({ ok: true });
        }
        if (parts[0] === 'milestones' && parts[1] && method === 'PATCH') {
            requireAdmin(u);
            const p = z.object({ at: date, title: z.string().min(2).max(100), description: z.string().max(3000) }).parse(await body(req));
            assert((await one('SELECT id FROM milestones WHERE id=?', parts[1])), 404, '里程碑不存在');
            (await tx(async () => { (await run('UPDATE milestones SET at=?,title=?,description=? WHERE id=?', p.at, p.title, p.description, parts[1])); (await audit(u.id, 'milestone.update', parts[1], p)); }));
            return json({ ok: true });
        }
        if (route === 'subtasks' && method === 'POST') {
            requireAdmin(u);
            const p = z.object({ moduleId: z.string(), title: z.string().min(2).max(300) }).parse(await body(req));
            const m = (await moduleFor(u, p.moduleId));
            assert(m.status !== 'FROZEN', 409, '请先重新开放冻结模块');
            const id = randomUUID();
            (await tx(async () => { (await run('INSERT INTO subtasks VALUES(?,?,?,0,?)', id, p.moduleId, p.title, u.id)); (await audit(u.id, 'subtask.create', id, p)); }));
            return json({ ok: true });
        }
        if (parts[0] === 'subtasks' && parts[1] && ['PATCH', 'DELETE'].includes(method)) {
            const sub = (await one('SELECT * FROM subtasks WHERE id=?', parts[1]));
            assert(sub, 404, '子任务不存在');
            const m = (await moduleFor(u, sub.module_id));
            assert(m.status !== 'FROZEN', 409, '请先重新开放冻结模块');
            if (method === 'DELETE') {
                requireAdmin(u);
                (await tx(async () => { (await run('DELETE FROM subtasks WHERE id=?', sub.id)); (await audit(u.id, 'subtask.delete', sub.id, sub)); }));
            }
            else {
                const p = z.object({ done: z.boolean() }).parse(await body(req));
                (await tx(async () => { (await run('UPDATE subtasks SET done=? WHERE id=?', Number(p.done), sub.id)); (await audit(u.id, 'subtask.update', sub.id, p)); }));
            }
            return json({ ok: true });
        }
        if (route === 'contributions' && method === 'POST') {
            requireAdmin(u);
            const p = z.object({ userId: z.string(), note: z.string().min(2).max(5000), hours: z.number().min(0).max(500), visible: z.boolean() }).parse(await body(req));
            assert((await one('SELECT id FROM users WHERE id=?', p.userId)), 404, '成员不存在');
            (await tx(async () => { const id = randomUUID(); (await run('INSERT INTO contributions VALUES(?,?,?,?,?,?,?)', id, p.userId, u.id, now(), p.hours, p.note, Number(p.visible))); (await audit(u.id, 'contribution.create', id, p)); }));
            return json({ ok: true });
        }
        if (route === 'peer-reviews' && method === 'POST') {
            assert((await setting('peer_open')) === 'true', 403, '组内互评尚未开启或已关闭');
            const p = z.object({ targetId: z.string(), score: z.number().int().min(1).max(5), comment: z.string().min(2).max(3000) }).parse(await body(req));
            assert(p.targetId !== u.id, 400, '不能评价自己');
            assert((await one('SELECT id FROM users WHERE id=? AND disabled=0', p.targetId)), 404, '成员不存在');
            assert(!(await one('SELECT id FROM peer_reviews WHERE author_id=? AND target_id=?', u.id, p.targetId)), 409, '你已评价该成员，提交后不可重复修改');
            (await tx(async () => { (await run('INSERT INTO peer_reviews VALUES(?,?,?,?,?,?)', randomUUID(), u.id, p.targetId, p.score, p.comment, now())); (await audit(u.id, 'peer.submit', p.targetId)); }));
            return json({ ok: true });
        }
        if (route === 'export' && method === 'POST') {
            requireAdmin(u);
            const p = z.object({ kind: z.enum(['final', 'all']) }).parse(await body(req));
            if (p.kind === 'all') {
                (await audit(u.id, 'export.working', 'project'));
                return send((await makeZip(false)), 'MedPolicyLab_Working.zip', 'application/zip');
            }
            let zip!:ReadableStream<Uint8Array>;
            (await tx(async () => {
                const modules = (await all('SELECT * FROM modules ORDER BY id'));
                assert(modules.length === 11, 409, '必须包含完整的11个研究模块');
                for (const m of modules) {
                    const s = (await one('SELECT * FROM submissions WHERE module_id=? ORDER BY version DESC LIMIT 1', m.id));
                    assert(s && ['APPROVED', 'FROZEN'].includes(s.status) && ['APPROVED', 'FROZEN'].includes(m.status), 409, `${m.id}尚未完成最新版本审核`);
                    if (s.status === 'APPROVED') {
                        (await run("UPDATE submissions SET status='FROZEN' WHERE id=?", s.id));
                        (await setStatus(m.id, 'FROZEN', u, { submission: s.id, reason: 'final_export' }));
                    }
                }
                zip = (await makeZip(true));
                (await audit(u.id, 'export.final', 'project', { modules: 11 }));
            }));
            return send(zip, 'MedPolicyLab_Final.zip', 'application/zip');
        }
        if (parts[0] === 'exports' && method === 'GET') {
            requireAdmin(u);
            if (parts[1] === 'peers')
                return send(await peerWorkbook(), 'MedPolicyLab_Peer_Review.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            if (parts[1] === 'brief')
                return send(PRESENTATION_BRIEF, 'Presentation_Brief.md', 'text/markdown; charset=utf-8');
            if (parts[1] === 'logs') {
                const rows = (await all('SELECT * FROM audit_log ORDER BY id'));
                return send(csv([['时间（UTC）', '操作人学号', '动作', '对象', '详情'], ...rows.map(r => [r.created_at, r.actor_id, r.action, r.entity, r.details])]), 'MedPolicyLab_Audit.csv', 'text/csv; charset=utf-8');
            }
        }
        throw new HttpError(404, '接口不存在');
    }
    catch (e) {
        if (e instanceof HttpError)
            return json({ error: e.message }, e.status);
        if (e instanceof z.ZodError)
            return json({ error: '请检查填写内容：' + e.issues.map(i => `${i.path.join('.')} ${i.message}`).slice(0, 3).join('；') }, 400);
        if (e instanceof SyntaxError)
            return json({ error: '表单格式错误，请检查填写内容' }, 400);
        console.error('[API]', e instanceof Error ? e.message : 'Unexpected error');
        return json({ error: '服务器处理失败，请稍后重试；原有数据不会被覆盖' }, 500);
    }
}
