import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { getServiceByType } from '$lib/server/db';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { normalizeMovieFile, normalizeSeriesFiles } from '$lib/arr/files';
import { ArrError } from '$lib/arr/types';

/**
 * GET /api/files/:kind/:id — member-safe list of media files on disk.
 * Movie: one file entry. Series: downloaded episodes grouped by season.
 * Paths, release names, download clients, and raw *arr errors never leave
 * the server.
 */
export const GET: RequestHandler = async ({ params }) => {
	const kind = params.kind;
	const id = Number(params.id);
	if (kind !== 'movie' && kind !== 'series') {
		return json({ error: 'kind must be "movie" or "series"' }, { status: 400 });
	}
	if (!Number.isInteger(id) || id <= 0) {
		return json({ error: 'invalid id' }, { status: 400 });
	}

	try {
		if (kind === 'movie') {
			if (!getServiceByType('radarr')) {
				return json({ error: 'Movie library is not available' }, { status: 503 });
			}
			const client = getClient('radarr');
			if (!(client instanceof RadarrClient)) {
				return json({ error: 'Movie library is not available' }, { status: 503 });
			}
			const movie = await client.movie(id);
			return json(normalizeMovieFile(movie), { headers: { 'cache-control': 'no-store' } });
		}

		if (!getServiceByType('sonarr')) {
			return json({ error: 'Series library is not available' }, { status: 503 });
		}
		const client = getClient('sonarr');
		if (!(client instanceof SonarrClient)) {
			return json({ error: 'Series library is not available' }, { status: 503 });
		}
		const episodes = await client.episodes(id, { includeEpisodeFile: true });
		return json(normalizeSeriesFiles(episodes), { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof ArrError) {
			// 404 stays 404; malformed ids stay 400. Upstream auth, rate-limit,
			// and server failures are gateway failures from the browser's view.
			const status = err.status === 404 ? 404 : err.status === 400 ? 400 : 502;
			return json({ error: 'Could not load files' }, { status });
		}
		return json({ error: 'Could not load files' }, { status: 500 });
	}
};
