/**
 * Member-safe media-file metadata: what is on disk, not where it lives.
 * Radarr/Sonarr file resources include paths, scene names, release groups,
 * and client details; this module deliberately drops all of that.
 */

export type MediaFileInfo = {
	quality: string | null;
	resolution: string | null;
	size: number | null;
};

export type MovieFileInfo = MediaFileInfo;

export type EpisodeFileInfo = MediaFileInfo & {
	seasonNumber: number;
	episodeNumber: number;
	title: string | null;
};

export type SeasonFiles = {
	seasonNumber: number;
	episodes: EpisodeFileInfo[];
	fileCount: number;
	totalSize: number | null;
};

export type MediaFiles = {
	kind: 'movie' | 'series';
	movie: MovieFileInfo | null;
	seasons: SeasonFiles[];
	episodeCount: number;
	fileCount: number;
	totalSize: number | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as UnknownRecord)
		: null;
}

function asNumber(value: unknown): number | null {
	if (value == null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function fileInfo(file: UnknownRecord | null): MediaFileInfo {
	const quality = asRecord(file?.quality);
	const nestedQuality = asRecord(quality?.quality);
	const mediaInfo = asRecord(file?.mediaInfo);
	return {
		quality: asString(nestedQuality?.name) ?? asString(quality?.name),
		resolution:
			asString(mediaInfo?.resolution) ??
			asString(nestedQuality?.resolution) ??
			asString(quality?.resolution),
		size: asNumber(file?.size)
	};
}

function emptyFiles(kind: 'movie' | 'series'): MediaFiles {
	return {
		kind,
		movie: null,
		seasons: [],
		episodeCount: 0,
		fileCount: 0,
		totalSize: null
	};
}

/** Total is unknown if any file in the set has an unknown size. */
function sumSizes(sizes: Iterable<number | null>): number | null {
	let total = 0;
	let seen = false;
	for (const size of sizes) {
		if (size == null) return null;
		total += size;
		seen = true;
	}
	return seen ? total : null;
}

/** Normalize the single file attached to a Radarr movie resource. */
export function normalizeMovieFile(
	movie: { movieFile?: unknown } | Record<string, unknown>
): MediaFiles {
	const file = asRecord(movie.movieFile);
	if (!file) return emptyFiles('movie');

	const info = fileInfo(file);
	return {
		kind: 'movie',
		movie: info,
		seasons: [],
		episodeCount: 0,
		fileCount: 1,
		totalSize: info.size
	};
}

type SeasonBucket = {
	episodes: EpisodeFileInfo[];
	files: Map<string, number | null>;
};

/**
 * Normalize Sonarr episodes (requested with includeEpisodeFile=true) into
 * season groups. A single episode file can cover multiple episodes, so file
 * sizes are summed once per file, not once per episode row.
 */
export function normalizeSeriesFiles(episodes: UnknownRecord[]): MediaFiles {
	const bySeason = new Map<number, SeasonBucket>();
	const allFiles = new Map<string, number | null>();

	for (const episode of episodes) {
		const seasonNumber = asNumber(episode.seasonNumber);
		const episodeNumber = asNumber(episode.episodeNumber);
		if (seasonNumber == null || episodeNumber == null) continue;

		const file = asRecord(episode.episodeFile);
		if (episode.hasFile !== true && !file) continue;

		const rawFileId = asNumber(episode.episodeFileId) ?? asNumber(file?.id);
		const fileId = rawFileId != null && rawFileId > 0 ? rawFileId : null;
		const fileKey = fileId != null ? `file:${fileId}` : `episode:${seasonNumber}:${episodeNumber}`;
		const info = fileInfo(file);

		let bucket = bySeason.get(seasonNumber);
		if (!bucket) {
			bucket = { episodes: [], files: new Map() };
			bySeason.set(seasonNumber, bucket);
		}
		bucket.episodes.push({
			seasonNumber,
			episodeNumber,
			title: asString(episode.title),
			...info
		});
		if (!bucket.files.has(fileKey) || (bucket.files.get(fileKey) == null && info.size != null)) {
			bucket.files.set(fileKey, info.size);
		}
		if (!allFiles.has(fileKey) || (allFiles.get(fileKey) == null && info.size != null)) {
			allFiles.set(fileKey, info.size);
		}
	}

	const seasons: SeasonFiles[] = [...bySeason.entries()]
		.sort(([a], [b]) => a - b)
		.map(([seasonNumber, bucket]) => {
			bucket.episodes.sort(
				(a, b) => a.episodeNumber - b.episodeNumber || (a.title ?? '').localeCompare(b.title ?? '')
			);
			return {
				seasonNumber,
				episodes: bucket.episodes,
				fileCount: bucket.files.size,
				totalSize: sumSizes(bucket.files.values())
			};
		});

	return {
		kind: 'series',
		movie: null,
		seasons,
		episodeCount: seasons.reduce((count, season) => count + season.episodes.length, 0),
		fileCount: allFiles.size,
		totalSize: sumSizes(allFiles.values())
	};
}
