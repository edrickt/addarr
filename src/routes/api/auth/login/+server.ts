import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	DUMMY_HASH,
	getUserByUsername,
	isValidPin,
	isValidUsername,
	logActivity,
	pruneExpiredSessions,
	verifyPin
} from '$lib/server/auth';
import { createThrottle } from '$lib/server/login-throttle';

/** POST /api/auth/login — { username, pin } → session cookie. */

// In-memory failed-attempt backoff: a 4-digit PIN is otherwise brute-forceable
// even against argon2. LAN threat model — this table resets on restart, which
// is acceptable; the point is making automated guessing slow, not impossible.
//
// Every failure is counted twice: per `username@ip` (so one account cannot be
// ground down) and per `ip` (so a fresh username per request cannot buy
// unlimited argon2 verifications — AS-04). The table is bounded by size, not
// only by age (AD-06).
const throttle = createThrottle();

function backoffKeys(username: string, ip: string): string[] {
	return [`user:${username}@${ip}`, `ip:${ip}`];
}

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	let body: { username?: string; pin?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const keys = backoffKeys(String(body.username ?? ''), getClientAddress());
	if (throttle.isBlocked(keys)) {
		return json(
			{ error: 'Too many failed attempts — wait 10 minutes and try again.' },
			{ status: 429 }
		);
	}

	if (!isValidUsername(body.username) || !isValidPin(body.pin)) {
		throttle.recordFailure(keys);
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}

	const user = getUserByUsername(body.username);
	if (!user || user.disabled === 1) {
		// Same verify cost as a real account: one argon2id verification against a
		// fixed hash (AUD-08 / F-AUTH-03).
		try { verifyPin(body.pin, DUMMY_HASH); } catch { /* ignore */ }
		throttle.recordFailure(keys);
		try { logActivity({ userId: null, serviceId: null, action: 'auth.login.failure', title: String(body.username ?? '') }); } catch { /* best-effort */ }
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}
	if (!verifyPin(body.pin, user.pin_hash)) {
		throttle.recordFailure(keys);
		try { logActivity({ userId: user.id, serviceId: null, action: 'auth.login.failure', title: user.username }); } catch { /* best-effort */ }
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}

	throttle.clear(keys);
	pruneExpiredSessions();
	createSession(cookies, user.id, user.role);
	try { logActivity({ userId: user.id, serviceId: null, action: 'auth.login.success', title: user.username }); } catch { /* best-effort */ }
	return json({ ok: true, role: user.role });
};
