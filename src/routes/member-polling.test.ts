import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

/**
 * AD-04: when `/api/status/batch` failed (one arr's queue 5xx, or a timeout)
 * the poster page fell back to `/api/status/:kind/:id` for every watched card,
 * and each of those calls re-read the whole paginated queue. With a 1,200-row
 * queue and 6 cards that was 32 upstream requests per 5 s tick, aimed at the
 * arr that was already failing.
 *
 * The suites have no DOM harness (see console/paging.test.ts), so this pins the
 * shape: the poller talks to the batch endpoint and to nothing else.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, '+page.svelte'), 'utf8');
const CODE = compile(SOURCE, { generate: 'client', filename: '+page.svelte' }).js.code;

test('AD-04: the member poller never fans out to per-item status requests', () => {
	assert.match(CODE, /\/api\/status\/batch\?/, 'the poller still uses the batch endpoint');
	assert.doesNotMatch(
		CODE,
		/\/api\/status\/\$\{/, // `/api/status/${card.kind}/...`
		'a failed batch must not become one full-queue request per card'
	);
	assert.doesNotMatch(CODE, /[`'"]\/api\/status\/[^b]/, 'no per-item status requests from the page');
});

test('AD-04: the batched state is still applied to every watched card', () => {
	// Guard against "fixing" the cascade by dropping the update instead.
	assert.match(CODE, /card\.watchStatus = state/);
	assert.match(CODE, /card\.watchProgress = data\.progress/);
	assert.match(CODE, /is in the library now/);
});
