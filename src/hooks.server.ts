import { json, redirect, type Handle } from '@sveltejs/kit';
import os from 'node:os';
import { getSessionUser, hasAnyUser, SESSION_COOKIE } from '$lib/server/auth';
import { decodePathname, isAdminPath } from '$lib/server/admin-gating';
import { buildHostAllowlist, crossSiteVerdict, hostVerdict } from '$lib/server/request-guard';
import { announceSetupToken } from '$lib/server/setup-token';

/**
 * Names this instance answers to: loopback, its own interface addresses, the
 * mDNS name it advertises, HOST when pinned, plus ADDARR_ALLOWED_HOSTS.
 * Computed once per process — a new interface or hostname needs a restart,
 * which is also when a bind-address change takes effect.
 */
const allowedHosts = (() => {
	const addresses: string[] = [];
	for (const entries of Object.values(os.networkInterfaces())) {
		for (const entry of entries ?? []) addresses.push(entry.address);
	}
	return buildHostAllowlist({ hostname: os.hostname(), addresses, env: process.env });
})();

// Auth model: members use the app anonymously; only admin surfaces need a
// session (admin created at first-run setup, 12-hour rolling sessions).
export const handle: Handle = async ({ event, resolve }) => {
	const pathname = decodePathname(event.url.pathname);

	// DNS rebinding: the attacker's name resolves to this machine, so without a
	// Host check their page becomes same-origin with Addarr — same-origin fetch
	// with JSON, and an Origin that matches event.url.origin (AS-03).
	const host = hostVerdict(event.request.headers.get('host'), allowedHosts);
	if (!host.ok) {
		console.warn(`[host] rejected ${event.request.headers.get('host')} for ${pathname}`);
		if (pathname.startsWith('/api/')) return json({ error: host.error }, { status: 403 });
		return new Response(host.error, {
			status: 403,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
		});
	}

	// First run: make sure the one-time setup token exists and is in the log, so
	// the owner can finish setup from another device before a neighbour does
	// (AS-05). No-op (a boolean read) once an admin exists.
	announceSetupToken();

	const sid = event.cookies.get(SESSION_COOKIE);
	event.locals.user = sid ? getSessionUser(sid, event.cookies) : null;

	// SvelteKit resolves routes against a decoded pathname, while
	// `event.url.pathname` keeps percent-encoding. Gate on a decoded view (and
	// the raw one) — stricter than the router — so encoded spellings cannot
	// skip the admin check (AUD-01).
	const isApi = pathname.startsWith('/api/') || pathname.startsWith('/arrapi/');
	const needsAdmin = isAdminPath(event.url.pathname);

	if (pathname.startsWith('/api/')) {
		// The member API is anonymous and expensive: refuse requests that another
		// site's page drove, which an <img> tag or a no-cors fetch is enough to do
		// (AS-02). SvelteKit's own CSRF check only covers form content types.
		const site = crossSiteVerdict({
			secFetchSite: event.request.headers.get('sec-fetch-site'),
			origin: event.request.headers.get('origin'),
			referer: event.request.headers.get('referer'),
			expectedOrigin: event.url.origin
		});
		if (!site.ok) return json({ error: site.error }, { status: 403 });
	}

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
	if (pathname === '/setup') {
		if (hasAnyUser()) redirect(302, event.locals.user ? '/' : '/login');
		return resolve(event);
	}

	// /api/auth/setup guards itself (403 once an admin exists).
	// /login is the admin sign-in page; signed-in admins bounce to home.
	if (pathname === '/login' && event.locals.user) redirect(302, '/');

	return resolve(event);
};
