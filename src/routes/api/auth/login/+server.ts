import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	getUserByUsername,
	isValidPin,
	isValidUsername,
	verifyPin
} from '$lib/server/auth';

/** POST /api/auth/login — { username, pin } → session cookie. */

// In-memory failed-attempt backoff: a 4-digit PIN is otherwise brute-forceable
// even against argon2. LAN threat model — this table resets on restart, which
// is acceptable; the point is making automated guessing slow, not impossible.
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; first: number }>();

function backoffKey(username: string, ip: string): string {
	return `${username}@${ip}`;
}

function isBlocked(key: string): boolean {
	const entry = attempts.get(key);
	if (!entry) return false;
	if (Date.now() - entry.first > WINDOW_MS) {
		attempts.delete(key);
		return false;
	}
	return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
	const now = Date.now();
	const entry = attempts.get(key);
	if (!entry || now - entry.first > WINDOW_MS) {
		attempts.set(key, { count: 1, first: now });
	} else {
		entry.count++;
	}
	// Opportunistic prune so the map can't grow unbounded.
	if (attempts.size > 500) {
		for (const [k, v] of attempts) {
			if (now - v.first > WINDOW_MS) attempts.delete(k);
		}
	}
}

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	let body: { username?: string; pin?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const key = backoffKey(String(body.username ?? ''), getClientAddress());
	if (isBlocked(key)) {
		return json(
			{ error: 'Too many failed attempts — wait 10 minutes and try again.' },
			{ status: 429 }
		);
	}

	if (!isValidUsername(body.username) || !isValidPin(body.pin)) {
		recordFailure(key);
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}

	const user = getUserByUsername(body.username);
	if (!user || user.disabled === 1 || !verifyPin(body.pin, user.pin_hash)) {
		recordFailure(key);
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}

	attempts.delete(key);
	createSession(cookies, user.id, user.role);
	return json({ ok: true, role: user.role });
};
