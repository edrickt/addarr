// Server launcher for the adapter-node build.
//
// LAN sharing is an in-app setting: Settings → Network → "Share on LAN".
// The preference is stored in the SQLite DB (`settings.lan_enabled`) and read
// here at startup to pick the bind address. The mDNS broadcast can also be
// toggled live from the app via the controller exposed on globalThis.
//
// CLI/env overrides (force LAN regardless of the DB setting):
//   --lan flag or ADDARR_LAN=1
//   HOST=<addr> binds a specific interface (e.g. HOST=192.168.1.10 keeps
//   Addarr on the LAN only, off Tailscale/VPN interfaces)
import { createServer } from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from '../build/handler.js';

// Set by scripts/service.mjs when a supervisor owns this process:
// "launchd" (macOS), "systemd" (Linux), unset when standalone.
const supervisor = process.env.ADDARR_MANAGED ?? '';

// Launched hidden from the Windows Startup folder there is no console, so
// mirror output into data/addarr.log — `npm run logs` reads it on any platform.
// The hidden window can still report itself as a TTY, so ADDARR_LOG (set by the
// launcher) is the reliable signal.
const HERE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.ADDARR_DATA_DIR ?? join(HERE_ROOT, 'data');

if (process.platform === 'win32' && (process.env.ADDARR_LOG === '1' || !process.stdout.isTTY)) {
	const logFile = join(DATA_DIR, 'addarr.log');
	try {
		mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
		for (const level of ['log', 'warn', 'error']) {
			const original = console[level].bind(console);
			console[level] = (...parts) => {
				try {
					const line = parts.map((x) => (x instanceof Error ? x.stack ?? String(x) : String(x))).join(' ');
					appendFileSync(logFile, `${line}\n`);
				} catch {
					/* logging must never take the server down */
				}
				try {
					original(...parts);
				} catch {
					/* hidden process may have no usable stdout */
				}
			};
		}
	} catch {
		/* not fatal */
	}
}

const forcedLan = process.argv.includes('--lan') || process.env.ADDARR_LAN === '1';
const port = Number(process.env.PORT) || 4545;

// Same resolution as src/lib/server/db.ts; relative ADDARR_DB resolves against the repo root (F-SCRIPT-11).
const dbPath = process.env.ADDARR_DB
	? (isAbsolute(process.env.ADDARR_DB) ? process.env.ADDARR_DB : resolve(HERE_ROOT, process.env.ADDARR_DB))
	: join(DATA_DIR, 'addarr.db');

function readLanSetting() {
	try {
		const db = new DatabaseSync(dbPath);
		db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
		const row = db.prepare(`SELECT value FROM settings WHERE key = 'lan_enabled'`).get();
		db.close();
		return row?.value === '1';
	} catch (err) {
		console.warn(`LAN setting unreadable, defaulting off: ${err instanceof Error ? err.message : err}`);
		return false;
	}
}

const lanSetting = readLanSetting();
const lanEnabled = forcedLan || lanSetting;
const host = process.env.HOST || (lanEnabled ? '0.0.0.0' : '127.0.0.1');

// All non-internal IPv4 candidates, physical LAN interfaces first.
// Tailscale (100.64.0.0/10 CGNAT on tailscale*/utun*/wg* interfaces) and other
// virtual adapters sort last, so the startup log and Settings lead with the
// real LAN address. Binding is still 0.0.0.0 (all interfaces) unless HOST
// pins one — use that to stay off the Tailnet entirely.
function lanAddresses() {
	const found = [];
	for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
		for (const iface of ifaces ?? []) {
			if (iface.family !== 'IPv4' || iface.internal) continue;
			if (iface.address.startsWith('169.254.')) continue; // link-local, not routable
			found.push({ name, address: iface.address });
		}
	}
	const octet = (ip, i) => Number(ip.split('.')[i]);
	// Tailscale serves CGNAT range 100.64.0.0/10.
	const isCgnat = (ip) => octet(ip, 0) === 100 && octet(ip, 1) >= 64 && octet(ip, 1) <= 127;
	const isRfc1918 = (ip) => {
		const a = octet(ip, 0);
		const b = octet(ip, 1);
		return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
	};
	const isVirtual = (name) =>
		/^(tailscale|utun|tun|tap|wg|docker|br-|veth|virbr|vmnet|vboxnet|zt|hamachi)/i.test(name);
	const score = (c) =>
		(isVirtual(c.name) ? 2 : 0) + (isCgnat(c.address) ? 2 : 0) + (isRfc1918(c.address) ? 0 : 1);
	found.sort((a, b) => score(a) - score(b));
	return found;
}

// --- mDNS broadcast (live-toggleable from the app) -----------------------

let bonjour = null;
let published = false;
let broadcastChain = Promise.resolve();
const MDNS_NAME = `Addarr on ${os.hostname()}`;

async function startBroadcast() {
	return (broadcastChain = broadcastChain.then(async () => {
		if (published) return;
		try {
			const { Bonjour } = await import('bonjour-service');
			bonjour ??= new Bonjour();
			// IPv4-only bind must not advertise IPv6 (F-SCRIPT-07); pin to a single interface when HOST is concrete.
			const ipv6 = host === '0.0.0.0' || host === '::' ? false : host.includes(':');
			bonjour.publish({ name: MDNS_NAME, type: 'http', port, host: os.hostname(), disableIPv6: !ipv6 });
			published = true;
			console.log(`Broadcasting on the LAN via mDNS (Bonjour) as "${MDNS_NAME}".`);
		} catch (err) {
			console.warn(`mDNS broadcast unavailable (${err?.message ?? err}) — continuing without discovery.`);
		}
	}));
}

async function stopBroadcast() {
	return (broadcastChain = broadcastChain.then(async () => {
		if (!bonjour || !published) return;
		await Promise.race([new Promise((resolve) => bonjour.unpublishAll(resolve)), new Promise((r) => setTimeout(r, 2000))]);
		published = false;
		console.log('mDNS broadcast stopped.');
	}));
}

// --- runtime control surface consumed by /api/settings/lan ----------------

globalThis.__addarr = {
	lan: {
		// true when the process is actually reachable beyond localhost
		boundLan: !['127.0.0.1', 'localhost', '::1'].includes(host),
		// --lan / ADDARR_LAN=1 overrides the in-app setting until restart
		forced: forcedLan,
		broadcasting: false,
		// Effective bind address + port, and live interface candidates
		// (fresh on each call so Tailscale up/down is reflected).
		host,
		port,
		getAddresses: () => lanAddresses().map((c) => c.address),
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

// Graceful self-restart. Under a supervisor, hand the restart back to it: the
// replacement re-reads the DB settings, so bind address / LAN broadcast
// changes apply. Standalone, spawn a replacement process (same command line),
// let it take over the port, then exit.
async function restart() {
	console.log('Restarting Addarr…');
	try {
		await stopBroadcast();
	} catch {
		/* best effort */
	}
	if (supervisor === 'launchd') {
		// kickstart -k restarts immediately, bypassing launchd's respawn throttle.
		spawn('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.addarr.server`], {
			stdio: 'ignore',
			detached: true
		}).unref();
		setTimeout(() => process.exit(0), 250);
		return;
	}
	if (supervisor) {
		// systemd: Restart=always starts a fresh instance as soon as we exit.
		setTimeout(() => process.exit(0), 250);
		return;
	}
	const child = spawn(process.execPath, process.argv.slice(1), {
		env: { ...process.env, ADDARR_TAKEOVER_PORT: String(port) },
		stdio: process.platform === 'win32' ? 'ignore' : 'inherit',
		detached: true,
		windowsHide: true
	});
	child.unref();
	server.close(() => process.exit(0));
	// Keep-alive connections can hold the port; force-exit as a fallback.
	setTimeout(() => process.exit(0), 3000).unref();
}

// When taking over from a restarting instance, wait for the port to free up.
function waitPortFree(p, bindHost = '127.0.0.1', timeoutMs = 15000) {
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
			tester.listen(p, bindHost);
		};
		probe();
	});
}

// PID file for status/stop on platforms without a real supervisor (Windows),
// and as a cross-check everywhere else. Removed on the way out.
const pidPath = join(DATA_DIR, 'addarr.pid');

function writePidFile() {
	try {
		mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
		try {
			const existing = readFileSync(pidPath, 'utf8').trim().split(/\s+/);
			const existingPid = Number(existing[0]);
			if (Number.isInteger(existingPid) && existingPid > 0 && existingPid !== process.pid) {
				try {
					process.kill(existingPid, 0);
					console.error(`Another Addarr instance (pid ${existingPid}) owns this data directory — refusing to start.`);
					process.exit(1);
				} catch {
					/* stale PID, safe to replace */
				}
			}
		} catch {
			/* no existing PID */
		}
		writeFileSync(pidPath, `${process.pid} ${Date.now()}\n`);
		process.on('exit', () => {
			try {
				const cur = readFileSync(pidPath, 'utf8').trim().split(/\s+/)[0];
				if (cur === String(process.pid)) rmSync(pidPath, { force: true });
			} catch {
				/* best effort */
			}
		});
	} catch {
		/* not fatal */
	}
}

async function main() {
	if (process.env.ADDARR_TAKEOVER_PORT) await waitPortFree(port, host);
	await new Promise((resolve, reject) => {
		server.once('error', (err) => {
			console.error(`Failed to listen on ${host}:${port}: ${err.message}`);
			reject(err);
		});
		server.listen(port, host, resolve);
	});
	writePidFile();
	const listenLabel = host === '0.0.0.0' ? 'localhost' : host;
	console.log(`Addarr listening on http://${listenLabel}:${port}`);
	if (globalThis.__addarr.lan.boundLan) {
		if (host !== '0.0.0.0') {
			console.log(`Bound to ${host} (HOST override — other interfaces, e.g. Tailscale, are not served).`);
		} else {
			const candidates = lanAddresses();
			if (candidates.length) {
				console.log(`LAN access:  http://${candidates[0].address}:${port}`);
				for (const c of candidates.slice(1))
					console.log(`Also reachable: http://${c.address}:${port} (${c.name})`);
				if (candidates.length > 1)
					console.log('To serve only one interface (e.g. keep Addarr off Tailscale), set HOST=<ip> and restart.');
			} else console.log('LAN access enabled, but no LAN IPv4 address found yet.');
		}
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

if (typeof process !== 'undefined' && process.on) {
	process.on('uncaughtException', (err) => { try { appendFileSync(join(DATA_DIR, 'addarr.error.log'), `${new Date().toISOString()} uncaught: ${err?.stack ?? err}\n`); } catch {} console.error(err); process.exit(1); });
}

globalThis.__addarr.restart = restart;

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
