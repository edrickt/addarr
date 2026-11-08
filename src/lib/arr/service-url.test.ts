import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServiceBaseUrl } from './service-url.ts';

test('accepts plain http and https origins', () => {
	assert.deepEqual(normalizeServiceBaseUrl('http://192.168.1.10:7878'), {
		baseUrl: 'http://192.168.1.10:7878'
	});
	assert.deepEqual(normalizeServiceBaseUrl('  https://arr.example  '), { baseUrl: 'https://arr.example' });
});

test('preserves a reverse-proxy subpath and strips trailing slashes', () => {
	assert.deepEqual(normalizeServiceBaseUrl('https://host/radarr/'), { baseUrl: 'https://host/radarr' });
	assert.deepEqual(normalizeServiceBaseUrl('http://host:7878//'), { baseUrl: 'http://host:7878' });
});

test('AUD-12: non-HTTP schemes are rejected with a clear error', () => {
	for (const raw of ['file:///etc/passwd', 'ftp://host', 'javascript:alert(1)', 'mailto:x@y']) {
		const result = normalizeServiceBaseUrl(raw);
		assert.ok('error' in result, `${raw} must be rejected`);
		assert.match(result.error, /http:\/\/ or https:\/\//);
	}
});

test('AUD-12: malformed and empty input keep the existing validation error', () => {
	for (const raw of ['not a url', '', '   ', undefined, null, 42]) {
		const result = normalizeServiceBaseUrl(raw);
		assert.ok('error' in result);
	}
	assert.match(
		(normalizeServiceBaseUrl('not a url') as { error: string }).error,
		/must be a valid URL/
	);
});

test('query strings and fragments in a base URL are rejected', () => {
	for (const raw of ['http://host:7878/?apikey=x', 'http://host:7878/#frag']) {
		const result = normalizeServiceBaseUrl(raw);
		assert.ok('error' in result);
	}
});
