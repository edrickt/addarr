/**
 * Preset input validation shared by the preset API and the default-preset
 * repair logic. Pure functions only so the rules are unit-testable without a
 * database or an arr instance.
 *
 * Two layers:
 *  1. shape validation — types, ranges, and enums that need no live arr data;
 *  2. targeting validation — the ids/paths must exist on the connected
 *     instance, otherwise a saved preset silently breaks the member Add
 *     button (AUD-06).
 */

export type ArrService = 'radarr' | 'sonarr';

export type PresetInput = {
	name?: string;
	qualityProfileId?: number;
	rootFolderPath?: string;
	monitored?: boolean;
	tags?: number[];
	minimumAvailability?: string | null;
	searchOnAdd?: boolean;
	seriesTypeDefault?: string | null;
	seasonMonitorPolicy?: string | null;
	isDefault?: boolean;
};

export type PresetOptions = {
	qualityProfiles: { id: number }[];
	rootFolders: { path: string }[];
	tags: { id: number }[];
};

export const SERIES_TYPES = ['standard', 'daily', 'anime'] as const;
export const SEASON_POLICIES = ['all', 'none', 'first', 'latest'] as const;
export const MINIMUM_AVAILABILITIES = ['announced', 'inCinemas', 'released'] as const;

/**
 * Fields whose values are *arr-side ids/paths and must be checked live.
 * An empty `tags: []` needs no live lookup — the UI always sends the array, so
 * treating it as live-dependent made every preset edit 502 during an arr
 * outage (AUD-06 follow-up).
 */
export function presetInputNeedsLiveOptions(input: PresetInput): boolean {
	return (
		input.qualityProfileId !== undefined ||
		input.rootFolderPath !== undefined ||
		(input.tags !== undefined && input.tags.length > 0)
	);
}

/**
 * Validate a preset create/update payload. Shape errors are checked first; when
 * live `options` are supplied (the API fetches them from the connected
 * instance), the targeting fields must resolve there too.
 */
export function validatePresetInput(
	input: PresetInput,
	service: ArrService,
	options?: PresetOptions
): string | null {
	if (input.name !== undefined) {
		if (typeof input.name !== 'string' || !input.name.trim()) return 'name is required';
	}
	if (
		input.qualityProfileId !== undefined &&
		(!Number.isInteger(input.qualityProfileId) || input.qualityProfileId <= 0)
	) {
		return 'qualityProfileId must be a positive integer';
	}
	if (
		input.rootFolderPath !== undefined &&
		(typeof input.rootFolderPath !== 'string' || !input.rootFolderPath.trim())
	) {
		return 'rootFolderPath must be a non-empty string';
	}
	if (
		input.tags !== undefined &&
		(!Array.isArray(input.tags) || !input.tags.every((n) => Number.isInteger(n) && n > 0))
	) {
		return 'tags must be an array of positive tag ids';
	}
	if (input.monitored !== undefined && typeof input.monitored !== 'boolean') {
		return 'monitored must be a boolean';
	}
	if (input.searchOnAdd !== undefined && typeof input.searchOnAdd !== 'boolean') {
		return 'searchOnAdd must be a boolean';
	}
	if (input.isDefault !== undefined && typeof input.isDefault !== 'boolean') {
		return 'isDefault must be a boolean';
	}
	if (
		input.minimumAvailability !== undefined &&
		input.minimumAvailability !== null &&
		typeof input.minimumAvailability !== 'string'
	) {
		return 'minimumAvailability must be a string';
	}
	if (
		service === 'radarr' &&
		typeof input.minimumAvailability === 'string' &&
		!(MINIMUM_AVAILABILITIES as readonly string[]).includes(input.minimumAvailability)
	) {
		return `minimumAvailability must be one of ${MINIMUM_AVAILABILITIES.join(', ')}`;
	}
	if (
		input.seriesTypeDefault !== undefined &&
		input.seriesTypeDefault !== null &&
		!(SERIES_TYPES as readonly string[]).includes(input.seriesTypeDefault)
	) {
		return `seriesTypeDefault must be one of ${SERIES_TYPES.join(', ')}`;
	}
	if (
		input.seasonMonitorPolicy !== undefined &&
		input.seasonMonitorPolicy !== null &&
		!(SEASON_POLICIES as readonly string[]).includes(input.seasonMonitorPolicy)
	) {
		return `seasonMonitorPolicy must be one of ${SEASON_POLICIES.join(', ')}`;
	}

	if (options) {
		if (
			input.qualityProfileId !== undefined &&
			!options.qualityProfiles.some((p) => p.id === input.qualityProfileId)
		) {
			return 'qualityProfileId does not exist on the connected instance — reload Presets and pick a current profile';
		}
		if (
			input.rootFolderPath !== undefined &&
			!options.rootFolders.some((f) => f.path === input.rootFolderPath)
		) {
			return 'rootFolderPath does not exist on the connected instance — reload Presets and pick a current folder';
		}
		if (input.tags !== undefined) {
			const known = new Set(options.tags.map((t) => t.id));
			const unknown = input.tags.find((id) => !known.has(id));
			if (unknown !== undefined) {
				return `tag id ${unknown} does not exist on the connected instance — reload Presets and pick a current tag`;
			}
		}
	}

	return null;
}

export type PresetTargeting = {
	quality_profile_id: number;
	root_folder_path: string;
};

export type PresetRepair = {
	qualityProfileId: number;
	rootFolderPath: string;
};

/**
 * Compute the minimal repair for a stored preset whose targeting no longer
 * resolves on the connected instance: keep whichever of the quality profile /
 * root folder is still valid and only replace the stale one(s), so reconnecting
 * a service never overwrites a still-valid admin choice (AUD-07 follow-up).
 * Returns null when nothing needs repairing. `profiles`/`folders` must be
 * non-empty (the caller checks before repairing).
 */
export function planPresetRepair(
	preset: PresetTargeting | null | undefined,
	profiles: { id: number }[],
	folders: { path: string }[]
): PresetRepair | null {
	if (!preset) return null;
	const profileOk =
		Number.isInteger(preset.quality_profile_id) &&
		preset.quality_profile_id > 0 &&
		profiles.some((p) => p.id === preset.quality_profile_id);
	const folderOk =
		typeof preset.root_folder_path === 'string' &&
		preset.root_folder_path.length > 0 &&
		folders.some((f) => f.path === preset.root_folder_path);
	if (profileOk && folderOk) return null;
	return {
		qualityProfileId: profileOk ? preset.quality_profile_id : profiles[0]!.id,
		rootFolderPath: folderOk ? preset.root_folder_path : folders[0]!.path
	};
}

/**
 * True when a stored default preset still points at a quality profile and root
 * folder that exist on the connected instance. Reconnecting a service must
 * repair anything else, or every member Add fails upstream (AUD-07).
 */
export function presetIsUsable(
	preset: PresetTargeting | null | undefined,
	profiles: { id: number }[],
	folders: { path: string }[]
): boolean {
	if (!preset) return false;
	if (!Number.isInteger(preset.quality_profile_id) || preset.quality_profile_id <= 0) return false;
	if (typeof preset.root_folder_path !== 'string' || preset.root_folder_path.length === 0) return false;
	return (
		profiles.some((p) => p.id === preset.quality_profile_id) &&
		folders.some((f) => f.path === preset.root_folder_path)
	);
}
