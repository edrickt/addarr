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
	if (!Number.isInteger(id)) return json({ error: 'invalid id' }, { status: 400 });

	try {
		const client = getClient(kind === 'movie' ? 'radarr' : 'sonarr');
		const queue = await client.queue();

		if (client instanceof RadarrClient) {
			const rows = queue.filter((q) => q.movieId === id);
			if (rows.length > 0) return json(aggregateQueue(rows));
			// Item not in *arr (404) → treat like "nothing known yet".
			const movie = await client.movie(id).catch(() => null);
			if (!movie) return json({ state: 'waiting' });
			return json(movieStatus(movie, []));
		}

		if (client instanceof SonarrClient) {
			const rows = queue.filter((q) => q.seriesId === id);
			const series = await client.series(id).catch(() => null);
			if (!series) return json({ state: 'waiting' });
			return json(seriesStatus(series, rows));
		}

		return json({ error: 'Unknown service adapter' }, { status: 500 });
	} catch (err) {
		if (err instanceof ArrError) {
			return json({ error: err.message }, { status: err.status === 502 ? 502 : 400 });
		}
		return json({ error: 'Status check failed' }, { status: 500 });
	}
};
