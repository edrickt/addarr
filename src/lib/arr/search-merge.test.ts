import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	LIBRARY_NOT_CONNECTED,
	mergeSearchResponses,
	type SearchKind,
	type SearchPayload
} from './search-merge.ts';
import type { PosterCard } from './types.ts';

function card(sourceId: number, title: string): PosterCard {
	return { sourceId, title, year: 2024, overview: '', posterUrl: null, inLibrary: false };
}

function settled(
	responses: (SearchPayload | Error)[]
): PromiseSettledResult<SearchPayload>[] {
	return responses.map((response) =>
		response instanceof Error
			? { status: 'rejected', reason: response }
			: { status: 'fulfilled', value: response }
	);
}

const KINDS: SearchKind[] = ['movie', 'series'];

test('AUD-03: an unconfigured service does not read as an unreachable library', () => {
	// Households may connect only Radarr (or only Sonarr). The unknown half must
	// be skipped silently, not turn every search into a red error banner.
	const merged = mergeSearchResponses(
		KINDS,
		settled([{ results: [card(1, 'Dune')] }, { results: [], unconfigured: true }])
	);

	assert.deepEqual(
		merged.cards.map((c) => [c.kind, c.title]),
		[['movie', 'Dune']]
	);
	assert.equal(merged.error, null);
	assert.equal(merged.partialError, null, 'a not-connected library is not a partial failure');
});

test('AUD-03: no connected service reports that settings are unfinished', () => {
	const merged = mergeSearchResponses(
		KINDS,
		settled([
			{ results: [], unconfigured: true },
			{ results: [], unconfigured: true }
		])
	);

	assert.deepEqual(merged.cards, []);
	assert.equal(merged.error, LIBRARY_NOT_CONNECTED);
	assert.equal(merged.partialError, null);
});

test('AUD-03-R: a connected library with zero matches is "nothing found", not a setup error', () => {
	// One-service household whose connected arr simply has no match for the
	// term: the red "library is not connected yet" alert must not appear.
	const merged = mergeSearchResponses(
		KINDS,
		settled([{ results: [] }, { results: [], unconfigured: true }])
	);

	assert.deepEqual(merged.cards, []);
	assert.equal(merged.error, null, 'a connected, empty search is not a setup failure');
	assert.equal(merged.partialError, null);
});

test('AUD-03-R: a single requested kind that is not connected still reports settings', () => {
	const merged = mergeSearchResponses(['series'], settled([{ results: [], unconfigured: true }]));

	assert.deepEqual(merged.cards, []);
	assert.equal(merged.error, LIBRARY_NOT_CONNECTED);
});

test('AUD-03: an actually unreachable library still surfaces a partial error', () => {
	const merged = mergeSearchResponses(
		KINDS,
		settled([{ results: [card(2, 'Severance')] }, { error: 'The library is not responding right now' }])
	);

	assert.equal(merged.cards.length, 1);
	assert.equal(merged.error, null);
	assert.match(String(merged.partialError), /instead/);
});

test('AUD-03: both libraries failing keeps the first upstream error', () => {
	const merged = mergeSearchResponses(
		KINDS,
		settled([
			{ error: 'The library is not responding right now' },
			{ error: 'other' }
		])
	);

	assert.deepEqual(merged.cards, []);
	assert.equal(merged.error, 'The library is not responding right now');
});

test('AUD-03: a non-array body counts as a failure, not as a result set', () => {
	const merged = mergeSearchResponses(KINDS, settled([{ error: 'Search failed' }, { results: [] }]));

	assert.deepEqual(merged.cards, []);
	assert.equal(merged.error, 'Search failed');
});
