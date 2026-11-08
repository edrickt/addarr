import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { resolvePassthroughPath } from '$lib/server/passthrough';
import { ArrError } from '$lib/arr/types';

/**
 * Read-only passthrough (§6.3) — the admin power escape hatch.
 * GET only, allow-listed read endpoints, API key injected server-side.
 * No user-supplied URL part ever reaches the arr host itself: the host
 * comes from the services table, and only allow-listed path prefixes pass.
 * The subpath is normalized first, so dot-segment/backslash traversal cannot
 * hide behind an allow-listed prefix (AUD-03). Write verbs are structurally
 * impossible here (405).
 */

export const GET: RequestHandler = async ({ params, url }) => {
	const service = params.service;
	if (service !== 'radarr' && service !== 'sonarr') {
		return json({ error: 'service must be "radarr" or "sonarr"' }, { status: 400 });
	}

	// Normalize, then match and forward the same normalized path — never the raw
	// request path, which URL parsing would resolve differently (AUD-03).
	const { target, allowed } = resolvePassthroughPath(params.path ?? '');
	const upstream = `${target}${url.search}`;

	if (!allowed) {
		return json(
			{ error: `Endpoint not allowed: ${target}. Curated screens cover the rest — by design.` },
			{ status: 403 }
		);
	}

	try {
		const client = getClient(service);
		const data = await client.raw('GET', upstream);
		return json(data);
	} catch (err) {
		if (err instanceof ArrError) {
			// Preserve upstream status for 4xx (auth, missing, rate-limit); map the rest to 502 (F-SETTINGS-02).
			const status = err.status >= 400 && err.status < 500 ? err.status : 502;
			console.error(`[passthrough] ${service}${upstream} failed:`, err.message);
			return json({ error: 'Passthrough request failed', detail: err.detail }, { status });
		}
		console.error(`[passthrough] ${service}${upstream} failed:`, err);
		return json({ error: 'Passthrough request failed' }, { status: 500 });
	}
};

/** Write verbs never pass through. */
export const POST = block;
export const PUT = block;
export const DELETE = block;
export const PATCH = block;

function block() {
	return json({ error: 'The passthrough is GET-only. Write access = curated screens.' }, { status: 405 });
}
