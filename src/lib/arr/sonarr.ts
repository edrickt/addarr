import { ArrClient } from './client.js';
import { buildAddResource, type SonarrSeries } from './add-resource.js';
import { posterUrl, type AddDefaults, type ArrSystemStatus, type PosterCard } from './types.js';
import { seriesStatus } from './status.js';

/** Sonarr API v3 adapter. Verified field names against Sonarr source:
 *  SeriesLookupController (GET /series/lookup?term=), SeriesController (POST /series),
 *  AddSeriesOptions (SearchForMissingEpisodes). The POST /series resource is built
 *  by `buildAddResource` — see add-resource.ts for the payload and its constraints. */

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
		return this.raw<SonarrSeries>('POST', '/series', buildAddResource(series, defaults));
	}

	async toPosterCards(lookupResults: SonarrSeries[]): Promise<PosterCard[]> {
		const [library, queue] = await Promise.all([this.allSeries(), this.queue()]);
		const byTvdb = new Map(library.map((s) => [s.tvdbId, s]));
		return lookupResults
			.filter((s) => s.tvdbId)
			.map((s) => {
				const known = byTvdb.get(s.tvdbId);
				const rows = known ? queue.filter((q) => q.seriesId === known.id) : [];
				return {
					sourceId: s.tvdbId,
					title: s.title,
					year: s.year ?? null,
					overview: s.overview ?? '',
					posterUrl: posterUrl(s.images),
					inLibrary: !!known,
					id: known?.id,
					status: known ? seriesStatus(known, rows) : undefined,
					seriesType: s.seriesType
				};
			});
	}

	status(): Promise<ArrSystemStatus> {
		return this.systemStatus();
	}
}

