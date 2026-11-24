import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Point the data layer at a throwaway database before importing anything that
// opens it; the repo's data/addarr.db must never be touched by a test run.
const dir = mkdtempSync(join(tmpdir(), 'addarr-setup-token-test-'));
process.env.ADDARR_DB = join(dir, 'addarr.db');

const { db } = await import('./db.ts');
const { ensureSetupToken, forgetSetupToken, isLoopbackAddress, verifySetupToken } = await import(
	'./setup-token.ts'
);

after(() => {
	try {
		db.close();
	} catch {
		/* best-effort */
	}
	rmSync(dir, { recursive: true, force: true });
});

const TOKEN_FILE = join(dir, 'setup-token');
const userCount = (): number => (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;

/**
 * AS-05: a fresh LAN-shared install had no user row, and /api/auth/setup was
 * deliberately not admin-gated — whoever reached the port first became admin,
 * and the owner had to delete data/addarr.db to recover.
 */
test('AS-05: loopback addresses are recognised, everything else is not', () => {
	for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.1.2.3', 'localhost']) {
		assert.equal(isLoopbackAddress(address), true, `${address} is this machine`);
	}
	for (const address of ['192.168.1.50', '::ffff:192.168.1.50', '10.0.0.1', '0.0.0.0', '::2', '', 'nope']) {
		assert.equal(isLoopbackAddress(address), false, `${address} is not this machine`);
	}
});

test('AS-05: first run mints a token, keeps it stable, and stores it privately', () => {
	assert.equal(userCount(), 0);
	forgetSetupToken();

	const token = ensureSetupToken();
	assert.ok(token, 'first run must produce a token');
	assert.match(token, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, 'human-typable, no ambiguous letters');
	assert.equal(ensureSetupToken(), token, 'the same token is returned for the whole first run');
	assert.equal(readFileSync(TOKEN_FILE, 'utf8').trim(), token);
	assert.equal(statSync(TOKEN_FILE).mode & 0o777, 0o600, 'the token file is owner-only');
});

test('AS-05: the token is compared in constant time and tolerates retyping', () => {
	const token = ensureSetupToken();
	assert.ok(token);

	assert.equal(verifySetupToken(token), true);
	assert.equal(verifySetupToken(token.toLowerCase()), true, 'case is not a trap');
	assert.equal(verifySetupToken(token.replace(/-/g, '')), true, 'dashes are not a trap');
	assert.equal(verifySetupToken(` ${token} `), true);
	assert.equal(verifySetupToken('ZZZZ-ZZZZ-ZZZZ'), false);
	assert.equal(verifySetupToken(''), false);
	assert.equal(verifySetupToken(undefined), false);
	assert.equal(verifySetupToken(1234), false);
});

test('AS-05: once an admin exists the token is retired', () => {
	db.prepare(`INSERT INTO users (id, username, pin_hash, role) VALUES (94, 'owner', 'x', 'admin')`).run();
	try {
		assert.equal(ensureSetupToken(), null, 'no token is needed or issued after setup');
		assert.equal(existsSync(TOKEN_FILE), true, 'the file only goes away when setup completes');

		forgetSetupToken(); // what the setup route does on success
		assert.equal(existsSync(TOKEN_FILE), false);
		assert.equal(verifySetupToken('anything'), true, 'nothing to verify against');
	} finally {
		db.prepare(`DELETE FROM users WHERE id = 94`).run();
	}
});
