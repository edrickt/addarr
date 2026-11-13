import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the data layer at a throwaway database *before* importing anything that
// opens it: the repo's data/addarr.db must never be touched by a test run.
const dir = mkdtempSync(join(tmpdir(), 'addarr-db-test-'));
process.env.ADDARR_DB = join(dir, 'nested', 'addarr.db');

const { db, ensurePrivateDataDir } = await import('./db.ts');

after(() => {
	try {
		db.close();
	} catch {
		/* best-effort */
	}
	rmSync(dir, { recursive: true, force: true });
});

const mode = (path: string): number => statSync(path).mode & 0o777;

test('AUD-10: an existing user-provided data directory keeps its permissions', () => {
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

test('AUD-10: a directory Addarr creates itself is private', () => {
	const created = join(dir, 'created-by-addarr', 'data');
	ensurePrivateDataDir(created);
	assert.equal(mode(created), 0o700);
});
