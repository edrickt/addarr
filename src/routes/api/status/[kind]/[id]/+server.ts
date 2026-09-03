import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClient } from '$lib/server/arr-factory';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { ArrError } from '$lib/arr/types';

/**
 * GET /api/status/:kind/:id — polled acquisition state for an item the
 * member just added. kind is movie|series; id is the arr item id returned
 * by POST /api/add. States: waiting → queued → downloading → available,
 * plus paused (queue paused), partial (series: some episodes on disk,
 * nothing queued), attention (download client warning/error).
 * Payload: { state, progress?, timeLeftSeconds?, episodes? }. All
 * Radarr/Sonarr differences are normalized server-side (council decision).
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
			const movie = await client.movie(id);
			if (!movie) return json({ state: 'waiting' });
			return json({ state: movie.hasFile === true || movie.movieFile != null ? 'available' : 'waiting' });
		}

		if (client instanceof SonarrClient) {
			const rows = queue.filter((q) => q.seriesId === id);
			const series = await client.series(id);
			if (!series) return json({ state: 'waiting' });
			const stats = series.statistics;
			const have = stats?.episodeFileCount ?? 0;
			const total = stats?.totalEpisodeCount ?? 0;

			if (rows.length > 0) {
				// While downloading, progress is byte-based; episode counts ride
				// along so the UI can show them once the queue drains.
				const base = aggregateQueue(rows);
				return json(total > 0 ? { ...base, episodes: { have, total } } : base);
			}

			if (total > 0 && have >= total) return json({ state: 'available' });
			if (total > 0 && have > 0) {
				return json({ state: 'partial', progress: Math.round((have / total) * 100), episodes: { have, total } });
			}
			return json({ state: 'waiting' });
		}

		return json({ error: 'Unknown service adapter' }, { status: 500 });
	} catch (err) {
		if (err instanceof ArrError) {
			return json({ error: err.message }, { status: err.status === 502 ? 502 : 400 });
		}
		return json({ error: 'Status check failed' }, { status: 500 });
	}
};

/** 'HH:MM:SS' → seconds; null when absent/unparseable. */
function parseTimeleft(v: unknown): number | null {
	const m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(String(v ?? ''));
	if (!m) return null;
	return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Aggregate one or more queue rows for a single library item (season packs
 * and multi-file downloads produce several rows). Progress is summed bytes;
 * time left is the max row (conservative); state precedence: warning →
 * downloading → paused → queued.
 */
function aggregateQueue(rows: Record<string, unknown>[]) {
	const size = rows.reduce((a, q) => a + Number(q.size ?? 0), 0);
	const left = rows.reduce((a, q) => a + Number(q.sizeLeft ?? 0), 0);
	const progress = size > 0 ? Math.round(((size - left) / size) * 100) : null;

	const timelefts = rows
		.map((q) => parseTimeleft(q.timeleft))
		.filter((v): v is number => v != null);
	const timeLeftSeconds = timelefts.length > 0 ? Math.max(...timelefts) : null;

	const warned = rows.some((q) => {
		const t = String(q.trackedDownloadStatus ?? 'ok').toLowerCase();
		return t === 'warning' || t === 'error';
	});
	const downloading = rows.some((q) => q.status === 'downloading');
	const paused = rows.some((q) => q.status === 'paused');

	const state = warned ? 'attention' : downloading ? 'downloading' : paused ? 'paused' : 'queued';
	return { state, progress, timeLeftSeconds };
}
