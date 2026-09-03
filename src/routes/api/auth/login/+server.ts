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
export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: { username?: string; pin?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!isValidUsername(body.username) || !isValidPin(body.pin)) {
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}

	const user = getUserByUsername(body.username);
	if (!user || user.disabled === 1 || !verifyPin(body.pin, user.pin_hash)) {
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}

	createSession(cookies, user.id, user.role);
	return json({ ok: true, role: user.role });
};
