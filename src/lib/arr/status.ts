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

/** 'HH:MM:SS' → seconds; null when absent/unparseable. */
export function parseTimeleft(v: unknown): number | null {
	const m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(String(v ?? ''));
	if (!m) return null;
	return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
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
	const progress = size > 0 ? Math.round(((size - left) / size) * 100) : null;

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

type SeriesStats = { episodeFileCount?: number; totalEpisodeCount?: number };

/** Status for a Sonarr series, given the queue rows matching its id. */
export function seriesStatus(
	series: { statistics?: SeriesStats | null; monitored?: boolean },
	rows: QueueRow[]
): ArrItemStatus {
	const have = series.statistics?.episodeFileCount ?? 0;
	const total = series.statistics?.totalEpisodeCount ?? 0;

	if (rows.length > 0) {
		// While downloading, progress is byte-based; episode counts ride along
		// so the UI can show them once the queue drains.
		const base = aggregateQueue(rows);
		return total > 0 ? { ...base, episodes: { have, total } } : base;
	}
	if (total > 0 && have >= total) return { state: 'available' };
	if (total > 0 && have > 0) {
		return { state: 'partial', progress: Math.round((have / total) * 100), episodes: { have, total } };
	}
	return { state: 'missing' };
}
