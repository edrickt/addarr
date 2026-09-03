/** Shared types for Radarr/Sonarr API v3 clients. */

export type ArrServiceType = 'radarr' | 'sonarr';

export type ArrSystemStatus = {
	appName: string;
	version: string;
	apiVersion: string;
};

/** Trimmed lookup result safe to send to browsers. */
export type PosterCard = {
	/** tmdbId (Radarr) or tvdbId (Sonarr) */
	sourceId: number;
	title: string;
	year: number | null;
	overview: string;
	posterUrl: string | null;
	inLibrary: boolean;
	seriesType?: string;
	/** *arr item id — present for in-library items (used for status polling). */
	id?: number;
	/** Normalized acquisition state for in-library items. */
	status?: import('./status.js').ArrItemStatus;
};

/** Admin-chosen defaults applied on add. Subset of the presets table. */
export type AddDefaults = {
	qualityProfileId: number;
	rootFolderPath: string;
	monitored: boolean;
	tags: number[];
	minimumAvailability?: string;
	searchOnAdd: boolean;
	seriesType?: string;
	seasonMonitorPolicy?: 'all' | 'none' | 'first' | 'latest';
};

export class ArrError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly detail?: unknown
	) {
		super(message);
		this.name = 'ArrError';
	}
}

export function posterUrl(images: { coverType: string; url?: string; remoteUrl?: string }[] | undefined): string | null {
	const poster = images?.find((i) => i.coverType === 'poster');
	return poster?.remoteUrl ?? poster?.url ?? null;
}
