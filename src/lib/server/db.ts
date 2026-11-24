import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.ADDARR_DB ?? join(process.cwd(), 'data', 'addarr.db');

/**
 * Create/secure the database's directory. Only a directory Addarr creates is
 * tightened to 0700: `ADDARR_DB` may point into an existing directory shared
 * with other services (e.g. /srv/media), and chmodding that parent would break
 * their access. The database file itself is always chmodded 0600 below.
 */
export function ensurePrivateDataDir(dirPath: string): void {
	const existed = existsSync(dirPath);
	mkdirSync(dirPath, { recursive: true, mode: 0o700 });
	if (existed) return;
	try {
		chmodSync(dirPath, 0o700);
	} catch {
		/* best-effort on Windows */
	}
}

ensurePrivateDataDir(dirname(DB_PATH));

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
try {
	chmodSync(DB_PATH, 0o600);
	chmodSync(`${DB_PATH}-wal`, 0o600);
	chmodSync(`${DB_PATH}-shm`, 0o600);
} catch { /* missing sidecars on first run, or Windows ACLs */ }

db.exec(`
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL UNIQUE,
	pin_hash TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
	disabled INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	type TEXT NOT NULL UNIQUE CHECK (type IN ('radarr', 'sonarr')),
	name TEXT NOT NULL,
	base_url TEXT NOT NULL,
	api_key TEXT NOT NULL,
	app_version TEXT,
	enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS presets (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	is_default INTEGER NOT NULL DEFAULT 0,
	quality_profile_id INTEGER NOT NULL,
	root_folder_path TEXT NOT NULL,
	monitored INTEGER NOT NULL DEFAULT 1,
	tags_json TEXT NOT NULL DEFAULT '[]',
	minimum_availability TEXT,
	search_on_add INTEGER NOT NULL DEFAULT 1,
	series_type_default TEXT,
	season_monitor_policy TEXT CHECK (
		season_monitor_policy IS NULL OR
		season_monitor_policy IN ('all', 'none', 'first', 'latest')
	),
	UNIQUE (service_id, name)
);

CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS activity_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
	service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
	action TEXT NOT NULL,
	arr_item_id INTEGER,
	title TEXT,
	payload_json TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Schema drift migration for databases created before the `disabled` column existed.
const hasDisabled = db.prepare(`SELECT name FROM pragma_table_info('users') WHERE name = 'disabled'`).get();
if (!hasDisabled) {
	try {
		db.exec(`ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
	} catch (err) {
		throw new Error(`Schema migration failed adding users.disabled: ${err instanceof Error ? err.message : err}`);
	}
}

/**
 * Retention for the activity log (AS-06). Every failed login writes a row, and
 * nothing ever deleted one, so the SQLite file — often on an SD card — grew
 * without bound while an unauthenticated client could append at request rate.
 * Keep the newest MAX_ROWS entries and nothing older than RETENTION_DAYS.
 */
export const ACTIVITY_MAX_ROWS = 20_000;
export const ACTIVITY_RETENTION_DAYS = 90;
/** Six hours: long enough that this can never run per request. */
export const ACTIVITY_PRUNE_INTERVAL_MS = 6 * 60 * 60_000;

export function pruneActivityLog(
	options: { maxRows?: number; retentionDays?: number; now?: number } = {}
): number {
	const maxRows = options.maxRows ?? ACTIVITY_MAX_ROWS;
	const retentionDays = options.retentionDays ?? ACTIVITY_RETENTION_DAYS;
	const now = options.now ?? Date.now();
	// created_at is SQLite's `datetime('now')` → 'YYYY-MM-DD HH:MM:SS' in UTC.
	// Comparing it against an ISO string with a 'T' never matches (AUD-09).
	const cutoff = new Date(now - retentionDays * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
	let removed = 0;
	removed += Number(db.prepare(`DELETE FROM activity_log WHERE created_at < ?`).run(cutoff).changes);
	removed += Number(
		db
			.prepare(`DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT ?)`)
			.run(maxRows).changes
	);
	return removed;
}

/**
 * Housekeeping on a timer, never on the request path: one prune at startup,
 * then every six hours. `unref()` so a short-lived process (a test run, a
 * one-off script) is never held open by it.
 */
function scheduleMaintenance(): void {
	const run = (): void => {
		try {
			const removed = pruneActivityLog();
			if (removed > 0) console.log(`[maintenance] pruned ${removed} activity_log rows`);
		} catch (err) {
			console.error('[maintenance] activity prune failed:', err);
		}
	};
	run();
	const timer = setInterval(run, ACTIVITY_PRUNE_INTERVAL_MS);
	timer.unref?.();
}

if (!(globalThis as { __addarrMaintenance?: boolean }).__addarrMaintenance) {
	(globalThis as { __addarrMaintenance?: boolean }).__addarrMaintenance = true;
	scheduleMaintenance();
}

export function getSetting(key: string): string | undefined {
	const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
		| { value: string }
		| undefined;
	return row?.value;
}

export function setSetting(key: string, value: string): void {
	db.prepare(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).run(key, value);
}

export type ServiceRow = {
	id: number;
	type: 'radarr' | 'sonarr';
	name: string;
	base_url: string;
	api_key: string;
	app_version: string | null;
	enabled: number;
};

export function getServiceByType(type: 'radarr' | 'sonarr'): ServiceRow | undefined {
	return db
		.prepare(`SELECT * FROM services WHERE type = ? AND enabled = 1`)
		.get(type) as ServiceRow | undefined;
}

export function upsertService(input: {
	type: 'radarr' | 'sonarr';
	name: string;
	baseUrl: string;
	apiKey: string;
	appVersion?: string | null;
}): void {
	db.prepare(
		`INSERT INTO services (type, name, base_url, api_key, app_version)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(type) DO UPDATE SET
		   name = excluded.name,
		   base_url = excluded.base_url,
		   api_key = excluded.api_key,
		   app_version = excluded.app_version,
		   enabled = 1`
	).run(input.type, input.name, input.baseUrl.replace(/\/+$/, ''), input.apiKey, input.appVersion ?? null);
}
