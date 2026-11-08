import { json, redirect, type Handle } from '@sveltejs/kit';
import { getSessionUser, hasAnyUser, SESSION_COOKIE } from '$lib/server/auth';
import { decodePathname, isAdminPath } from '$lib/server/admin-gating';

// Auth model: members use the app anonymously; only admin surfaces need a
// session (admin created at first-run setup, 12-hour rolling sessions).
export const handle: Handle = async ({ event, resolve }) => {
	const sid = event.cookies.get(SESSION_COOKIE);
	event.locals.user = sid ? getSessionUser(sid, event.cookies) : null;

	// SvelteKit resolves routes against a decoded pathname, while
	// `event.url.pathname` keeps percent-encoding. Gate on a decoded view (and
	// the raw one) — stricter than the router — so encoded spellings cannot
	// skip the admin check (AUD-01).
	const path = decodePathname(event.url.pathname);
	const isApi = path.startsWith('/api/') || path.startsWith('/arrapi/');
	const needsAdmin = isAdminPath(event.url.pathname);

	if (needsAdmin) {
		if (!hasAnyUser()) {
			// First run: the admin account must exist before any admin surface.
			if (isApi) return json({ error: 'Admin setup required' }, { status: 503 });
			redirect(302, '/setup');
		}
		if (!event.locals.user) {
			if (isApi) return json({ error: 'Admin sign-in required' }, { status: 401 });
			redirect(302, '/login');
		}
		if (event.locals.user.role !== 'admin') {
			if (isApi) return json({ error: 'Admin role required' }, { status: 403 });
			redirect(302, '/');
		}
		return resolve(event);
	}

	// Setup is only reachable pre-first-run.
	if (path === '/setup') {
		if (hasAnyUser()) redirect(302, event.locals.user ? '/' : '/login');
		return resolve(event);
	}

	// /api/auth/setup guards itself (403 once an admin exists).
	// /login is the admin sign-in page; signed-in admins bounce to home.
	if (path === '/login' && event.locals.user) redirect(302, '/');

	return resolve(event);
};
