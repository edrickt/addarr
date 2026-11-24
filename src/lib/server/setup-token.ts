import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DB_PATH } from './db.ts';
import { hasAnyUser } from './auth.ts';

/**
 * One-time setup token (AS-05).
 *
 * Before: a fresh install with LAN sharing had no user row, and
 * `POST /api/auth/setup` was deliberately not admin-gated — so whoever reached
 * the port first (a neighbour, or a rebinding page) became the admin, and the
 * owner was locked out until they deleted data/addarr.db by hand.
 *
 * Now loopback setup needs nothing (the owner at the keyboard), and setup from
 * another address needs this token: generated on first run, printed to the
 * console/log, stored 0600 next to the database so it survives a restart, and
 * deleted once the first admin exists. Compared in constant time, and
 * case/dash-insensitive because a human retypes it.
 */

const TOKEN_PATH = join(dirname(DB_PATH), 'setup-token');
/** Crockford-style alphabet: no I, L, O or U to misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP_LENGTH = 4;
const GROUPS = 3;

/** `XXXX-XXXX-XXXX`, 12 symbols ≈ 59 bits — plenty for a five-minute window. */
function newToken(): string {
	const bytes = randomBytes(GROUP_LENGTH * GROUPS);
	let token = '';
	for (let i = 0; i < bytes.length; i++) {
		if (i > 0 && i % GROUP_LENGTH === 0) token += '-';
		token += ALPHABET[bytes[i]! % ALPHABET.length];
	}
	return token;
}

/** Loopback means "the person sitting at this machine" for setup purposes. */
export function isLoopbackAddress(address: string): boolean {
	const value = String(address ?? '').trim().toLowerCase();
	if (value === '' ) return false;
	if (value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
	// Node reports IPv4-mapped IPv6 for a dual-stack socket.
	if (value.startsWith('::ffff:')) return isLoopbackAddress(value.slice('::ffff:'.length));
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}

function readTokenFile(): string | null {
	try {
		const token = readFileSync(TOKEN_PATH, 'utf8').trim();
		return token === '' ? null : token;
	} catch {
		return null;
	}
}

let cached: string | null = null;
let announced = false;
let usersConfirmed = false;

/**
 * The token for this first run, or null once an admin exists. Creates the file
 * on first call, so the token is stable until setup completes.
 */
export function ensureSetupToken(): string | null {
	if (hasAnyUser()) return null;
	if (cached !== null) return cached;
	const existing = readTokenFile();
	if (existing !== null) {
		cached = existing;
		return cached;
	}
	const token = newToken();
	try {
		mkdirSync(dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
		writeFileSync(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
		chmodSync(TOKEN_PATH, 0o600);
	} catch (err) {
		// Without the file a restart would mint a new token, which is survivable;
		// without the token entirely, remote setup would be impossible, so keep
		// the in-memory one and say so.
		console.error('[setup] could not persist the setup token file:', err);
	}
	cached = token;
	return cached;
}

/** Print the token once per process, while it still matters. */
export function announceSetupToken(): void {
	if (usersConfirmed) return;
	if (hasAnyUser()) {
		usersConfirmed = true;
		return;
	}
	const token = ensureSetupToken();
	if (token === null || announced) return;
	announced = true;
	console.log(`[setup] First-run setup token (needed only from another device): ${token}`);
	console.log(
		'[setup] Setup opened on this machine needs no token. The file is deleted once the admin account exists.'
	);
}

/**
 * True when `candidate` matches the current setup token. With no token to match
 * (setup already completed) this returns true — callers must check
 * `hasAnyUser()` first, as `/api/auth/setup` does.
 */
export function verifySetupToken(candidate: unknown): boolean {
	const token = ensureSetupToken();
	if (token === null) return true;
	if (typeof candidate !== 'string') return false;
	const normalize = (value: string): string => value.replace(/[\s-]/g, '').toUpperCase();
	const given = Buffer.from(normalize(candidate));
	const expected = Buffer.from(normalize(token));
	if (given.length !== expected.length) {
		// Compare the expected buffer with itself so a wrong length costs the same
		// as a wrong symbol.
		timingSafeEqual(expected, expected);
		return false;
	}
	return timingSafeEqual(given, expected);
}

/** Drop the token once the admin account exists; it can never be needed again. */
export function forgetSetupToken(): void {
	cached = null;
	usersConfirmed = true;
	try {
		rmSync(TOKEN_PATH, { force: true });
	} catch {
		/* best-effort */
	}
}
