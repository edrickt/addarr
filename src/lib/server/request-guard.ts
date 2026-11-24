/**
 * Request-origin guards for the browser-facing API.
 *
 * Two independent controls live here so they can be unit-tested away from the
 * SvelteKit hook:
 *
 * - `crossSiteVerdict` — a page on any other origin must not be able to drive
 *   `/api/**`. The member endpoints are anonymous GETs that read whole *arr
 *   libraries and queues, so a single `<img src="http://addarr.local:4545/api/
 *   status/batch?movies=…">` was enough to make the house do the work (AS-02).
 *   SvelteKit's built-in CSRF check only covers form content types.
 * - `hostVerdict` — the `Host` header must name this machine (AS-03). Without
 *   it, DNS rebinding makes the attacker's page same-origin with Addarr, which
 *   defeats every origin check above.
 */

export type Verdict = { ok: true } | { ok: false; error: string };

const OK: Verdict = { ok: true };

/**
 * Origins that may call `/api/**`. `expectedOrigin` comes from the request URL,
 * which is only trustworthy once `hostVerdict` has accepted the `Host` header.
 */
export function crossSiteVerdict(input: {
	secFetchSite: string | null;
	origin: string | null;
	referer: string | null;
	expectedOrigin: string;
}): Verdict {
	const site = input.secFetchSite?.toLowerCase() ?? null;
	// Modern browsers label every request: navigations are "none", requests made
	// by the page itself are "same-origin" (or "same-site" behind a shared
	// registrable domain). Anything else is another site's page driving us.
	if (site === 'cross-site') {
		return { ok: false, error: 'Cross-site requests are not allowed' };
	}

	// Browsers that do not send Sec-Fetch-* still send Origin on CORS and
	// non-GET requests, and Referer on most navigations and subresources.
	if (site === null) {
		if (input.origin !== null && !sameOrigin(input.origin, input.expectedOrigin)) {
			return { ok: false, error: 'Cross-site requests are not allowed' };
		}
		if (input.origin === null && input.referer !== null) {
			const refererOrigin = originOf(input.referer);
			// A Referer we cannot parse is not evidence of a foreign page.
			if (refererOrigin !== null && !sameOrigin(refererOrigin, input.expectedOrigin)) {
				return { ok: false, error: 'Cross-site requests are not allowed' };
			}
		}
	}

	return OK;
}

function originOf(value: string): string | null {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function sameOrigin(a: string, b: string): boolean {
	const left = originOf(a);
	return left !== null && left === originOf(b);
}

/**
 * Host allow-list inputs. Addarr is a LAN appliance: it is reached by loopback,
 * by the machine's own addresses (LAN/Tailscale IPv4+IPv6) and by the mDNS name
 * it advertises (`<hostname>.local`). Those are the only names it should answer
 * to, so a rebinding domain — which resolves to this machine but *is* the
 * attacker's origin — is refused (AS-03).
 */
export function buildHostAllowlist(input: {
	hostname: string;
	/** Interface addresses, e.g. os.networkInterfaces() flattened. */
	addresses: string[];
	/** Environment overrides: HOST (bind address) and ADDARR_ALLOWED_HOSTS. */
	env?: Record<string, string | undefined>;
}): Set<string> {
	const allowed = new Set<string>();
	const add = (value: string | null | undefined): void => {
		if (!value) return;
		for (const part of value.split(',')) {
			const host = normalizeHost(part.trim());
			if (host !== null) allowed.add(host);
		}
	};

	// Loopback, always: `npm run dev`, localhost-only installs, health probes.
	add('localhost');
	add('127.0.0.1');
	add('[::1]');
	add('::1');

	// The advertised mDNS name and the bare hostname (Windows/mDNS fallbacks).
	const hostname = input.hostname.trim().toLowerCase();
	if (hostname) {
		add(hostname);
		add(`${hostname}.local`);
		add(hostname.split('.')[0]);
	}

	// Bare IPv6 has to be bracketed before it can be a Host header.
	const addAddress = (value: string): void => {
		const address = value.trim();
		if (address === '' || address === '0.0.0.0' || address === '::') return;
		add(address.includes(':') && !address.startsWith('[') ? `[${address}]` : address);
	};

	// Every address this machine currently has. Reaching Addarr by LAN IP is
	// the documented way to share it; an attacker cannot bind a name to one.
	for (const address of input.addresses) addAddress(address);

	// HOST pins the bind address; a wildcard bind adds no name of its own.
	if (input.env?.HOST) addAddress(input.env.HOST);

	// Escape hatch for a reverse proxy or a DNS name in front of Addarr.
	add(input.env?.ADDARR_ALLOWED_HOSTS);

	return allowed;
}

/**
 * Host allow-list. Returns the offending host in the error so the browser (and
 * the admin reading the log) is told what was rejected. An absent `Host` is
 * accepted: HTTP/1.0 clients and health probes send none, and DNS rebinding
 * always arrives with one (the attacker's name).
 */
export function hostVerdict(hostHeader: string | null, allowed: ReadonlySet<string>): Verdict {
	if (hostHeader === null || hostHeader.trim() === '') return OK;
	const host = normalizeHost(hostHeader);
	if (host === null) return { ok: false, error: `Unrecognized Host header: ${hostHeader}` };
	if (allowed.has(host)) return OK;
	return {
		ok: false,
		error:
			`Host not allowed: ${host}. Addarr answers only to its own addresses ` +
			`(localhost, <hostname>.local, its LAN IPs). Use one of those, or set ` +
			`ADDARR_ALLOWED_HOSTS to add this name.`
	};
}

/**
 * `Example.LOCAL:4545` → `example.local`; bracketed IPv6 keeps its brackets so
 * `[::1]:4545` and `[::1]` normalize to the same key. Returns null when the
 * header is not a host:port pair at all.
 */
export function normalizeHost(hostHeader: string): string | null {
	let host = hostHeader.trim().toLowerCase();
	if (host.startsWith('[')) {
		const close = host.indexOf(']');
		if (close === -1) return null;
		const inner = host.slice(1, close);
		const rest = host.slice(close + 1);
		if (rest !== '' && !/^:\d+$/.test(rest)) return null;
		return inner === '' ? null : `[${inner}]`;
	}
	// Strip a single trailing port; more than one colon here is a bare IPv6
	// address, which must be bracketed in a Host header.
	const colon = host.lastIndexOf(':');
	if (colon !== -1) {
		if (!/^\d+$/.test(host.slice(colon + 1))) return null;
		host = host.slice(0, colon);
	}
	host = host.replace(/\.+$/, ''); // a fully-qualified name may end in a dot
	return host === '' ? null : host;
}
