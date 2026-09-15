import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting } from '$lib/server/db';
import { logActivity } from '$lib/server/auth';

type LanControl = {
	boundLan: boolean;
	forced: boolean;
	broadcasting: boolean;
	host?: string;
	port?: number;
	getAddresses?: () => string[];
	startBroadcast: () => Promise<boolean>;
	stopBroadcast: () => Promise<boolean>;
};

function control(): LanControl | null {
	return (globalThis as { __addarr?: { lan?: LanControl } }).__addarr?.lan ?? null;
}

const KEY = 'lan_enabled';

/** GET /api/settings/lan — current LAN sharing state. */
export const GET: RequestHandler = async () => {
	const c = control();
	return json({
		// The persisted preference (source of truth for the toggle).
		enabled: getSetting(KEY) === '1',
		// Live state of the running process.
		broadcasting: c?.broadcasting ?? false,
		boundLan: c?.boundLan ?? false,
		// Effective bind + live interface candidates (LAN first, Tailscale last).
		host: c?.host ?? null,
		port: c?.port ?? null,
		addresses: c?.getAddresses?.() ?? [],
		// --lan / ADDARR_LAN=1 was passed: the CLI wins until restart.
		forced: c?.forced ?? false,
		// No launcher control surface (e.g. `node build` run directly).
		managedExternally: c === null
	});
};

/** POST /api/settings/lan { enabled: boolean } — persist and apply live. */
export const POST: RequestHandler = async ({ request, locals }) => {
	let body: { enabled?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.enabled !== 'boolean') {
		return json({ error: 'enabled must be a boolean' }, { status: 400 });
	}

	const enabled = body.enabled;
	setSetting(KEY, enabled ? '1' : '0');
	logActivity({
		userId: locals.user!.id,
		serviceId: null,
		action: enabled ? 'settings.lan.enable' : 'settings.lan.disable'
	});

	const c = control();
	if (!c) {
		// Running under `node build` or another external launcher.
		return json({
			ok: true,
			enabled,
			broadcasting: false,
			restartRequired: true,
			message: 'Saved. Restart Addarr to apply.'
		});
	}

	if (c.boundLan) {
		// Already reachable on the LAN: broadcast can change immediately.
		c.broadcasting = enabled ? await c.startBroadcast() : await c.stopBroadcast();
		return json({ ok: true, enabled, broadcasting: c.broadcasting, restartRequired: false });
	}

	// Bound to localhost: the setting is saved, but the bind address only
	// changes on restart.
	return json({
		ok: true,
		enabled,
		broadcasting: false,
		restartRequired: enabled,
		message: enabled ? 'Saved. Restart Addarr to make it reachable on the LAN.' : 'Saved.'
	});
};
