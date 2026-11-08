/**
 * Shared acquisition-state normalization for *arr library items.
 * Pure functions — used by both /api/status and /api/search so every
 * surface (poster cards, status polling) speaks the same state vocabulary.
 *
 * States: waiting → queued → downloading → importing → available, plus
 * paused, partial (series: some episodes on disk), attention (download
 * client warning/error, where stuck imports surface), missing (in library,
 * released, nothing on disk), unreleased (in library, not yet released).
 */

export type ArrItemState =
	| 'waiting'
	| 'queued'
	| 'paused'
	| 'downloading'
	| 'importing'
	| 'partial'
	| 'attention'
	| 'available'
	| 'missing'
	| 'unreleased';

export type ArrItemStatus = {
	state: ArrItemState;
	progress?: number | null;
	timeLeftSeconds?: number | null;
	size?: number | null;
	sizeLeft?: number | null;
	episodes?: { have: number; total: number } | null;
};

type QueueRow = Record<string, unknown>;

/**
 * States that imply the arr is (or should be) pursuing the title. An
 * unmonitored library item with no queue activity must not present these —
 * they would claim work that nobody asked for (AUD-05).
 */
export function isPursuitState(state: ArrItemState): boolean {
	return state === 'missing' || state === 'unreleased' || state === 'partial';
}

/** '[d.]HH:MM:SS' → seconds; null when absent/unparseable. */
export function parseTimeleft(v: unknown): number | null {
	const s = String(v ?? '').trim();
	const m = /^(?:(\d+)\.)?(\d+):(\d{1,2}):(\d{1,2})$/.exec(s);
	if (!m) return null;
	const days = m[1] ? Number(m[1]) : 0;
	const h = Number(m[2]);
	const min = Number(m[3]);
	const sec = Number(m[4]);
	if (!Number.isFinite(h + min + sec) || min > 59 || sec > 59) return null;
	return days * 86400 + h * 3600 + min * 60 + sec;
}

/**
 * Aggregate one or more queue rows for a single library item (season packs
 * and multi-file downloads produce several rows). Progress is summed bytes;
 * time left is the max row (conservative); state precedence: warning →
 * downloading → importing → paused → queued.
 */
export function aggregateQueue(rows: QueueRow[]): ArrItemStatus {
	const size = rows.reduce((a, q) => a + Number(q.size ?? 0), 0);
	// *arr serializes Sizeleft as `sizeleft`; keep the camelCase fallback for
	// older fixtures/payloads.
	const left = rows.reduce((a, q) => a + Number(q.sizeleft ?? q.sizeLeft ?? 0), 0);
	let progress = size > 0 ? Math.round(((size - left) / size) * 100) : null;
	if (progress != null) {
		if (!Number.isFinite(progress)) progress = null;
		else progress = Math.min(100, Math.max(0, progress));
	}

	const timelefts = rows.map((q) => parseTimeleft(q.timeleft)).filter((v): v is number => v != null);
	const timeLeftSeconds = timelefts.length > 0 ? Math.max(...timelefts) : null;

	const warned = rows.some((q) => {
		const t = String(q.trackedDownloadStatus ?? 'ok').toLowerCase();
		return t === 'warning' || t === 'error';
	});
	const downloading = rows.some((q) => q.status === 'downloading');
	// Download finished, *arr is post-processing/importing the file — this can
	// also be where a stuck import lingers, so surface it as its own state.
	const importing = rows.some((q) =>
		['completed', 'importing', 'importpending'].includes(String(q.status ?? '').toLowerCase())
	);
	const paused = rows.some((q) => q.status === 'paused');

	const state: ArrItemState = warned
		? 'attention'
		: downloading
			? 'downloading'
			: importing
				? 'importing'
				: paused
					? 'paused'
					: 'queued';
	return { state, progress, timeLeftSeconds, size, sizeLeft: left };
}

type MovieLike = {
	hasFile?: boolean;
	movieFile?: unknown;
	monitored?: boolean;
	isAvailable?: boolean;
};

/** Status for a Radarr movie, given the queue rows matching its id. */
export function movieStatus(movie: MovieLike, rows: QueueRow[]): ArrItemStatus {
	if (rows.length > 0) return aggregateQueue(rows);
	if (movie.hasFile === true || movie.movieFile != null) return { state: 'available' };
	if (movie.isAvailable === true) return { state: 'missing' };
	return { state: 'unreleased' };
}

type SeriesStats = { episodeFileCount?: number; totalEpisodeCount?: number; episodeCount?: number };

/** Status for a Sonarr series, given the queue rows matching its id. */
export function seriesStatus(
	series: { statistics?: SeriesStats | null; monitored?: boolean; ended?: boolean },
	rows: QueueRow[]
): ArrItemStatus {
	const have = series.statistics?.episodeFileCount ?? 0;
	// Aired count is the member-truthful denominator; total includes unaired/future episodes.
	const aired = series.statistics?.episodeCount ?? series.statistics?.totalEpisodeCount ?? 0;
	const total = series.statistics?.totalEpisodeCount ?? aired;

	if (rows.length > 0) {
		// While downloading, progress is byte-based; episode counts ride along
		// so the UI can show them once the queue drains.
		const base = aggregateQueue(rows);
		return aired > 0 ? { ...base, episodes: { have, total: aired } } : base;
	}
	if (aired <= 0) return { state: 'unreleased' };
	if (have >= aired) return { state: 'available' };
	if (have > 0) {
		const pct = Math.min(100, Math.max(0, Math.round((have / aired) * 100)));
		return { state: 'partial', progress: pct, episodes: { have, total: aired } };
	}
	return { state: 'missing' };
}
