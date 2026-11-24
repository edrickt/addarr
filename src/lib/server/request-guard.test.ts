import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossSiteVerdict } from './request-guard.ts';

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
