import { db, getServiceByType, type ServiceRow } from './db';
import { getClient } from './arr-factory';
import type { AddDefaults, ArrServiceType } from '$lib/arr/types';

/**
 * Presets decide what "Add" means. M2 only needs the per-service default
 * preset; M3 adds CRUD around this. A default preset is auto-created from
 * the instance's first quality profile / root folder when a service is saved.
 */

export type PresetRow = {
	id: number;
	service_id: number;
	name: string;
	is_default: number;
	quality_profile_id: number;
	root_folder_path: string;
	monitored: number;
	tags_json: string;
	minimum_availability: string | null;
	search_on_add: number;
	series_type_default: string | null;
	season_monitor_policy: 'all' | 'none' | 'first' | 'latest' | null;
};

export function getDefaultPresetRow(serviceId: number): PresetRow | undefined {
	return db
		.prepare(`SELECT * FROM presets WHERE service_id = ? AND is_default = 1`)
		.get(serviceId) as PresetRow | undefined;
}

export function listPresets(serviceId: number): PresetRow[] {
	return db
		.prepare(`SELECT * FROM presets WHERE service_id = ? ORDER BY is_default DESC, name`)
		.all(serviceId) as PresetRow[];
}

export function getPreset(id: number): PresetRow | undefined {
	return db.prepare(`SELECT * FROM presets WHERE id = ?`).get(id) as PresetRow | undefined;
}

export function setDefaultPreset(serviceId: number, presetId: number): void {
	db.exec('BEGIN');
	try {
		db.prepare(`UPDATE presets SET is_default = 0 WHERE service_id = ?`).run(serviceId);
		db.prepare(`UPDATE presets SET is_default = 1 WHERE id = ?`).run(presetId);
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

export function presetToAddDefaults(row: PresetRow): AddDefaults {
	return {
		qualityProfileId: row.quality_profile_id,
		rootFolderPath: row.root_folder_path,
		monitored: row.monitored === 1,
		tags: JSON.parse(row.tags_json) as number[],
		minimumAvailability: row.minimum_availability ?? undefined,
		searchOnAdd: row.search_on_add === 1,
		seriesType: row.series_type_default ?? undefined,
		seasonMonitorPolicy: row.season_monitor_policy ?? 'all'
	};
}

export function createDefaultPreset(svc: ServiceRow): PresetRow {
	db.prepare(
		`INSERT INTO presets (
			service_id, name, is_default, quality_profile_id, root_folder_path,
			monitored, tags_json, minimum_availability, search_on_add,
			series_type_default, season_monitor_policy
		) VALUES (?, 'Default', 1, ?, ?, 1, '[]', ?, 1, ?, ?)`
	).run(
		svc.id,
		0,
		'',
		svc.type === 'radarr' ? 'released' : null,
		svc.type === 'sonarr' ? 'standard' : null,
		svc.type === 'sonarr' ? 'all' : null
	);
	return getDefaultPresetRow(svc.id)!;
}

/**
 * After a service connects, make sure a usable default preset exists by
 * pulling its first quality profile and root folder. Non-fatal: the admin
 * just can't add until a preset with valid arr-side values exists.
 */
export async function ensureDefaultPreset(
	type: ArrServiceType
): Promise<{ created: boolean; note?: string }> {
	const svc = getServiceByType(type);
	if (!svc) return { created: false, note: 'service not configured' };

	const existing = getDefaultPresetRow(svc.id);
	if (existing && existing.quality_profile_id > 0) return { created: false };

	try {
		const client = getClient(type);
		const [profiles, folders] = await Promise.all([client.qualityProfiles(), client.rootFolders()]);
		if (profiles.length === 0 || folders.length === 0) {
			return { created: false, note: `${type} has no quality profile or root folder yet` };
		}
		db.prepare(
			`INSERT INTO presets (
				service_id, name, is_default, quality_profile_id, root_folder_path,
				monitored, tags_json, minimum_availability, search_on_add,
				series_type_default, season_monitor_policy
			) VALUES (?, 'Default', 1, ?, ?, 1, '[]', ?, 1, ?, ?)`
		).run(
			svc.id,
			profiles[0].id,
			folders[0].path,
			type === 'radarr' ? 'released' : null,
			type === 'sonarr' ? 'standard' : null,
			type === 'sonarr' ? 'all' : null
		);
		return { created: true };
	} catch (err) {
		return {
			created: false,
			note: err instanceof Error ? err.message : 'could not create default preset'
		};
	}
}
