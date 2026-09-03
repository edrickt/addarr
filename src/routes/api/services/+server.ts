import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, upsertService } from '$lib/server/db';
import { RadarrClient } from '$lib/arr/radarr';
import { SonarrClient } from '$lib/arr/sonarr';
import { ArrError } from '$lib/arr/types';
import type { ArrServiceType } from '$lib/arr/types';
import { ensureDefaultPreset } from '$lib/server/presets';

/** GET /api/services — configured services (API keys masked). */
export const GET: RequestHandler = async () => {
	const rows = db.prepare(`SELECT id, type, name, base_url, app_version, enabled FROM services`).all();
	return json({ services: rows });
};

/** POST /api/services — save (upsert) a connection. */
export const POST: RequestHandler = async ({ request }) => {
	let body: { type?: string; name?: string; baseUrl?: string; apiKey?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const type = body.type as ArrServiceType;
	if (type !== 'radarr' && type !== 'sonarr') {
		return json({ error: 'type must be "radarr" or "sonarr"' }, { status: 400 });
	}
	if (!body.name?.trim() || !body.baseUrl?.trim() || !body.apiKey?.trim()) {
		return json({ error: 'name, baseUrl and apiKey are required' }, { status: 400 });
	}

	let normalizedUrl: URL;
	try {
		normalizedUrl = new URL(body.baseUrl.trim());
	} catch {
		return json({ error: 'baseUrl must be a valid URL, e.g. http://192.168.1.10:7878' }, { status: 400 });
	}

	// Probe before saving — never store a connection we cannot reach.
	const client =
		type === 'radarr'
			? new RadarrClient(normalizedUrl.origin, body.apiKey.trim())
			: new SonarrClient(normalizedUrl.origin, body.apiKey.trim());

	try {
		const status = await client.systemStatus();
		upsertService({
			type,
			name: body.name.trim(),
			baseUrl: normalizedUrl.origin,
			apiKey: body.apiKey.trim(),
			appVersion: status.version
		});
		const preset = await ensureDefaultPreset(type);
		return json({
			ok: true,
			appVersion: status.version,
			appName: status.appName,
			defaultPreset: preset.created ? 'created' : preset.note ?? 'exists'
		});
	} catch (err) {
		if (err instanceof ArrError) {
			return json(
				{ error: `${err.message}${err.detail ? ` — ${JSON.stringify(err.detail)}` : ''}` },
				{ status: err.status === 502 ? 502 : 400 }
			);
		}
		return json({ error: 'Unexpected error testing connection' }, { status: 500 });
	}
};
