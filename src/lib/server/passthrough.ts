/**
 * Allow-list for the read-only `/arrapi/:service/*` passthrough, plus the
 * path normalization that decides what actually gets proxied.
 *
 * Keeping this pure and separate from the route makes the security boundary
 * testable. The rule: normalize the requested subpath first (backslashes and
 * dot segments included — WHATWG URL parsing treats `\` as `/` when the URL is
 * built, so `queue/..\system\backup` would escape a naive prefix match), then
 * match the allow-list against the *normalized* path and forward the
 * *normalized* path.
 */

export const PASSTHROUGH_ALLOWLIST: RegExp[] = [
	/^\/system\/status$/,
	/^\/diskspace$/,
	/^\/health$/,
	/^\/movie(\/\d+)?$/,
	/^\/movie\/lookup\b/,
	/^\/series(\/\d+)?$/,
	/^\/series\/lookup\b/,
	/^\/episode\b/,
	/^\/queue\b/,
	/^\/history\b/,
	/^\/blocklist\b/,
	/^\/importexclusions(\/\d+)?$/,
	/^\/calendar\b/,
	/^\/command(\/\d+)?$/, // GET /command lists recent commands — POST never reaches us
	/^\/qualityprofile\b/,
	/^\/rootfolder\b/,
	/^\/tag(\/\d+)?$/
];

/**
 * Resolve a requested subpath to the path that will be proxied.
 * Backslashes are treated as separators (matching URL parsing), `.` segments
 * are dropped and `..` segments pop — so traversal cannot hide inside an
 * allow-listed prefix. Returns a leading-slash path with no empty segments.
 */
export function normalizePassthroughPath(rawPath: string): string {
	const segments: string[] = [];
	for (const segment of rawPath.replace(/\\/g, '/').split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return `/${segments.join('/')}`;
}

export type PassthroughTarget = { target: string; allowed: boolean };

/** Resolve and allow-list-check a requested subpath in one step. */
export function resolvePassthroughPath(rawPath: string): PassthroughTarget {
	const target = normalizePassthroughPath(rawPath);
	// A double-encoded traversal (%252E%252E%255C…) is decoded once by SvelteKit
	// and still contains percent sequences here; the upstream HTTP server would
	// decode them again and could resolve the traversal, so never forward a
	// target that still carries encoded bytes (AUD-03 follow-up).
	if (target.includes('%')) return { target, allowed: false };
	return { target, allowed: PASSTHROUGH_ALLOWLIST.some((re) => re.test(target)) };
}
