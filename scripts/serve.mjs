// Server launcher for the adapter-node build.
//
// LAN sharing is an in-app setting: Settings → Network → "Share on LAN".
// The preference is stored in the SQLite DB (`settings.lan_enabled`) and read
// here at startup to pick the bind address. The mDNS broadcast can also be
// toggled live from the app via the controller exposed on globalThis.
//
// CLI/env overrides (force LAN regardless of the DB setting):
//   --lan flag or ADDARR_LAN=1
//   HOST=<addr> binds a specific interface
import { createServer } from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { handler } from '../build/handler.js';

const forcedLan = process.argv.includes('--lan') || process.env.ADDARR_LAN === '1';
const port = Number(process.env.PORT) || 4545;

// Same resolution as src/lib/server/db.ts.
const dbPath = process.env.ADDARR_DB ?? join(process.cwd(), 'data', 'addarr.db');

function readLanSetting() {
	try {
		const db = new DatabaseSync(dbPath);
		db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
		const row = db.prepare(`SELECT value FROM settings WHERE key = 'lan_enabled'`).get();
		db.close();
		return row?.value === '1';
	} catch {
		return false; // DB not readable yet (first run) — default off
	}
}

const lanSetting = readLanSetting();
const lanEnabled = forcedLan || lanSetting;
const host = process.env.HOST || (lanEnabled ? '0.0.0.0' : '127.0.0.1');

function lanAddress() {
	for (const ifaces of Object.values(os.networkInterfaces())) {
		for (const iface of ifaces ?? []) {
			if (iface.family === 'IPv4' && !iface.internal) return iface.address;
		}
	}
	return null;
}

// --- mDNS broadcast (live-toggleable from the app) -----------------------

let bonjour = null;
let published = false;

async function startBroadcast() {
	if (published) return;
	try {
		const { Bonjour } = await import('bonjour-service');
		bonjour ??= new Bonjour();
		bonjour.publish({ name: 'Addarr', type: 'http', port, host: os.hostname() });
		published = true;
		console.log('Broadcasting on the LAN via mDNS (Bonjour) as "Addarr".');
	} catch (err) {
		console.warn(`mDNS broadcast unavailable (${err?.message ?? err}) — continuing without discovery.`);
	}
}

async function stopBroadcast() {
	if (!bonjour || !published) return;
	await new Promise((resolve) => bonjour.unpublishAll(resolve));
	published = false;
	console.log('mDNS broadcast stopped.');
}

// --- runtime control surface consumed by /api/settings/lan ----------------

globalThis.__addarr = {
	lan: {
		// true when the process is actually reachable beyond localhost
		boundLan: host !== '127.0.0.1' && host !== 'localhost',
		// --lan / ADDARR_LAN=1 overrides the in-app setting until restart
		forced: forcedLan,
		broadcasting: false,
		startBroadcast: async () => {
			await startBroadcast();
			return published;
		},
		stopBroadcast: async () => {
			await stopBroadcast();
			return published;
		}
	}
};

const server = createServer(handler);

// Graceful self-restart: spawn a replacement process (same command line),
// let it take over the port, then exit. The replacement re-reads the DB
// settings, so bind address / LAN broadcast changes apply.
async function restart() {
	console.log('Restarting Addarr…');
	try {
		await stopBroadcast();
	} catch {
		/* best effort */
	}
	const child = spawn(process.execPath, process.argv.slice(1), {
		env: { ...process.env, ADDARR_TAKEOVER_PORT: String(port) },
		stdio: 'inherit',
		detached: true
	});
	child.unref();
	server.close(() => process.exit(0));
	// Keep-alive connections can hold the port; force-exit as a fallback.
	setTimeout(() => process.exit(0), 3000).unref();
}

// When taking over from a restarting instance, wait for the port to free up.
function waitPortFree(p, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve) => {
		const probe = () => {
			const tester = createServer();
			tester.once('error', () => {
				if (Date.now() > deadline) {
					console.error('Port never freed — giving up.');
					process.exit(1);
				}
				setTimeout(probe, 200);
			});
			tester.once('listening', () => tester.close(() => resolve()));
			tester.listen(p, '127.0.0.1');
		};
		probe();
	});
}

async function main() {
	if (process.env.ADDARR_TAKEOVER_PORT) await waitPortFree(port);
	await new Promise((resolve) => server.listen(port, host, resolve));
	console.log(`Addarr listening on http://localhost:${port}`);
	if (globalThis.__addarr.lan.boundLan) {
		const ip = lanAddress();
		if (ip) console.log(`LAN access:  http://${ip}:${port}`);
		else console.log('LAN access enabled, but no LAN IPv4 address found yet.');
		if (lanEnabled) {
			startBroadcast().then(() => (globalThis.__addarr.lan.broadcasting = published));
		}
	} else {
		console.log('Localhost only. Enable "Share on LAN" in Settings → Network (or --lan).');
	}

	const bye = () => {
		if (bonjour) bonjour.unpublishAll(() => process.exit(0));
		else process.exit(0);
	};
	process.on('SIGINT', bye);
	process.on('SIGTERM', bye);
}

// --- runtime control surface consumed by /api/restart ---------------------

globalThis.__addarr.restart = restart;

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
