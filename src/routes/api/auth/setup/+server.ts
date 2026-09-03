import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession, createUser, hasAnyUser, isValidPin, isValidUsername } from '$lib/server/auth';

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

	if (hasAnyUser()) {
		return json({ error: 'Setup already completed — log in instead' }, { status: 403 });
	}

	const user = createUser({ username: body.username, pin: body.pin, role: 'admin' });
	createSession(cookies, user.id, 'admin');
	return json({ ok: true, role: 'admin' });
};
