import { ArrClient } from './client.js';
import { posterUrl, type AddDefaults, type ArrSystemStatus, type PosterCard } from './types.js';
import { movieStatus } from './status.js';

/** Radarr API v3 adapter. Verified field names against Radarr source:
 *  MovieLookupController (GET /movie/lookup?term=), MovieController (POST /movie),
 *  AddMovieOptions (SearchForMovie). */

type RadarrMovie = {
	id?: number;
	title: string;
	year?: number;
	overview?: string;
	tmdbId: number;
	imdbId?: string;
	titleSlug?: string;
	monitored?: boolean;
	qualityProfileId?: number;
	rootFolderPath?: string;
	tags?: number[];
	isAvailable?: boolean;
	hasFile?: boolean;
	movieFile?: unknown;
	images?: { coverType: string; url?: string; remoteUrl?: string }[];
};

/** Paged *arr responses (queue, history, blocklist) wrap records. */
type Paged<T> = { page: number; pageSize: number; totalRecords: number; records: T[] } | T[];

export class RadarrClient extends ArrClient {
	async lookup(term: string): Promise<RadarrMovie[]> {
		return this.raw<RadarrMovie[]>('GET', `/movie/lookup?term=${encodeURIComponent(term)}`);
	}

	/** Full lookup resource for one movie by TMDB id (server-side add flow). */
	async getByTmdbId(tmdbId: number): Promise<RadarrMovie | undefined> {
		return this.raw<RadarrMovie>('GET', `/movie/lookup/tmdb?tmdbId=${tmdbId}`);
	}

	// --- Operations console (curated, admin-gated at the route layer) ---

	private async paged<T>(path: string): Promise<T[]> {
		const res = await this.raw<Paged<T>>('GET', path);
		return Array.isArray(res) ? res : (res.records ?? []);
	}

	movie(id: number): Promise<RadarrMovie> {
		return this.raw<RadarrMovie>('GET', `/movie/${id}`);
	}

	editMovie(movie: RadarrMovie): Promise<RadarrMovie> {
		return this.raw<RadarrMovie>('PUT', '/movie', movie);
	}

	deleteMovie(id: number, opts: { deleteFiles: boolean; addExclusion: boolean }): Promise<void> {
		return this.raw('DELETE', `/movie/${id}?deleteFiles=${opts.deleteFiles}&addImportExclusion=${opts.addExclusion}`);
	}

	async queue(options: { includeMovie?: boolean } = {}): Promise<Record<string, unknown>[]> {
		const params = new URLSearchParams({ pageSize: '200' });
		if (options.includeMovie) params.set('includeMovie', 'true');
		const all: Record<string, unknown>[] = [];
		for (let page = 1; page <= 100; page++) {
			params.set('page', String(page));
			const res = await this.raw<Paged<Record<string, unknown>>>('GET', `/queue?${params.toString()}`);
			const records = Array.isArray(res) ? res : (res.records ?? []);
			all.push(...records);
			const total = Array.isArray(res) ? records.length : Number(res.totalRecords);
			if (records.length === 0 || !Number.isFinite(total) || all.length >= total) break;
		}
		return all;
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
	command(name: 'MoviesSearch' | 'RefreshMonitoredDownloads', movieIds?: number[]): Promise<unknown> {
		return this.raw('POST', '/command', movieIds ? { name, movieIds } : { name });
	}

	async allMovies(): Promise<RadarrMovie[]> {
		return this.raw<RadarrMovie[]>('GET', '/movie');
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

	async add(movie: RadarrMovie, defaults: AddDefaults): Promise<RadarrMovie> {
		const resource = {
			title: movie.title,
			year: movie.year,
			overview: movie.overview,
			tmdbId: movie.tmdbId,
			imdbId: movie.imdbId,
			titleSlug: movie.titleSlug,
			images: movie.images,
			qualityProfileId: defaults.qualityProfileId,
			rootFolderPath: defaults.rootFolderPath,
			monitored: defaults.monitored,
			minimumAvailability: defaults.minimumAvailability ?? 'released',
			tags: defaults.tags,
			addOptions: { searchForMovie: defaults.searchOnAdd }
		};
		return this.raw<RadarrMovie>('POST', '/movie', resource);
	}

	async toPosterCards(lookupResults: RadarrMovie[]): Promise<PosterCard[]> {
		const [library, queue] = await Promise.all([this.allMovies(), this.queue()]);
		const byTmdb = new Map(library.map((m) => [m.tmdbId, m]));
		return lookupResults
			.filter((m) => m.tmdbId)
			.map((m) => {
				const known = byTmdb.get(m.tmdbId);
				const rows = known ? queue.filter((q) => q.movieId === known.id) : [];
				return {
					sourceId: m.tmdbId,
					title: m.title,
					year: m.year ?? null,
					overview: m.overview ?? '',
					posterUrl: posterUrl(m.images),
					inLibrary: !!known,
					id: known?.id,
					status: known ? movieStatus(known, rows) : undefined
				};
			});
	}

	status(): Promise<ArrSystemStatus> {
		return this.systemStatus();
	}
}
