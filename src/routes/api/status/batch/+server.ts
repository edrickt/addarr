import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { aggregateQueue, movieStatus, seriesStatus } from '$lib/arr/status';
import { ArrError } from '$lib/arr/types';

/**
 * GET /api/status/batch?movies=1,2&series=3,4 — one aggregated poll per
 * refresh. Fetches each arr queue once and returns states for all requested
 * ids, fixing N-sequential-full-queue polling (F-MEMBER-07).
 *
 * Membership comes from the library list the poll already reads: an id that is
 * not in it is answered "waiting" locally. It used to run its own
 * `GET /movie/{id}` per id, which turned one anonymous request into 102 upstream
 * calls (AS-01). The only ids the member UI polls are ids it got from the arr,
 * so a real item is always in the library list.
 */
export const GET: RequestHandler = async ({ url }) => {
	const parseIds = (v: string | null): number[] =>
		(v ?? '')
			.split(',')
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isInteger(n) && n > 0)
			.slice(0, 100);

	const movieIds = parseIds(url.searchParams.get('movies'));
	const seriesIds = parseIds(url.searchParams.get('series'));

	try {
		const out: Record<string, unknown> = { movies: {}, series: {} };

		if (movieIds.length > 0) {
			const client = getClient('radarr');
			if (!(client instanceof RadarrClient)) throw new Error('unreachable');
			const [queue, library] = await Promise.all([client.queue(), client.allMovies()]);
			const byId = new Map(library.map((m) => [m.id, m]));
			for (const id of movieIds) {
				const rows = queue.filter((q) => q.movieId === id);
				if (rows.length > 0) (out.movies as Record<number, unknown>)[id] = aggregateQueue(rows);
				else {
					const movie = byId.get(id);
					if (!movie) (out.movies as Record<number, unknown>)[id] = { state: 'waiting' };
					else (out.movies as Record<number, unknown>)[id] = movieStatus(movie, []);
				}
			}
		}

		if (seriesIds.length > 0) {
			const client = getClient('sonarr');
			if (!(client instanceof SonarrClient)) throw new Error('unreachable');
			const [queue, library] = await Promise.all([client.queue(), client.allSeries()]);
			const byId = new Map(library.map((s) => [s.id, s]));
			for (const id of seriesIds) {
				const rows = queue.filter((q) => q.seriesId === id);
				const series = byId.get(id);
				if (!series) (out.series as Record<number, unknown>)[id] = { state: 'waiting' };
				else (out.series as Record<number, unknown>)[id] = seriesStatus(series, rows);
			}
		}

		return json(out);
	} catch (err) {
		if (err instanceof ArrError) {
			console.error('[status/batch] upstream failure:', err.message);
			return json({ error: 'The library is not responding right now' }, { status: 502 });
		}
		console.error('[status/batch] failed:', err);
		return json({ error: 'Status check failed' }, { status: 500 });
	}
};
