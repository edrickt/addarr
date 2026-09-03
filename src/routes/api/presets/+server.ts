import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, getServiceByType } from '$lib/server/db';
import { getClient } from '$lib/server/arr-factory';
import {
	getPreset,
	listPresets,
	setDefaultPreset
} from '$lib/server/presets';
import { logActivity } from '$lib/server/auth';
import { ArrError } from '$lib/arr/types';
import type { ArrServiceType } from '$lib/arr/types';

type PresetInput = {
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

const SERIES_TYPES = ['standard', 'daily', 'anime'];
const SEASON_POLICIES = ['all', 'none', 'first', 'latest'];

async function options(service: ArrServiceType) {
	const client = getClient(service);
	const [qualityProfiles, rootFolders, tags] = await Promise.all([
		client.qualityProfiles(),
		client.rootFolders(),
		client.tags()
	]);
	return { qualityProfiles, rootFolders, tags };
}

function serviceFrom(url: URL): { service: ArrServiceType; serviceId: number } | { error: string; status: number } {
	const service = url.searchParams.get('service');
	if (service !== 'radarr' && service !== 'sonarr') {
		return { error: 'service must be "radarr" or "sonarr"', status: 400 };
	}
	const svc = getServiceByType(service);
	if (!svc) return { error: `${service} is not connected`, status: 503 };
	return { service, serviceId: svc.id };
}

function validate(input: PresetInput): string | null {
	if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) {
		return 'name is required';
	}
	if (input.qualityProfileId !== undefined && !Number.isInteger(input.qualityProfileId)) {
		return 'qualityProfileId must be an integer';
	}
	if (input.rootFolderPath !== undefined && typeof input.rootFolderPath !== 'string') {
		return 'rootFolderPath must be a string';
	}
	if (input.tags !== undefined && !Array.isArray(input.tags)) {
		return 'tags must be an array of tag ids';
	}
	if (
		input.seriesTypeDefault !== undefined &&
		input.seriesTypeDefault !== null &&
		!SERIES_TYPES.includes(input.seriesTypeDefault)
	) {
		return `seriesTypeDefault must be one of ${SERIES_TYPES.join(', ')}`;
	}
	if (
		input.seasonMonitorPolicy !== undefined &&
		input.seasonMonitorPolicy !== null &&
		!SEASON_POLICIES.includes(input.seasonMonitorPolicy)
	) {
		return `seasonMonitorPolicy must be one of ${SEASON_POLICIES.join(', ')}`;
	}
	return null;
}

/** GET /api/presets?service=radarr — presets + live arr-side dropdown options. */
export const GET: RequestHandler = async ({ url }) => {
	const parsed = serviceFrom(url);
	if ('error' in parsed) return json({ error: parsed.error }, { status: parsed.status });

	try {
		return json({
			presets: listPresets(parsed.serviceId),
			options: await options(parsed.service)
		});
	} catch (err) {
		const message = err instanceof ArrError ? err.message : 'Could not fetch options';
		return json({ error: message }, { status: 502 });
	}
};

/** POST /api/presets?service=radarr — create a preset. */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const parsed = serviceFrom(url);
	if ('error' in parsed) return json({ error: parsed.error }, { status: parsed.status });

	let body: PresetInput;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const invalid = validate(body);
	if (invalid) return json({ error: invalid }, { status: 400 });
	if (body.qualityProfileId === undefined || !body.rootFolderPath || !body.name) {
		return json({ error: 'name, qualityProfileId and rootFolderPath are required' }, { status: 400 });
	}

	db.prepare(
		`INSERT INTO presets (
			service_id, name, is_default, quality_profile_id, root_folder_path,
			monitored, tags_json, minimum_availability, search_on_add,
			series_type_default, season_monitor_policy
		) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		parsed.serviceId,
		body.name.trim(),
		body.qualityProfileId,
		body.rootFolderPath,
		body.monitored === false ? 0 : 1,
		JSON.stringify(body.tags ?? []),
		body.minimumAvailability ?? (parsed.service === 'radarr' ? 'released' : null),
		body.searchOnAdd === false ? 0 : 1,
		parsed.service === 'sonarr' ? body.seriesTypeDefault ?? 'standard' : null,
		parsed.service === 'sonarr' ? body.seasonMonitorPolicy ?? 'all' : null
	);

	const created = listPresets(parsed.serviceId).at(-1)!;
	// Every service must always have a default preset.
	if (body.isDefault || !listPresets(parsed.serviceId).some((p) => p.is_default === 1)) {
		setDefaultPreset(parsed.serviceId, created.id);
	}
	logActivity({
		userId: locals.user!.id,
		serviceId: parsed.serviceId,
		action: 'preset.create',
		title: body.name.trim()
	});
	return json({ ok: true, id: created.id });
};

/** PATCH /api/presets?service=radarr&id=N — update fields, or set default. */
export const PATCH: RequestHandler = async ({ request, url, locals }) => {
	const parsed = serviceFrom(url);
	if ('error' in parsed) return json({ error: parsed.error }, { status: parsed.status });

	const id = Number(url.searchParams.get('id'));
	const preset = getPreset(id);
	if (!preset || preset.service_id !== parsed.serviceId) {
		return json({ error: 'Preset not found' }, { status: 404 });
	}

	let body: PresetInput;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const invalid = validate(body);
	if (invalid) return json({ error: invalid }, { status: 400 });

	if (body.name !== undefined) db.prepare(`UPDATE presets SET name = ? WHERE id = ?`).run(body.name.trim(), id);
	if (body.qualityProfileId !== undefined)
		db.prepare(`UPDATE presets SET quality_profile_id = ? WHERE id = ?`).run(body.qualityProfileId, id);
	if (body.rootFolderPath !== undefined)
		db.prepare(`UPDATE presets SET root_folder_path = ? WHERE id = ?`).run(body.rootFolderPath, id);
	if (body.monitored !== undefined)
		db.prepare(`UPDATE presets SET monitored = ? WHERE id = ?`).run(body.monitored ? 1 : 0, id);
	if (body.tags !== undefined)
		db.prepare(`UPDATE presets SET tags_json = ? WHERE id = ?`).run(JSON.stringify(body.tags), id);
	if (body.minimumAvailability !== undefined)
		db.prepare(`UPDATE presets SET minimum_availability = ? WHERE id = ?`).run(body.minimumAvailability, id);
	if (body.searchOnAdd !== undefined)
		db.prepare(`UPDATE presets SET search_on_add = ? WHERE id = ?`).run(body.searchOnAdd ? 1 : 0, id);
	if (body.seriesTypeDefault !== undefined && parsed.service === 'sonarr')
		db.prepare(`UPDATE presets SET series_type_default = ? WHERE id = ?`).run(body.seriesTypeDefault ?? 'standard', id);
	if (body.seasonMonitorPolicy !== undefined && parsed.service === 'sonarr')
		db.prepare(`UPDATE presets SET season_monitor_policy = ? WHERE id = ?`).run(body.seasonMonitorPolicy ?? 'all', id);

	if (body.isDefault) setDefaultPreset(parsed.serviceId, id);

	logActivity({
		userId: locals.user!.id,
		serviceId: parsed.serviceId,
		action: 'preset.update',
		title: body.name?.trim() ?? preset.name
	});
	return json({ ok: true });
};

/** DELETE /api/presets?service=radarr&id=N — never leaves a service without a default. */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const parsed = serviceFrom(url);
	if ('error' in parsed) return json({ error: parsed.error }, { status: parsed.status });

	const id = Number(url.searchParams.get('id'));
	const preset = getPreset(id);
	if (!preset || preset.service_id !== parsed.serviceId) {
		return json({ error: 'Preset not found' }, { status: 404 });
	}

	const all = listPresets(parsed.serviceId);
	if (all.length === 1) {
		return json({ error: 'Cannot delete the only preset for this service' }, { status: 400 });
	}

	db.prepare(`DELETE FROM presets WHERE id = ?`).run(id);
	if (preset.is_default === 1) {
		const remaining = listPresets(parsed.serviceId);
		if (remaining.length > 0) setDefaultPreset(parsed.serviceId, remaining[0].id);
	}
	logActivity({
		userId: locals.user!.id,
		serviceId: parsed.serviceId,
		action: 'preset.delete',
		title: preset.name
	});
	return json({ ok: true });
};
