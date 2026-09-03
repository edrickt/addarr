import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { destroySession, SESSION_COOKIE } from '$lib/server/auth';

/** POST /api/auth/logout — delete the current session. */
export const POST: RequestHandler = async ({ cookies }) => {
	const sid = cookies.get(SESSION_COOKIE);
	if (sid) destroySession(sid, cookies);
	return json({ ok: true });
};
