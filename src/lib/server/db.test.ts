import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Point the data layer at a throwaway database *before* importing anything that
// opens it: the repo's data/addarr.db must never be touched by a test run.
const dir = mkdtempSync(join(tmpdir(), 'addarr-db-test-'));
process.env.ADDARR_DB = join(dir, 'nested', 'addarr.db');

const { ACTIVITY_MAX_ROWS, ACTIVITY_PRUNE_INTERVAL_MS, db, ensurePrivateDataDir, pruneActivityLog } =
	await import('./db.ts');

after(() => {
	try {
		db.close();
	} catch {
		/* best-effort */
	}
	rmSync(dir, { recursive: true, force: true });
});

const mode = (path: string): number => statSync(path).mode & 0o777;

test('AUD-06: an existing user-provided data directory keeps its permissions', () => {
	// ADDARR_DB may live in a directory shared with other services (e.g.
	// /srv/media). Addarr must secure its own files, not chmod the parent.
	const shared = mkdtempSync(join(tmpdir(), 'addarr-shared-'));
	try {
		chmodSync(shared, 0o755);
		ensurePrivateDataDir(shared);
		assert.equal(mode(shared), 0o755, 'a pre-existing directory must not be tightened');
	} finally {
		rmSync(shared, { recursive: true, force: true });
	}
});

test('AUD-06: a directory Addarr creates itself is private', () => {
	const created = join(dir, 'created-by-addarr', 'data');
	ensurePrivateDataDir(created);
	assert.equal(mode(created), 0o700);
});

/** AS-06: activity_log had no retention — nothing ever deleted a row. */
const insertActivity = db.prepare(
	`INSERT INTO activity_log (action, title, created_at) VALUES (?, ?, ?)`
);
const sqliteNow = (offsetDays = 0): string =>
	new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
const activityCount = (): number =>
	(db.prepare(`SELECT COUNT(*) AS n FROM activity_log`).get() as { n: number }).n;

test('AS-06: rows older than the retention window are deleted, newer ones kept', () => {
	db.prepare(`DELETE FROM activity_log`).run();
	insertActivity.run('auth.login.failure', 'ancient', sqliteNow(400));
	insertActivity.run('auth.login.failure', 'stale', sqliteNow(91));
	insertActivity.run('auth.login.failure', 'recent', sqliteNow(30));
	insertActivity.run('auth.login.failure', 'today', sqliteNow(0));

	pruneActivityLog();

	const titles = (db.prepare(`SELECT title FROM activity_log ORDER BY id`).all() as { title: string }[]).map(
		(row) => row.title
	);
	assert.deepEqual(titles, ['recent', 'today'], 'only rows inside the window survive');
});

test('AS-06: the table is also capped by row count', () => {
	db.prepare(`DELETE FROM activity_log`).run();
	for (let i = 0; i < 30; i++) insertActivity.run('auth.login.failure', `row-${i}`, sqliteNow(0));
	assert.equal(activityCount(), 30);

	const removed = pruneActivityLog({ maxRows: 10 });
	assert.equal(removed, 20);
	assert.equal(activityCount(), 10);
	const kept = db.prepare(`SELECT title FROM activity_log ORDER BY id`).all() as { title: string }[];
	assert.equal(kept[0]?.title, 'row-20', 'the newest rows are the ones kept');
	assert.equal(kept[9]?.title, 'row-29');

	// Defaults are the shipped values, not the test's.
	assert.ok(ACTIVITY_MAX_ROWS >= 1000);
	db.prepare(`DELETE FROM activity_log`).run();
});

test('AS-06: pruning is scheduled, never run from a request handler', () => {
	// The finding was "no retention"; the fix must not become "a DELETE on every
	// unauthenticated login", which would be a worse amplifier than the rows.
	const routes = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'routes');
	const walk = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const path = join(dir, entry.name);
			return entry.isDirectory() ? walk(path) : [path];
		});
	const offenders = walk(routes).filter((file) => readFileSync(file, 'utf8').includes('pruneActivityLog'));
	assert.deepEqual(offenders, [], 'no route may prune the activity log itself');
	assert.ok(ACTIVITY_PRUNE_INTERVAL_MS >= 60 * 60_000, 'the timer is at least hourly');
});
