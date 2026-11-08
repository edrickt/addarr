import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the data layer at a throwaway database *before* importing anything that
// opens it: the repo's data/addarr.db must never be touched by a test run.
const dir = mkdtempSync(join(tmpdir(), 'addarr-auth-test-'));
process.env.ADDARR_DB = join(dir, 'addarr.db');

const auth = await import('./auth.ts');
const { db } = await import('./db.ts');

after(() => {
	try { db.close(); } catch { /* best-effort */ }
	rmSync(dir, { recursive: true, force: true });
});

test('AUD-09: pruneExpiredSessions removes expired rows stored as ISO timestamps', () => {
	// Stored expiry is `toISOString()`; SQLite's datetime('now') uses a space
	// separator, so the old string comparison never pruned same-day expiries.
	const today = new Date().toISOString().slice(0, 10);
	db.prepare(`INSERT INTO users (id, username, pin_hash, role) VALUES (1, 'admin', 'x', 'admin')`).run();
	db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('expired', 1, ?)`).run(
		`${today}T00:00:00.000Z`
	);
	db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('live', 1, ?)`).run(
		new Date(Date.now() + 3600_000).toISOString()
	);

	auth.pruneExpiredSessions();

	const remaining = (db.prepare(`SELECT id FROM sessions ORDER BY id`).all() as { id: string }[]).map(
		(row) => row.id
	);
	assert.deepEqual(remaining, ['live']);
});

test('AUD-08: the dummy verification hash is a real hash of the fixed PIN', () => {
	// Unknown/disabled usernames are verified against this constant so they cost
	// the same as a real account; it must be a valid argon2id hash.
	assert.equal(auth.verifyPin('000000', auth.DUMMY_HASH), true);
	assert.equal(auth.verifyPin('111111', auth.DUMMY_HASH), false);
});

test('session cookie is httpOnly, lax, and not secure on the LAN', () => {
	const setCalls: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const cookies = {
		set(name: string, value: string, opts: Record<string, unknown>) {
			setCalls.push({ name, value, opts });
		},
		delete() {
			/* no-op */
		},
		get() {
			return undefined;
		}
	};
	db.prepare(`INSERT INTO users (id, username, pin_hash, role) VALUES (2, 'admin2', 'x', 'admin')`).run();
	auth.createSession(cookies as never, 2, 'admin');

	const call = setCalls[0]!;
	assert.equal(call.name, auth.SESSION_COOKIE);
	assert.ok(call.value.length > 20, 'session id must be a long random token');
	assert.equal(call.opts.httpOnly, true);
	assert.equal(call.opts.sameSite, 'lax');
	assert.equal(call.opts.secure, false);
	assert.equal(call.opts.path, '/');
});
