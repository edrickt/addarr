import { ArrClient } from './client.js';
import { posterUrl, type AddDefaults, type ArrSystemStatus, type PosterCard } from './types.js';

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
		const knownTmdbIds = new Set((await this.allMovies()).map((m) => m.tmdbId));
		return lookupResults
			.filter((m) => m.tmdbId)
			.map((m) => ({
				sourceId: m.tmdbId,
				title: m.title,
				year: m.year ?? null,
				overview: m.overview ?? '',
				posterUrl: posterUrl(m.images),
				inLibrary: knownTmdbIds.has(m.tmdbId)
			}));
	}

	status(): Promise<ArrSystemStatus> {
		return this.systemStatus();
	}
}
