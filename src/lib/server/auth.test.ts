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

/* -------------------------------------------------------------------------
 * AS-07: sessions are stored hashed and have an absolute lifetime.
 * `sessions.id` used to hold the raw bearer token (any read of the DB file —
 * a backup, a copied data dir, a support bundle — impersonated every session
 * without cracking anything), and the 12 h sliding expiry never ended a session
 * that was used at least once every 12 h, so a stolen cookie was valid forever.
 * ---------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function cookieJar() {
	const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const deleted: string[] = [];
	return {
		set,
		deleted,
		cookies: {
			set(name: string, value: string, opts: Record<string, unknown>) {
				set.push({ name, value, opts });
			},
			delete(name: string) {
				deleted.push(name);
			},
			get() {
				return undefined;
			}
		}
	};
}

function sessionCount(userId: number): number {
	return (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(userId) as { n: number }).n;
}

test('AS-07: the sessions table stores a hash of the token, never the token', () => {
	db.prepare(`INSERT INTO users (id, username, pin_hash, role) VALUES (30, 'sess-admin', 'x', 'admin')`).run();
	const jar = cookieJar();
	const sid = auth.createSession(jar.cookies as never, 30, 'admin');

	const rows = db.prepare(`SELECT id, created_at FROM sessions WHERE user_id = 30`).all() as {
		id: string;
		created_at: string | null;
	}[];
	assert.equal(rows.length, 1);
	assert.notEqual(rows[0]!.id, sid, 'the bearer token must not be the primary key');
	assert.equal(rows[0]!.id, auth.hashSessionId(sid), 'the row is keyed by sha256(token)');
	assert.equal(
		JSON.stringify(rows).includes(sid),
		false,
		'the raw token must not appear anywhere in the row'
	);
	assert.ok(rows[0]!.created_at, 'the row carries its creation time for the absolute cap');
	// The cookie still carries the token the browser must send back.
	assert.equal(jar.set[0]?.value, sid);
});

test('AS-07: a session past its absolute lifetime is rejected even though it kept sliding', () => {
	db.prepare(`INSERT OR IGNORE INTO users (id, username, pin_hash, role) VALUES (31, 'sess-admin2', 'x', 'admin')`).run();
	const jar = cookieJar();
	const sid = auth.createSession(jar.cookies as never, 31, 'admin');
	const hash = auth.hashSessionId(sid);

	// The "used every 6 hours forever" case: the sliding expiry is always in the
	// future, but the session was created 31 days ago.
	db.prepare(`UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?`).run(
		new Date(Date.now() - 31 * DAY_MS).toISOString(),
		new Date(Date.now() + 12 * 3_600_000).toISOString(),
		hash
	);

	assert.equal(auth.getSessionUser(sid, jar.cookies as never), null);
	assert.equal(sessionCount(31), 0, 'the row is deleted, not just ignored');
});

test('AS-07: inside the cap, sliding still refreshes and never passes the cap', () => {
	db.prepare(`INSERT OR IGNORE INTO users (id, username, pin_hash, role) VALUES (32, 'sess-admin3', 'x', 'admin')`).run();
	const jar = cookieJar();
	const sid = auth.createSession(jar.cookies as never, 32, 'admin');
	const hash = auth.hashSessionId(sid);

	// Created 29 days ago (one day of the cap left), expiring in an hour: the
	// normal sliding path refreshes, but must stop at created_at + 30 days.
	const created = Date.now() - 29 * DAY_MS;
	db.prepare(`UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?`).run(
		new Date(created).toISOString(),
		new Date(Date.now() + 3_600_000).toISOString(),
		hash
	);
	jar.set.length = 0;

	const user = auth.getSessionUser(sid, jar.cookies as never);
	assert.equal(user?.id, 32);
	assert.equal(user?.role, 'admin');

	const row = db
		.prepare(`SELECT expires_at, created_at FROM sessions WHERE id = ?`)
		.get(hash) as { expires_at: string; created_at: string };
	const expires = Date.parse(row.expires_at);
	assert.ok(expires > Date.now(), 'the session is still valid');
	assert.ok(
		expires <= Date.parse(row.created_at) + 30 * DAY_MS,
		'the refreshed expiry is clamped to the absolute cap'
	);
	assert.equal(jar.set.length, 1, 'the cookie is re-issued');
	assert.equal(jar.set[0]?.value, sid, 'the browser keeps the same token');
});

test('AS-07: a young session slides normally and logout deletes it by hash', () => {
	db.prepare(`INSERT OR IGNORE INTO users (id, username, pin_hash, role) VALUES (33, 'sess-admin4', 'x', 'admin')`).run();
	const jar = cookieJar();
	const sid = auth.createSession(jar.cookies as never, 33, 'admin');
	const hash = auth.hashSessionId(sid);

	// Fresh session, less than half of the admin lifetime left → refreshed to a
	// full TTL, and the row is found by the hash.
	db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(
		new Date(Date.now() + 3_600_000).toISOString(),
		hash
	);
	assert.equal(auth.getSessionUser(sid, jar.cookies as never)?.id, 33);

	auth.destroySession(sid, jar.cookies as never);
	assert.equal(sessionCount(33), 0, 'logout removed the row');
	assert.deepEqual(jar.deleted, [auth.SESSION_COOKIE]);
	assert.equal(auth.getSessionUser(sid, jar.cookies as never), null, 'the old token is dead');
});

test('AS-07: the sessions table carries created_at for the absolute cap', () => {
	const columns = (
		db.prepare(`SELECT name FROM pragma_table_info('sessions')`).all() as { name: string }[]
	).map((column) => column.name);
	assert.ok(columns.includes('created_at'));
});
