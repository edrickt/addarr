import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePathname, isAdminPath } from './admin-gating.ts';

test('admin pages and APIs require admin', () => {
	for (const path of [
		'/settings',
		'/presets',
		'/console',
		'/activity',
		'/api/services',
		'/api/presets',
		'/api/console',
		'/api/activity',
		'/api/settings',
		'/api/restart',
		'/arrapi',
		'/api/console/library',
		'/arrapi/radarr/queue',
		'/api/services/'
	]) {
		assert.equal(isAdminPath(path), true, `${path} must be admin`);
	}
});

test('member and auth surfaces do not require admin', () => {
	for (const path of [
		'/',
		'/downloads',
		'/login',
		'/setup',
		'/api/auth/login',
		'/api/auth/logout',
		'/api/auth/setup',
		'/api/search',
		'/api/add',
		'/api/status/batch',
		'/api/status/movie/1',
		'/api/downloads',
		'/api/files/movie/1',
		'/settings-notes',
		'/api/services-public'
	]) {
		assert.equal(isAdminPath(path), false, `${path} must not be admin`);
	}
});

test('percent-encoding in a path prefix does not bypass the admin gate', () => {
	// SvelteKit routes on the decoded pathname; the gate must too. These used
	// to resolve to admin routes while the raw-pathname check skipped the gate.
	assert.equal(isAdminPath('/%61pi/services'), true, 'encoded /api/services');
	assert.equal(isAdminPath('/%61pi/activity'), true, 'encoded /api/activity');
	assert.equal(isAdminPath('/%61pi/settings/lan'), true, 'encoded /api/settings');
	assert.equal(isAdminPath('/%61pi/restart'), true, 'encoded /api/restart');
	assert.equal(isAdminPath('/%61rrapi/radarr/system/status'), true, 'encoded /arrapi');
	assert.equal(isAdminPath('/sett%69ngs'), true, 'encoded /settings');
	assert.equal(isAdminPath('/%63onsole'), true, 'encoded /console');
	assert.equal(isAdminPath('/%61ctivity'), true, 'encoded /activity');
	assert.equal(isAdminPath('/api/serv%69ces'), true, 'encoded inside a prefix');
});

test('decodePathname decodes route-significant characters', () => {
	assert.equal(decodePathname('/%73etup'), '/setup');
	assert.equal(decodePathname('/api/services'), '/api/services');
});

test('decodePathname leaves malformed percent sequences untouched', () => {
	assert.equal(decodePathname('/api/%'), '/api/%');
	assert.equal(decodePathname('/api/%E0%A4%A'), '/api/%E0%A4%A');
});
