/**
 * Admin-surface gating, kept separate from `hooks.server.ts` so the matching
 * rule is unit-testable.
 *
 * SvelteKit resolves routes against the *decoded* pathname (`decode_pathname`
 * in @sveltejs/kit), but `event.url.pathname` keeps percent-encoding. Matching
 * the gate against the raw pathname therefore let an encoded first character
 * (e.g. `/%61pi/services`) resolve to an admin route while the gate saw a path
 * that matched no admin prefix. Gate against the decoded path — and the raw one
 * — so encoded and plain spellings agree.
 */

export const ADMIN_PREFIXES = [
	'/settings',
	'/presets',
	'/console',
	'/activity',
	'/api/services',
	'/api/presets',
	'/api/console',
	'/api/activity',
	'/api/settings',
	'/api/restart',
	'/arrapi'
] as const;

/** Decode a pathname for route-identity comparisons; malformed input stays raw. */
export function decodePathname(pathname: string): string {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}

function matchesAdminPrefix(path: string): boolean {
	return ADMIN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * True when a request pathname (raw, as it appears in `event.url.pathname`)
 * addresses an admin-only page or API surface. Checks both the literal and the
 * decoded pathname: either spelling of an admin path is gated.
 */
export function isAdminPath(pathname: string): boolean {
	return matchesAdminPrefix(pathname) || matchesAdminPrefix(decodePathname(pathname));
}
