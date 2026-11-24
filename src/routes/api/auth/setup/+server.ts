import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createSession,
	getUserByUsername,
	hasAnyUser,
	hashPin,
	isValidPin,
	isValidUsername,
	logActivity
} from '$lib/server/auth';
import { db } from '$lib/server/db';

/** POST /api/auth/setup — create the first admin account. Only works pre-first-run. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: { username?: string; pin?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!isValidUsername(body.username)) {
		return json(
			{ error: 'Username must be 1–32 characters (letters, digits, . _ -)' },
			{ status: 400 }
		);
	}
	if (!isValidPin(body.pin)) {
		return json({ error: 'PIN must be 4–6 digits' }, { status: 400 });
	}

	// Cheap pre-check before the expensive part: `hashPin` used to run as an
	// argument to INSERT ... WHERE NOT EXISTS, so every post-setup request burned
	// a 19 MiB argon2id hash (17–28 ms of the single event loop) and threw it
	// away. Unauthenticated, unthrottled, ~20× the cost of a rejected login
	// (AS-04).
	if (hasAnyUser()) {
		return json({ error: 'Setup already completed — log in instead' }, { status: 403 });
	}

	// Atomic: only insert when no users exist; concurrent setups race, one wins (F-AUTH-02).
	try {
		const r = db
			.prepare(`INSERT INTO users (username, pin_hash, role) SELECT ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)`)
			.run(body.username, hashPin(body.pin));
		if (r.changes === 0) {
			return json({ error: 'Setup already completed — log in instead' }, { status: 403 });
		}
	} catch (err) {
		if (String(err instanceof Error ? err.message : err).includes('UNIQUE')) {
			return json({ error: 'Setup already completed — log in instead' }, { status: 403 });
		}
		throw err;
	}

	const user = getUserByUsername(body.username!);
	if (!user) return json({ error: 'Setup failed — try again' }, { status: 500 });
	createSession(cookies, user.id, 'admin');
	try { logActivity({ userId: user.id, serviceId: null, action: 'auth.setup', title: user.username }); } catch { /* best-effort */ }
	return json({ ok: true, role: 'admin' });
};
