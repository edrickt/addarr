import { ArrClient } from './client.js';
import { posterUrl, type AddDefaults, type ArrSystemStatus, type PosterCard } from './types.js';

/** Sonarr API v3 adapter. Verified field names against Sonarr source:
 *  SeriesLookupController (GET /series/lookup?term=), SeriesController (POST /series),
 *  AddSeriesOptions (SearchForMissingEpisodes). Lookup results for series not yet
 *  in the library return unreliable monitored/season data (Sonarr issue #5761) —
 *  season monitoring is therefore always rebuilt from the admin preset here. */

type SonarrSeason = { seasonNumber: number; monitored: boolean };

type SonarrSeries = {
	id?: number;
	title: string;
	year?: number;
	overview?: string;
	tvdbId: number;
	titleSlug?: string;
	seriesType?: string;
	monitored?: boolean;
	qualityProfileId?: number;
	rootFolderPath?: string;
	tags?: number[];
	statistics?: {
		seasonCount?: number;
		episodeFileCount?: number;
		episodeCount?: number;
		totalEpisodeCount?: number;
		sizeOnDisk?: number;
	};
	images?: { coverType: string; url?: string; remoteUrl?: string }[];
	seasons?: SonarrSeason[];
};

/** Paged *arr responses (queue, history, blocklist) wrap records. */
type Paged<T> = { page: number; pageSize: number; totalRecords: number; records: T[] } | T[];

export class SonarrClient extends ArrClient {
	async lookup(term: string): Promise<SonarrSeries[]> {
		return this.raw<SonarrSeries[]>('GET', `/series/lookup?term=${encodeURIComponent(term)}`);
	}

	/** Full lookup resource for one series by TVDB id (server-side add flow). */
	async getByTvdbId(tvdbId: number): Promise<SonarrSeries | undefined> {
		const results = await this.raw<SonarrSeries[]>(
			'GET',
			`/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`
		);
		return results.find((s) => s.tvdbId === tvdbId);
	}

	// --- Operations console (curated, admin-gated at the route layer) ---

	private async paged<T>(path: string): Promise<T[]> {
		const res = await this.raw<Paged<T>>('GET', path);
		return Array.isArray(res) ? res : (res.records ?? []);
	}

	series(id: number): Promise<SonarrSeries> {
		return this.raw<SonarrSeries>('GET', `/series/${id}`);
	}

	editSeries(series: SonarrSeries): Promise<SonarrSeries> {
		return this.raw<SonarrSeries>('PUT', '/series', series);
	}

	deleteSeries(id: number, opts: { deleteFiles: boolean; addExclusion: boolean }): Promise<void> {
		return this.raw('DELETE', `/series/${id}?deleteFiles=${opts.deleteFiles}&addImportExclusion=${opts.addExclusion}`);
	}

	episodes(seriesId: number): Promise<Record<string, unknown>[]> {
		return this.raw('GET', `/episode?seriesId=${seriesId}`);
	}

	queue(): Promise<Record<string, unknown>[]> {
		return this.paged('/queue?pageSize=200');
	}

	removeQueueItem(id: number, removeFromClient: boolean): Promise<void> {
		return this.raw('DELETE', `/queue/${id}?removeFromClient=${removeFromClient}`);
	}

	history(page = 1, pageSize = 25): Promise<Record<string, unknown>[]> {
		return this.paged(`/history?page=${page}&pageSize=${pageSize}`);
	}

	blocklist(page = 1): Promise<Record<string, unknown>[]> {
		return this.paged(`/blocklist?page=${page}&pageSize=25`);
	}

	removeBlocklistItem(id: number): Promise<void> {
		return this.raw('DELETE', `/blocklist/${id}`);
	}

	importExclusions(): Promise<Record<string, unknown>[]> {
		return this.raw('GET', '/importexclusions');
	}

	removeImportExclusion(id: number): Promise<void> {
		return this.raw('DELETE', `/importexclusions/${id}`);
	}

	calendar(start: string, end: string): Promise<Record<string, unknown>[]> {
		return this.raw('GET', `/calendar?start=${start}&end=${end}`);
	}

	/** Curated commands only — the route layer never forwards free-form names. */
	command(
		name: 'SeriesSearch' | 'EpisodesSearch' | 'RefreshMonitoredDownloads',
		ids?: number[]
	): Promise<unknown> {
		if (name === 'EpisodesSearch') return this.raw('POST', '/command', { name, episodeIds: ids });
		return this.raw('POST', '/command', ids ? { name, seriesIds: ids } : { name });
	}

	async allSeries(): Promise<SonarrSeries[]> {
		return this.raw<SonarrSeries[]>('GET', '/series');
	}

	async qualityProfiles(): Promise<{ id: number; name: string }[]> {
		return this.raw('GET', '/qualityprofile');
	}

	async rootFolders(): Promise<{ id: number; path: string }[]> {
		return this.raw('GET', '/rootfolder');
	}

	async tags(): Promise<{ id: number; label: string }[]> {
		return this.raw('GET', '/tag');
	}

	async add(series: SonarrSeries, defaults: AddDefaults): Promise<SonarrSeries> {
		const seasons = buildSeasons(series, defaults.seasonMonitorPolicy ?? 'all');
		const resource = {
			title: series.title,
			year: series.year,
			overview: series.overview,
			tvdbId: series.tvdbId,
			titleSlug: series.titleSlug,
			images: series.images,
			seriesType: defaults.seriesType ?? series.seriesType ?? 'standard',
			seasons,
			qualityProfileId: defaults.qualityProfileId,
			rootFolderPath: defaults.rootFolderPath,
			monitored: defaults.monitored,
			tags: defaults.tags,
			addOptions: {
				searchForMissingEpisodes: defaults.searchOnAdd,
				monitor: 'none' // season-level monitoring handled via `seasons` above
			}
		};
		return this.raw<SonarrSeries>('POST', '/series', resource);
	}

	async toPosterCards(lookupResults: SonarrSeries[]): Promise<PosterCard[]> {
		const knownTvdbIds = new Set((await this.allSeries()).map((s) => s.tvdbId));
		return lookupResults
			.filter((s) => s.tvdbId)
			.map((s) => ({
				sourceId: s.tvdbId,
				title: s.title,
				year: s.year ?? null,
				overview: s.overview ?? '',
				posterUrl: posterUrl(s.images),
				inLibrary: knownTvdbIds.has(s.tvdbId),
				seriesType: s.seriesType
			}));
	}

	status(): Promise<ArrSystemStatus> {
		return this.systemStatus();
	}
}

function buildSeasons(series: SonarrSeries, policy: 'all' | 'none' | 'first' | 'latest'): SonarrSeason[] {
	const numbers = (series.seasons ?? [])
		.map((s) => s.seasonNumber)
		.filter((n) => Number.isInteger(n) && n > 0);
	if (numbers.length === 0) return [];

	let monitored: Set<number>;
	switch (policy) {
		case 'none':
			monitored = new Set();
			break;
		case 'first':
			monitored = new Set([Math.min(...numbers)]);
			break;
		case 'latest':
			monitored = new Set([Math.max(...numbers)]);
			break;
		case 'all':
		default:
			monitored = new Set(numbers);
	}
	return numbers.map((n) => ({ seasonNumber: n, monitored: monitored.has(n) }));
}
