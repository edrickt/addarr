import { aggregateQueue, type ArrItemState } from './status.ts';
import { posterUrl } from './types.ts';

/**
 * Normalize *arr queue records into the member-facing Downloads list.
 *
 * One item per title: Radarr can return several queue rows for a movie
 * (upgrades), and Sonarr returns one row per episode or season pack. The
 * household thinks in titles, so rows are grouped by movieId/seriesId and
 * progress, size, and time-left are aggregated.
 */

export type ArrMediaKind = 'movie' | 'series';

export type DownloadDetail = {
	kind: ArrMediaKind;
	/** *arr item id — present for queue-backed downloads. */
	id?: number;
	title: string;
	year: number | null;
	posterUrl: string | null;
	state: ArrItemState;
	progress?: number | null;
	timeLeftSeconds?: number | null;
	size?: number | null;
	sizeLeft?: number | null;
	episodes?: { have: number; total: number } | null;
};

export type DownloadItem = DownloadDetail & {
	id: number;
	progress: number | null;
	timeLeftSeconds: number | null;
	size: number | null;
	sizeLeft: number | null;
	episodes: { have: number; total: number } | null;
};

type QueueRow = Record<string, unknown>;

export type DownloadLibraryItem = {
	id?: number;
	title?: string;
	year?: number;
	images?: { coverType: string; url?: string; remoteUrl?: string }[];
	statistics?: { episodeFileCount?: number; totalEpisodeCount?: number };
};

function queueItemId(kind: ArrMediaKind, row: QueueRow): number | null {
	const raw = kind === 'movie' ? row.movieId : row.seriesId;
	const id = Number(raw);
	return Number.isInteger(id) && id > 0 ? id : null;
}

function nestedMedia(kind: ArrMediaKind, row: QueueRow | undefined): DownloadLibraryItem | undefined {
	if (!row) return undefined;
	const raw = kind === 'movie' ? row.movie : row.series;
	return raw && typeof raw === 'object' ? (raw as DownloadLibraryItem) : undefined;
}

/** True when at least one queue row lacks the nested media metadata. */
export function queueNeedsLibrary(kind: ArrMediaKind, queue: QueueRow[]): boolean {
	return queue.some((row) => !nestedMedia(kind, row)?.title);
}

function asYear(value: unknown): number | null {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function fieldNumber(row: QueueRow, keys: string[]): number | undefined {
	for (const key of keys) {
		if (row[key] == null) continue;
		const n = Number(row[key]);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

function sumField(rows: QueueRow[], keys: string[]): number | null {
	let total = 0;
	let seen = false;
	for (const row of rows) {
		const n = fieldNumber(row, keys);
		if (n != null) {
			total += n;
			seen = true;
		}
	}
	return seen ? total : null;
}

function seriesEpisodes(item: DownloadLibraryItem | undefined): { have: number; total: number } | null {
	const have = Number(item?.statistics?.episodeFileCount ?? 0);
	const total = Number(item?.statistics?.totalEpisodeCount ?? 0);
	return Number.isFinite(total) && total > 0
		? { have: Number.isFinite(have) ? Math.max(0, have) : 0, total }
		: null;
}

/**
 * Build one DownloadItem per title from library metadata plus queue rows.
 * Rows without a movieId/seriesId are ignored; nested queue media is used as
 * a fallback when the library lookup did not include the item.
 */
export function buildDownloadItems(
	kind: ArrMediaKind,
	library: DownloadLibraryItem[],
	queue: QueueRow[]
): DownloadItem[] {
	const libraryById = new Map<number, DownloadLibraryItem>();
	for (const item of library) {
		const id = Number(item.id);
		if (Number.isInteger(id) && id > 0) libraryById.set(id, item);
	}

	const grouped = new Map<number, QueueRow[]>();
	for (const row of queue) {
		const id = queueItemId(kind, row);
		if (id == null) continue;
		const rows = grouped.get(id);
		if (rows) rows.push(row);
		else grouped.set(id, [row]);
	}

	const items: DownloadItem[] = [];
	for (const [id, rows] of grouped) {
		const known = libraryById.get(id);
		const fallback = nestedMedia(kind, rows[0]);
		const status = aggregateQueue(rows);
		items.push({
			kind,
			id,
			// Never fall back to the queue row's `title`: that is the release
			// name, which is both jargon and a privacy leak for members.
			title: String(known?.title ?? fallback?.title ?? 'Unknown title'),
			year: asYear(known?.year ?? fallback?.year),
			posterUrl: posterUrl(known?.images ?? fallback?.images),
			state: status.state,
			progress: status.progress ?? null,
			timeLeftSeconds: status.timeLeftSeconds ?? null,
			size: sumField(rows, ['size']),
			sizeLeft: sumField(rows, ['sizeleft', 'sizeLeft']),
			episodes: kind === 'series' ? seriesEpisodes(known ?? fallback) : null
		});
	}
	return items;
}

const STATE_ORDER: Record<ArrItemState, number> = {
	downloading: 0,
	importing: 1,
	queued: 2,
	paused: 3,
	attention: 4,
	available: 5,
	partial: 6,
	missing: 7,
	unreleased: 8,
	waiting: 9
};

/** Active transfers first, then titles alphabetically. */
export function sortDownloadItems(items: DownloadItem[]): DownloadItem[] {
	return [...items].sort(
		(a, b) =>
			(STATE_ORDER[a.state] ?? 99) - (STATE_ORDER[b.state] ?? 99) ||
			a.title.localeCompare(b.title)
	);
}
