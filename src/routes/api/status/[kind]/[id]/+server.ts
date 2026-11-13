import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { aggregateQueue, movieStatus, seriesStatus } from '$lib/arr/status';
import { ArrError } from '$lib/arr/types';

/**
 * GET /api/status/:kind/:id — polled acquisition state for an item the
 * member just added (or an in-library item on a poster card).
 * kind is movie|series; id is the arr item id. States and payload shape are
 * normalized in $lib/arr/status — see that module for the vocabulary.
 * (Decision D4: polling only, no websockets.)
 */
export const GET: RequestHandler = async ({ params }) => {
	const kind = params.kind;
	const id = Number(params.id);
	if (kind !== 'movie' && kind !== 'series') {
		return json({ error: 'kind must be "movie" or "series"' }, { status: 400 });
	}
	if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid id' }, { status: 400 });

	try {
		const client = getClient(kind === 'movie' ? 'radarr' : 'sonarr');
		const queue = await client.queue();

		if (client instanceof RadarrClient) {
			const rows = queue.filter((q) => q.movieId === id);
			if (rows.length > 0) return json(aggregateQueue(rows));
			try {
				const movie = await client.movie(id);
				return json(movieStatus(movie, []));
			} catch (err) {
				if (err instanceof ArrError && err.status === 404) return json({ state: 'waiting' });
				throw err;
			}
		}

		if (client instanceof SonarrClient) {
			const rows = queue.filter((q) => q.seriesId === id);
			try {
				const series = await client.series(id);
				return json(seriesStatus(series, rows));
			} catch (err) {
				if (err instanceof ArrError && err.status === 404) return json({ state: 'waiting' });
				throw err;
			}
		}

		return json({ error: 'Unknown service adapter' }, { status: 500 });
	} catch (err) {
		if (err instanceof ArrError) {
			console.error(`[status] ${kind}/${id} upstream failure:`, err.message);
			return json({ error: 'The library is not responding right now' }, { status: 502 });
		}
		console.error(`[status] ${kind}/${id} failed:`, err);
		return json({ error: 'Status check failed' }, { status: 500 });
	}
};
