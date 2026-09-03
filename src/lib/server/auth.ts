import { argon2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import type { Cookies } from '@sveltejs/kit';

/**
 * Local auth: username + 4–6 digit PIN, argon2id-hashed, server-side session
 * cookie. Members get 30-day rolling sessions; admins 12-hour.
 * Addarr owns the user model — Radarr/Sonarr only ever see the shared API key.
 */

export const SESSION_COOKIE = 'addarr_session';

const MEMBER_TTL_S = 30 * 24 * 3600; // 30 days
const ADMIN_TTL_S = 12 * 3600; // 12 hours

// argon2id parameters (OWASP-recommended minimum): 19 MiB, 2 passes, 1 lane.
const ARGON2 = { tagLength: 32, parallelism: 1, passes: 2, memory: 19456 } as const;

export type SessionUser = {
	id: number;
	username: string;
	role: 'admin' | 'member';
};

export type UserRow = {
	id: number;
	username: string;
	pin_hash: string;
	role: 'admin' | 'member';
	disabled: number;
	created_at: string;
};

export function isValidPin(pin: unknown): pin is string {
	return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}

export function isValidUsername(name: unknown): name is string {
	return typeof name === 'string' && /^[a-zA-Z0-9._-]{1,32}$/.test(name);
}

export function hashPin(pin: string): string {
	const nonce = randomBytes(16);
	const tag = argon2Sync('argon2id', { message: pin, nonce, ...ARGON2 });
	return `${nonce.toString('base64')}:${tag.toString('base64')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
	const sep = stored.indexOf(':');
	if (sep === -1) return false;
	const nonce = Buffer.from(stored.slice(0, sep), 'base64');
	const tag = Buffer.from(stored.slice(sep + 1), 'base64');
	if (nonce.length === 0 || tag.length === 0) return false;
	const candidate = argon2Sync('argon2id', { message: pin, nonce, tagLength: tag.length, parallelism: ARGON2.parallelism, passes: ARGON2.passes, memory: ARGON2.memory });
	return tag.length === candidate.length && timingSafeEqual(tag, candidate);
}

export function hasAnyUser(): boolean {
	const row = db.prepare(`SELECT EXISTS(SELECT 1 FROM users) AS any`).get() as
		| { any: number }
		| undefined;
	return row?.any === 1;
}

export function getUserByUsername(username: string): UserRow | undefined {
	return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as UserRow | undefined;
}

export function createUser(input: {
	username: string;
	pin: string;
	role: 'admin' | 'member';
}): UserRow {
	db.prepare(`INSERT INTO users (username, pin_hash, role) VALUES (?, ?, ?)`).run(
		input.username,
		hashPin(input.pin),
		input.role
	);
	return getUserByUsername(input.username)!;
}

/**
 * Resolve a session cookie to a user. Rolling: once less than half the
 * role's lifetime remains, the expiry (and cookie) is refreshed.
 */
export function getSessionUser(sid: string, cookies: Cookies): SessionUser | null {
	const row = db
		.prepare(
			`SELECT s.expires_at, u.id, u.username, u.role
			 FROM sessions s JOIN users u ON u.id = s.user_id
			 WHERE s.id = ? AND u.disabled = 0`
		)
		.get(sid) as { expires_at: string; id: number; username: string; role: 'admin' | 'member' } | undefined;

	if (!row) return null;

	const now = Date.now();
	const expires = Date.parse(row.expires_at);
	if (!Number.isFinite(expires) || expires < now) {
		db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
		return null;
	}

	const ttl = row.role === 'admin' ? ADMIN_TTL_S : MEMBER_TTL_S;
	if (expires - now < (ttl / 2) * 1000) {
		const newExpires = new Date(now + ttl * 1000).toISOString();
		db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(newExpires, sid);
		setSessionCookie(cookies, sid, newExpires);
	}

	return { id: row.id, username: row.username, role: row.role };
}

export function createSession(
	cookies: Cookies,
	userId: number,
	role: 'admin' | 'member'
): string {
	const sid = randomBytes(32).toString('base64url');
	const ttl = role === 'admin' ? ADMIN_TTL_S : MEMBER_TTL_S;
	const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
	db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(
		sid,
		userId,
		expiresAt
	);
	setSessionCookie(cookies, sid, expiresAt);
	return sid;
}

export function destroySession(sid: string, cookies: Cookies): void {
	db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

function setSessionCookie(cookies: Cookies, sid: string, expiresAt: string): void {
	// LAN-only app over http — no `secure` flag; httpOnly + sameSite=lax still apply.
	cookies.set(SESSION_COOKIE, sid, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: false,
		expires: new Date(expiresAt)
	});
}

export function logActivity(entry: {
	userId: number | null;
	serviceId: number | null;
	action: string;
	arrItemId?: number | null;
	title?: string | null;
	payload?: unknown;
}): void {
	db.prepare(
		`INSERT INTO activity_log (user_id, service_id, action, arr_item_id, title, payload_json)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(
		entry.userId,
		entry.serviceId,
		entry.action,
		entry.arrItemId ?? null,
		entry.title ?? null,
		entry.payload === undefined ? null : JSON.stringify(entry.payload)
	);
}
