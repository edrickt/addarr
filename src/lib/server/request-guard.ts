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
