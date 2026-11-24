import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildHostAllowlist,
	crossSiteVerdict,
	hostVerdict,
	normalizeHost
} from './request-guard.ts';

/**
 * AS-02: the member API is anonymous and expensive (`/api/search` reads a whole
 * *arr library and queue). Nothing inspected `Sec-Fetch-Site`, `Origin` or
 * `Referer`, so any web page could fire `<img src="http://addarr.local:4545/api/
 * search?q=…">` at the house and make the arrs do the work.
 */

const EXPECTED = 'http://addarr.local:4545';

function verdict(patch: Partial<Parameters<typeof crossSiteVerdict>[0]> = {}) {
	return crossSiteVerdict({
		secFetchSite: null,
		origin: null,
		referer: null,
		expectedOrigin: EXPECTED,
		...patch
	});
}

test('AS-02: another site driving the API is refused', () => {
	assert.equal(verdict({ secFetchSite: 'cross-site' }).ok, false);
	assert.equal(verdict({ origin: 'http://evil.example' }).ok, false);
	// <img>/<link> requests carry no Origin, but do carry a Referer.
	assert.equal(verdict({ referer: 'http://evil.example/page.html' }).ok, false);
	// A sandboxed iframe or a file:// page sends the literal origin "null".
	assert.equal(verdict({ origin: 'null' }).ok, false);
});

test('AS-02: the app itself keeps working (same-origin GETs, navigations, curl)', () => {
	for (const allow of [
		{ secFetchSite: 'same-origin' },
		{ secFetchSite: 'none' },
		{ secFetchSite: 'same-site' },
		{ origin: EXPECTED },
		{ referer: `${EXPECTED}/downloads` },
		{ secFetchSite: 'same-origin', origin: EXPECTED, referer: `${EXPECTED}/` },
		// No browser signals at all: curl, a health probe, an old browser.
		{},
		// A Referer that is not a URL is not evidence of a foreign page.
		{ referer: 'not a url' }
	]) {
		assert.equal(verdict(allow).ok, true, `${JSON.stringify(allow)} must be allowed`);
	}
});

test('AS-02: the refusal explains itself', () => {
	const blocked = verdict({ secFetchSite: 'cross-site' });
	assert.equal(blocked.ok, false);
	if (!blocked.ok) assert.match(blocked.error, /cross-site/i);
});

/**
 * AS-03: Addarr answered any `Host` header, so a rebinding domain
 * (rebind.attacker.example, TTL 1s, resolving to 127.0.0.1) became same-origin
 * with the app: no CORS preflight, JSON POSTs allowed, and `event.url.origin`
 * (derived from Host) matched the attacker's Origin. The allow-list below is
 * what a deployment legitimately uses: loopback, its own addresses, the mDNS
 * name, HOST when pinned, plus an explicit escape hatch.
 */
const ALLOWED = buildHostAllowlist({
	hostname: 'MediaServer',
	addresses: ['127.0.0.1', '::1', '192.168.1.42', 'fe80::1c2d:3e4f'],
	env: { HOST: '192.168.1.42' }
});

test('AS-03: the allow-list carries loopback, the hostname and its mDNS name', () => {
	for (const host of [
		'localhost',
		'127.0.0.1',
		'[::1]',
		'mediaserver',
		'mediaserver.local',
		'192.168.1.42',
		'[fe80::1c2d:3e4f]'
	]) {
		assert.equal(ALLOWED.has(normalizeHost(host) ?? host), true, `${host} must be allowed`);
	}
});

test('AS-03: a rebinding name, a foreign name and a wildcard bind are refused', () => {
	assert.equal(hostVerdict('rebind.attacker.example:4545', ALLOWED).ok, false);
	assert.equal(hostVerdict('evil.example', ALLOWED).ok, false);
	assert.equal(hostVerdict('192.168.1.99:4545', ALLOWED).ok, false, 'not this machine');

	const wildcard = buildHostAllowlist({ hostname: 'nas', addresses: [], env: { HOST: '0.0.0.0' } });
	assert.equal(hostVerdict('0.0.0.0:4545', wildcard).ok, false, 'a wildcard bind is not a name');
});

test('AS-03: ports, case, trailing dots and IPv6 brackets normalize', () => {
	assert.equal(normalizeHost('MediaServer.LOCAL:4545'), 'mediaserver.local');
	assert.equal(normalizeHost('localhost.'), 'localhost');
	assert.equal(normalizeHost('[::1]:4545'), '[::1]');
	assert.equal(normalizeHost('[::1]'), '[::1]');
	assert.equal(normalizeHost(''), null);
	assert.equal(normalizeHost('[::1'), null);
	assert.equal(normalizeHost('host:port'), null);

	assert.equal(hostVerdict('LOCALHOST:4545', ALLOWED).ok, true);
	assert.equal(hostVerdict('[::1]:4545', ALLOWED).ok, true);
	assert.equal(hostVerdict('mediaserver.local:4545', ALLOWED).ok, true);
});

test('AS-03: deployment overrides work — HOST pin and a reverse-proxy name', () => {
	const env = { HOST: '10.0.0.7', ADDARR_ALLOWED_HOSTS: 'addarr.example.com, media.example.com:8443' };
	const allowed = buildHostAllowlist({ hostname: 'box', addresses: [], env });

	assert.equal(hostVerdict('10.0.0.7:4545', allowed).ok, true);
	assert.equal(hostVerdict('addarr.example.com', allowed).ok, true, 'proxy name from the escape hatch');
	assert.equal(hostVerdict('media.example.com:8443', allowed).ok, true);
	assert.equal(hostVerdict('other.example.com', allowed).ok, false);
});

test('AS-03: a request with no Host header is not rejected', () => {
	// HTTP/1.0 clients and some health probes send none; rebinding cannot.
	assert.equal(hostVerdict(null, ALLOWED).ok, true);
	assert.equal(hostVerdict('   ', ALLOWED).ok, true);
});

test('AS-03: the refusal says which host was rejected and how to allow it', () => {
	const blocked = hostVerdict('rebind.attacker.example:4545', ALLOWED);
	assert.equal(blocked.ok, false);
	if (!blocked.ok) {
		assert.match(blocked.error, /rebind\.attacker\.example/);
		assert.match(blocked.error, /ADDARR_ALLOWED_HOSTS/);
	}
});
