import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.ADDARR_DB ?? join(process.cwd(), 'data', 'addarr.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

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
try {
	db.exec(`ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
} catch {
	/* column already present */
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
		   app_version = excluded.app_version`
	).run(input.type, input.name, input.baseUrl.replace(/\/+$/, ''), input.apiKey, input.appVersion ?? null);
}
