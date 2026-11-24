import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { aggregateQueue, movieStatus, seriesStatus } from '$lib/arr/status';

/**
 * GET /api/status/batch?movies=1,2&series=3,4 — one aggregated poll per
 * refresh. Fetches each arr queue once and returns states for all requested
 * ids, fixing N-sequential-full-queue polling (F-MEMBER-07).
 *
 * Each service is polled independently and its failure is reported in
 * `errors`, never by discarding the other service's states. The route used to
 * be all-or-nothing: one Radarr queue hiccup answered 502, and the page then
 * ran a full-queue request per card against an arr that was already unwell
 * (AD-04).
 *
 * Membership comes from the library list the poll already reads: an id that is
 * not in it is answered "waiting" locally. It used to run its own
 * `GET /movie/{id}` per id, which turned one anonymous request into 102 upstream
 * calls (AS-01).
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

	const out: {
		movies: Record<number, unknown>;
		series: Record<number, unknown>;
		errors: string[];
	} = { movies: {}, series: {}, errors: [] };

	const report = (service: 'radarr' | 'sonarr', err: unknown) => {
		if (!out.errors.includes(service)) out.errors.push(service);
		if (err instanceof Error) console.error(`[status/batch] ${service} unavailable:`, err.message);
		else console.error(`[status/batch] ${service} unavailable:`, err);
	};

	if (movieIds.length > 0) {
		try {
			const client = getClient('radarr');
			if (!(client instanceof RadarrClient)) throw new Error('unreachable');
			const [queue, library] = await Promise.all([client.queue(), client.allMovies()]);
			const byId = new Map(library.map((m) => [m.id, m]));
			for (const id of movieIds) {
				const rows = queue.filter((q) => q.movieId === id);
				if (rows.length > 0) out.movies[id] = aggregateQueue(rows);
				else {
					const movie = byId.get(id);
					out.movies[id] = movie ? movieStatus(movie, []) : { state: 'waiting' };
				}
			}
		} catch (err) {
			report('radarr', err);
		}
	}

	if (seriesIds.length > 0) {
		try {
			const client = getClient('sonarr');
			if (!(client instanceof SonarrClient)) throw new Error('unreachable');
			const [queue, library] = await Promise.all([client.queue(), client.allSeries()]);
			const byId = new Map(library.map((s) => [s.id, s]));
			for (const id of seriesIds) {
				const rows = queue.filter((q) => q.seriesId === id);
				const series = byId.get(id);
				out.series[id] = series ? seriesStatus(series, rows) : { state: 'waiting' };
			}
		} catch (err) {
			report('sonarr', err);
		}
	}

	return json(out);
};
