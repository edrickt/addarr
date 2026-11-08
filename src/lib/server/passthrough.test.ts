import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	normalizePassthroughPath,
	resolvePassthroughPath
} from './passthrough.ts';

test('ordinary allow-listed paths pass unchanged', () => {
	for (const raw of [
		'system/status',
		'diskspace',
		'health',
		'movie',
		'movie/42',
		'movie/lookup',
		'series',
		'series/9',
		'series/lookup',
		'episode',
		'queue',
		'history',
		'blocklist',
		'importexclusions',
		'importexclusions/3',
		'calendar',
		'command',
		'command/7',
		'qualityprofile',
		'rootfolder',
		'tag',
		'tag/2'
	]) {
		const resolved = resolvePassthroughPath(raw);
		assert.equal(resolved.allowed, true, `${raw} should be allowed`);
		assert.equal(resolved.target, `/${raw}`, `${raw} should pass unchanged`);
	}
});

test('non-allow-listed read endpoints are rejected', () => {
	for (const raw of ['system/backup', 'downloadclient', 'indexer', 'config/host', 'system/task', '']) {
		assert.equal(resolvePassthroughPath(raw).allowed, false, `${raw} should be rejected`);
	}
});

test('dot-segment traversal cannot escape an allow-listed prefix', () => {
	for (const raw of [
		'queue/../system/backup',
		'movie/lookup/../../system/backup',
		'movie/1/../../downloadclient',
		'queue/./../../indexer',
		'command/../config/host'
	]) {
		const resolved = resolvePassthroughPath(raw);
		assert.equal(resolved.allowed, false, `${raw} must not be allowed (got ${resolved.target})`);
	}
});

test('backslash traversal is normalized before the allow-list sees it', () => {
	// WHATWG URL parsing turns `\` into `/` when the upstream URL is built, so a
	// raw prefix match on `queue\..\...` used to forward to an arbitrary endpoint.
	for (const raw of [
		'queue/..\\system\\backup',
		'queue\\..\\system\\backup',
		'movie/lookup/..\\..\\downloadclient',
		'movie/lookup/../../downloadclient'.replace(/\//g, '\\')
	]) {
		const resolved = resolvePassthroughPath(raw);
		assert.equal(resolved.allowed, false, `${raw} must not be allowed (got ${resolved.target})`);
	}

	const escaped = resolvePassthroughPath('queue\\..\\system\\backup');
	assert.equal(escaped.target, '/system/backup');
});

test('traversal that lands on another allow-listed read endpoint stays allowed', () => {
	const resolved = resolvePassthroughPath('queue/../qualityprofile');
	assert.equal(resolved.target, '/qualityprofile');
	assert.equal(resolved.allowed, true);
});

test('normalization collapses empty and dot segments', () => {
	assert.equal(normalizePassthroughPath('movie//1'), '/movie/1');
	assert.equal(normalizePassthroughPath('/movie/./1'), '/movie/1');
	assert.equal(normalizePassthroughPath('../../etc'), '/etc');
	assert.equal(normalizePassthroughPath(''), '/');
});

test('AUD-03 follow-up: double-encoded traversal is rejected even after SvelteKit decodes once', () => {
	// The route receives params.path after one decode; these are the still-encoded
	// strings a %252E%252E%255C request produces. Forwarding them would let the
	// upstream HTTP server decode the traversal.
	for (const raw of [
		'queue/%252E%252E%255Csystem%255Cbackup',
		'queue%252F..%252Fdownloadclient',
		'%252E%252E%255Cetc%255Cpasswd',
		'movie/lookup/%252E%252E/%252E%252E/downloadclient'
	]) {
		const resolved = resolvePassthroughPath(raw);
		assert.equal(resolved.allowed, false, `${raw} must be rejected (got ${resolved.target})`);
	}

	// Ordinary paths carry no percent sequences and keep working, including the
	// ones SvelteKit already decoded (encoded slash/backslash now literal).
	assert.equal(resolvePassthroughPath('queue').allowed, true);
	assert.equal(resolvePassthroughPath('movie/42').allowed, true);
	assert.equal(resolvePassthroughPath('queue/../qualityprofile').allowed, true);
});
