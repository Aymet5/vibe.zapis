import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, type UserRow } from './db';
import { env } from './env';

const CLIENT_COOKIE = 'vibe_session';
const ADMIN_COOKIE = 'vibe_admin';
const SESSION_DAYS = 90;
const ADMIN_SESSION_HOURS = 12;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      isAdmin?: boolean;
    }
  }
}

/** Минимальный разбор заголовка Cookie — отдельная зависимость ради этого не нужна. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(value).digest('hex');
}

function pack(id: string): string {
  return `${id}.${sign(id)}`;
}

/** Возвращает id сессии, только если подпись сходится. */
function unpack(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const id = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(id);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return id;
}

function setCookie(res: Response, name: string, value: string, maxAgeSeconds: number): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (env.isProduction) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(res: Response, name: string): void {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (env.isProduction) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function createSession(kind: 'client' | 'admin', userId: number | null, days: number): string {
  const id = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (id, kind, user_id, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`,
  ).run(id, kind, userId, `+${days} days`);
  return id;
}

export function loginClient(res: Response, userId: number): void {
  const id = createSession('client', userId, SESSION_DAYS);
  setCookie(res, CLIENT_COOKIE, pack(id), SESSION_DAYS * 24 * 60 * 60);
}

export function loginAdmin(res: Response): void {
  const id = createSession('admin', null, ADMIN_SESSION_HOURS / 24);
  setCookie(res, ADMIN_COOKIE, pack(id), ADMIN_SESSION_HOURS * 60 * 60);
}

function destroy(req: Request, res: Response, cookieName: string): void {
  const id = unpack(parseCookies(req.headers.cookie)[cookieName]);
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  clearCookie(res, cookieName);
}

export function logoutClient(req: Request, res: Response): void {
  destroy(req, res, CLIENT_COOKIE);
}

export function logoutAdmin(req: Request, res: Response): void {
  destroy(req, res, ADMIN_COOKIE);
}

function sessionUser(req: Request): UserRow | undefined {
  const id = unpack(parseCookies(req.headers.cookie)[CLIENT_COOKIE]);
  if (!id) return undefined;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.kind = 'client' AND s.expires_at > datetime('now')`,
    )
    .get(id) as UserRow | undefined;
  return row;
}

function hasAdminSession(req: Request): boolean {
  const id = unpack(parseCookies(req.headers.cookie)[ADMIN_COOKIE]);
  if (!id) return false;
  const row = db
    .prepare(`SELECT id FROM sessions WHERE id = ? AND kind = 'admin' AND expires_at > datetime('now')`)
    .get(id);
  return Boolean(row);
}

/** Подмешивает пользователя и признак админа в каждый запрос. */
export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  req.user = sessionUser(req);
  req.isAdmin = hasAdminSession(req);
  next();
}

export function requireClient(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Нужно войти через ВКонтакте' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAdmin) {
    res.status(401).json({ error: 'Нужен вход в панель администратора' });
    return;
  }
  next();
}

/** Сравнение пароля за постоянное время — чтобы подбор не ускорялся по таймингам. */
export function checkAdminPassword(candidate: string): boolean {
  if (!env.adminPassword) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(env.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}
