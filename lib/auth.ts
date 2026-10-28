import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { one, run, now, setting, type Row } from './db';
const scrypt = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
export class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export function assert(condition: unknown, status: number, message: string): asserts condition { if (!condition)
    throw new HttpError(status, message); }
export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt);
    return `scrypt$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
    const [, salt, key] = stored.split('$');
    if (!salt || !key)
        return false;
    const hash = await scrypt(password, salt);
    const expected = Buffer.from(key, 'hex');
    return expected.length === hash.length && timingSafeEqual(hash, expected);
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function tokenFrom(req: Request) { return req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('medpolicy_session='))?.slice(18) || ''; }
export async function currentUser(req: Request) {
    return (await one('SELECT u.id,u.name,u.role,u.must_change,u.disabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0', digest(tokenFrom(req)), now()));
}
export async function requireUser(req: Request, allowPassword = false) {
    const u = (await currentUser(req));
    assert(u, 401, '请先登录');
    assert(allowPassword || !u.must_change || (await setting('force_password_change')) !== 'true', 428, '请先修改初始密码');
    return u;
}
export function requireAdmin(u: Row) { assert(u.role === 'ADMIN', 403, '仅组长可以执行此操作'); }
export async function newSession(id: string) {
    const token = randomBytes(32).toString('base64url');
    (await run('DELETE FROM sessions WHERE expires_at<?', now()));
    (await run('INSERT INTO sessions VALUES(?,?,?)', digest(token), id, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()));
    return token;
}
export function cookie(token: string, maxAge = 43200) { return `medpolicy_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`; }
export function checkOrigin(req: Request) {
    // Next can normalize request.url to localhost; the HTTP Host retains the browser's address.
    // Behind a reverse proxy APP_ORIGIN pins the public HTTPS origin; forwarded headers are not trusted.
    const url = new URL(req.url);
    const expected = process.env.APP_ORIGIN || `${url.protocol}//${req.headers.get('host') || url.host}`;
    assert(req.headers.get('origin') === expected, 403, '请求来源校验失败，请从本站页面操作');
    assert(req.headers.get('sec-fetch-site') !== 'cross-site', 403, '不允许跨站请求');
}
export function safeUser(u: Row) { return { id: u.id, name: u.name, role: u.role, must_change: u.must_change, disabled: u.disabled }; }
