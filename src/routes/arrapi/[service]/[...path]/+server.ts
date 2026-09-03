import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { ArrError } from '$lib/arr/types';

/**
 * Read-only passthrough (§6.3) — the admin power escape hatch.
 * GET only, allow-listed read endpoints, API key injected server-side.
 * No user-supplied URL part ever reaches the arr host itself: the host
 * comes from the services table, and only allow-listed path prefixes pass.
 * Write verbs are structurally impossible here (405).
 */

const ALLOWED: RegExp[] = [
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

export const GET: RequestHandler = async ({ params, url }) => {
	const service = params.service;
	if (service !== 'radarr' && service !== 'sonarr') {
		return json({ error: 'service must be "radarr" or "sonarr"' }, { status: 400 });
	}

	const subPath = (params.path ?? '').replace(/^\/+/, '');
	const target = `/${subPath}${url.search}`;

	if (!ALLOWED.some((re) => re.test(target))) {
		return json(
			{ error: `Endpoint not allowed: ${target}. Curated screens cover the rest — by design.` },
			{ status: 403 }
		);
	}

	try {
		const client = getClient(service);
		const data = await client.raw('GET', target);
		return json(data);
	} catch (err) {
		if (err instanceof ArrError) {
			return json({ error: err.message, detail: err.detail }, { status: err.status === 502 ? 502 : 502 });
		}
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
