import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/**
 * AS-07 migration: before this change `sessions.id` held the raw bearer token,
 * so every existing row (and every backup of the database) was a live
 * credential. Raw tokens cannot become hashes of themselves without the plain
 * text, so the upgrade drops them once — everyone signs in again.
 *
 * This file builds a pre-change database on disk *before* importing the data
 * layer, so the migration runs against it exactly as it would on a real
 * upgrade. `node --test` runs each test file in its own process, so importing
 * db.ts here does not interfere with the other suites.
 */
const dir = mkdtempSync(join(tmpdir(), 'addarr-session-migration-'));
const dbPath = join(dir, 'addarr.db');

const legacy = new DatabaseSync(dbPath);
legacy.exec(`
CREATE TABLE users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL UNIQUE,
	pin_hash TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL
);
`);
legacy.prepare(`INSERT INTO users (id, username, pin_hash, role) VALUES (1, 'legacy-admin', 'x', 'admin')`).run();
legacy
	.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, 1, ?)`)
	.run('raw-bearer-token-that-must-not-survive', new Date(Date.now() + 86_400_000).toISOString());
legacy.close();

process.env.ADDARR_DB = dbPath;
const { db } = await import('./db.ts');

after(() => {
	try {
		db.close();
	} catch {
		/* best-effort */
	}
	rmSync(dir, { recursive: true, force: true });
});

test('AS-07: upgrading to hashed sessions invalidates the raw-token rows', () => {
	const rows = db.prepare(`SELECT id FROM sessions`).all() as { id: string }[];
	assert.deepEqual(rows, [], 'rows that stored a bearer token are dropped, not left usable');
});

test('AS-07: the migration adds created_at and keeps the rest of the database', () => {
	const columns = (
		db.prepare(`SELECT name FROM pragma_table_info('sessions')`).all() as { name: string }[]
	).map((column) => column.name);
	assert.ok(columns.includes('created_at'), 'the absolute cap needs a creation time');
	assert.equal(columns.includes('expires_at'), true);

	const user = db.prepare(`SELECT username FROM users WHERE id = 1`).get() as { username: string };
	assert.equal(user.username, 'legacy-admin', 'the upgrade only touches sessions');
});

test('AS-07: the migration is idempotent — a second start keeps hashed sessions', async () => {
	// A restart must not wipe a live (hashed) session: the predicate only matches
	// ids that are not 64 hex characters.
	const { createSession } = await import('./auth.ts');
	const sid = createSession({ set() {}, delete() {}, get() {} } as never, 1, 'admin');
	const count = (): number =>
		(db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n;
	assert.equal(count(), 1);
	assert.equal(
		(db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id = ?`).get(sid) as { n: number }).n,
		0,
		'the stored id is not the raw token'
	);

	// A second process opening the same file runs the migration again.
	const script = `
		const { db } = await import(${JSON.stringify(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'db.ts')).href)});
		const row = db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
		console.log(JSON.stringify(row));
	`;
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		env: { ...process.env, ADDARR_DB: dbPath },
		encoding: 'utf8'
	});
	assert.equal(run.status, 0, run.stderr);
	assert.equal((JSON.parse(run.stdout.trim()) as { n: number }).n, 1, 'the restart kept the session');
});
