import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Lockfile integrity guard. `package-lock.json` is committed release metadata,
 * so an entry that claims a version its resolved tarball does not contain is a
 * real defect: `npm ci` installs the tarball (the old version) while `npm ls`
 * reports the claimed one, and a naive release-time string replacement can
 * produce exactly that mismatch.
 */

const lock = JSON.parse(
	readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')
) as {
	version?: string;
	packages?: Record<string, { version?: string; resolved?: string }>;
};
const pkg = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version?: string };

// Registry tarball URLs end in `/<name>-<version>.tgz`; scoped packages use
// the unscoped name there (e.g. .../@types/node/-/node-22.0.0.tgz).
const TARBALL_VERSION = /\/[^/]+-(\d+\.\d+\.\d+[^/]*)\.tgz$/;

test('every lockfile package version matches the tarball it resolves to', () => {
	const mismatches: string[] = [];
	for (const [path, entry] of Object.entries(lock.packages ?? {})) {
		if (!path.startsWith('node_modules/')) continue;
		if (!entry.version || typeof entry.resolved !== 'string') continue;
		const match = TARBALL_VERSION.exec(entry.resolved);
		if (!match) continue;
		if (match[1] !== entry.version) {
			mismatches.push(`${path}: lockfile says ${entry.version}, resolved tarball is ${match[1]}`);
		}
	}
	assert.deepEqual(mismatches, [], `lockfile version/resolved mismatches:\n${mismatches.join('\n')}`);
});

test('the lockfile root version matches package.json', () => {
	assert.equal(lock.packages?.['']?.version, pkg.version);
	assert.equal(lock.version, pkg.version);
});
