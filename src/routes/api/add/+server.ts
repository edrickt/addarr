import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { ArrError } from '$lib/arr/types';
import { getServiceByType } from '$lib/server/db';
import { getDefaultPresetRow, presetToAddDefaults } from '$lib/server/presets';
import { logActivity } from '$lib/server/auth';

/**
 * POST /api/add — { service: 'movie'|'series', id: tmdbId|tvdbId }.
 * Applies the service's default preset, dedupe-checks, then adds. The
 * preset's search_on_add maps to addOptions.searchFor* — never a separate
 * search command (duplicate-search footgun). Every add is logged.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	let body: { service?: string; id?: number };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const kind = body.service;
	if (kind !== 'movie' && kind !== 'series') {
		return json({ error: 'service must be "movie" or "series"' }, { status: 400 });
	}
	if (!Number.isInteger(body.id) || (body.id as number) <= 0) {
		return json({ error: 'id must be the tmdbId (movie) or tvdbId (series)' }, { status: 400 });
	}
	const sourceId = body.id as number;

	const type = kind === 'movie' ? 'radarr' : 'sonarr';
	const svc = getServiceByType(type);
	if (!svc) {
		return json(
			{ error: `${type === 'radarr' ? 'Radarr' : 'Sonarr'} is not connected yet` },
			{ status: 503 }
		);
	}

	const preset = getDefaultPresetRow(svc.id);
	if (!preset || preset.quality_profile_id <= 0 || !preset.root_folder_path) {
		return json(
			{ error: 'No usable default preset — ask an admin to finish Settings' },
			{ status: 400 }
		);
	}
	const defaults = presetToAddDefaults(preset);
	// Members use the app anonymously — activity entries may have no user.
	const user = locals.user;

	try {
		const client = getClient(type);

		if (client instanceof RadarrClient) {
			const library = await client.allMovies();
			if (library.some((m) => m.tmdbId === sourceId)) {
				return json({ error: 'Already in the library', inLibrary: true }, { status: 409 });
			}
			const movie = await client.getByTmdbId(sourceId);
			if (!movie?.tmdbId) {
				return json({ error: 'Movie not found on TMDB (via Radarr)' }, { status: 404 });
			}
			const added = await client.add(movie, defaults);
			logActivity({
				userId: user?.id ?? null,
				serviceId: svc.id,
				action: 'add.movie',
				arrItemId: added.id ?? null,
				title: added.title,
				payload: { tmdbId: movie.tmdbId, preset: preset.name, searchOnAdd: defaults.searchOnAdd }
			});
			return json({ ok: true, id: added.id, title: added.title, searchQueued: defaults.searchOnAdd });
		}

		if (client instanceof SonarrClient) {
			const library = await client.allSeries();
			if (library.some((s) => s.tvdbId === sourceId)) {
				return json({ error: 'Already in the library', inLibrary: true }, { status: 409 });
			}
			const series = await client.getByTvdbId(sourceId);
			if (!series?.tvdbId) {
				return json({ error: 'Series not found on TVDB (via Sonarr)' }, { status: 404 });
			}
			const added = await client.add(series, defaults);
			logActivity({
				userId: user?.id ?? null,
				serviceId: svc.id,
				action: 'add.series',
				arrItemId: added.id ?? null,
				title: added.title,
				payload: {
					tvdbId: series.tvdbId,
					preset: preset.name,
					searchOnAdd: defaults.searchOnAdd,
					seriesType: added.seriesType
				}
			});
			return json({ ok: true, id: added.id, title: added.title, searchQueued: defaults.searchOnAdd });
		}

		return json({ error: 'Unknown service adapter' }, { status: 500 });
	} catch (err) {
		if (err instanceof ArrError) {
			return json({ error: err.message }, { status: err.status === 502 ? 502 : 400 });
		}
		return json(
			{ error: err instanceof Error ? err.message : 'Add failed' },
			{ status: 500 }
		);
	}
};
