import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { getServiceByType } from '$lib/server/db';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { ArrError } from '$lib/arr/types';

/** GET /api/search?service=movie|series&q=term — trimmed poster-card results. */
export const GET: RequestHandler = async ({ url }) => {
	const kind = url.searchParams.get('service');
	const q = url.searchParams.get('q')?.trim();

	if (kind !== 'movie' && kind !== 'series') {
		return json({ error: 'service must be "movie" or "series"' }, { status: 400 });
	}
	if (!q) {
		return json({ error: 'q (search term) is required' }, { status: 400 });
	}

	// A household may connect only Radarr or only Sonarr. "Not configured" is a
	// normal state the member page skips, not a search failure (AUD-03).
	const type = kind === 'movie' ? 'radarr' : 'sonarr';
	if (!getServiceByType(type)) {
		return json({ service: type, results: [], unconfigured: true });
	}

	try {
		if (kind === 'movie') {
			const client = getClient('radarr');
			if (!(client instanceof RadarrClient)) throw new Error('unreachable');
			return json({ service: 'radarr', results: await client.toPosterCards(await client.lookup(q)) });
		}
		const client = getClient('sonarr');
		if (!(client instanceof SonarrClient)) throw new Error('unreachable');
		return json({ service: 'sonarr', results: await client.toPosterCards(await client.lookup(q)) });
	} catch (err) {
		if (err instanceof ArrError) {
			console.error(`[search] upstream failure:`, err.message);
			return json({ error: 'The library is not responding right now' }, { status: 502 });
		}
		console.error(`[search] failed:`, err);
		return json({ error: 'Search failed' }, { status: 400 });
	}
};
