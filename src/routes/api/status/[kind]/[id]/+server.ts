import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { ArrError } from '$lib/arr/types';

/**
 * GET /api/status/:kind/:id — simple polled badge state for an item the
 * member just added. kind is movie|series; id is the arr item id returned
 * by POST /api/add. States: waiting → queued → downloading → available.
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

		if (client instanceof RadarrClient) {
			const movie = await client.movie(id);
			if (!movie) return json({ state: 'waiting' });
			const inQueue = (await client.queue()).find((q) => q.movieId === id);
			return json(statusFrom(movie.hasFile === true || movie.movieFile != null, inQueue));
		}

		if (client instanceof SonarrClient) {
			const series = await client.series(id);
			if (!series) return json({ state: 'waiting' });
			const inQueue = (await client.queue()).find((q) => q.seriesId === id);
			const stats = series.statistics;
			const complete =
				stats != null && stats.totalEpisodeCount! > 0 && stats.episodeFileCount! >= stats.totalEpisodeCount!;
			return json(statusFrom(complete, inQueue));
		}

		return json({ error: 'Unknown service adapter' }, { status: 500 });
	} catch (err) {
		if (err instanceof ArrError) {
			return json({ error: err.message }, { status: err.status === 502 ? 502 : 400 });
		}
		return json({ error: 'Status check failed' }, { status: 500 });
	}
};

function statusFrom(hasFile: boolean, inQueue?: Record<string, unknown>) {
	if (hasFile) return { state: 'available' as const };
	if (inQueue) {
		if (inQueue.status === 'downloading') {
			const size = Number(inQueue.size ?? 0);
			const left = Number(inQueue.sizeLeft ?? 0);
			const progress = size > 0 ? Math.round(((size - left) / size) * 100) : undefined;
			return { state: 'downloading' as const, progress };
		}
		return { state: 'queued' as const };
	}
	return { state: 'waiting' as const };
}
