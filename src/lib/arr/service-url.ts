/**
 * Service base-URL validation for the Settings connection form.
 *
 * Pure so it can be unit-tested without a database or a live arr. Keeps the
 * reverse-proxy subpath (F-SETTINGS-03) while refusing schemes the arr client
 * cannot talk to — `file:///etc/passwd` used to reach `fetch` as the nonsense
 * URL `null/etc/passwd` and surface that string to the admin (AUD-12).
 */

export type NormalizedServiceUrl = { baseUrl: string } | { error: string };

export function normalizeServiceBaseUrl(raw: unknown): NormalizedServiceUrl {
	if (typeof raw !== 'string' || !raw.trim()) return { error: 'baseUrl is required' };
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { error: 'baseUrl must be a valid URL, e.g. http://192.168.1.10:7878' };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { error: 'baseUrl must start with http:// or https://' };
	}
	if (url.search || url.hash) {
		return { error: 'baseUrl must not include a query string or fragment' };
	}
	// Preserve a reverse-proxy subpath; strip only trailing slashes.
	const path = url.pathname.replace(/\/+$/, '');
	return { baseUrl: `${url.origin}${path}` };
}
