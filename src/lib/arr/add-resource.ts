/**
 * Pure builder for the Sonarr POST /series resource — kept separate from the
 * client so the exact payload is unit-testable without HTTP.
 *
 * Lookup results for series not yet in the library return unreliable
 * monitored/season data (Sonarr issue #5761) — season monitoring is therefore
 * always rebuilt from the admin preset here.
 *
 * The payload deliberately omits `addOptions.monitor`: Sonarr 4 treats that
 * option as authoritative — `none` forces the series unmonitored and then
 * unmonitors every season asynchronously, discarding both `monitored` and the
 * explicit `seasons` flags (verified against Sonarr 4.0.20; regression test in
 * add-resource.test.ts).
 */

import type { AddDefaults } from './types.ts';

export type SonarrSeason = { seasonNumber: number; monitored: boolean };

export type SonarrSeries = {
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

export type AddSeriesResource = {
	title: string;
	year?: number;
	overview?: string;
	tvdbId: number;
	titleSlug?: string;
	images?: { coverType: string; url?: string; remoteUrl?: string }[];
	seriesType: string;
	seasons: SonarrSeason[];
	qualityProfileId: number;
	rootFolderPath: string;
	monitored: boolean;
	tags: number[];
	addOptions: {
		searchForMissingEpisodes: boolean;
	};
};

export function buildAddResource(series: SonarrSeries, defaults: AddDefaults): AddSeriesResource {
	const seasons = buildSeasons(series, defaults.seasonMonitorPolicy ?? 'all');
	return {
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
			searchForMissingEpisodes: defaults.searchOnAdd
			// No `monitor` key — deliberately: Sonarr treats it as authoritative and
			// `none` would unmonitor the series and every season, ignoring the fields above.
		}
	};
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
