import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAddResource, type SonarrSeries } from './add-resource.ts';
import type { AddDefaults } from './types.ts';

const series: SonarrSeries = {
	title: 'Breaking Bad',
	year: 2008,
	tvdbId: 81189,
	titleSlug: 'breaking-bad',
	seriesType: 'standard',
	// season 0 (specials) present on purpose: it must never be monitored
	seasons: [0, 1, 2, 3, 4, 5].map((seasonNumber) => ({ seasonNumber, monitored: false }))
};

function defaults(overrides: Partial<AddDefaults> = {}): AddDefaults {
	return {
		qualityProfileId: 1,
		rootFolderPath: '/tv',
		monitored: true,
		tags: [],
		searchOnAdd: true,
		seriesType: 'standard',
		seasonMonitorPolicy: 'all',
		...overrides
	};
}

const numbered = (flags: Record<number, boolean>) =>
	[1, 2, 3, 4, 5].map((seasonNumber) => ({ seasonNumber, monitored: flags[seasonNumber] ?? false }));

test('never sends addOptions.monitor — Sonarr treats it as authoritative and unmonitors everything', () => {
	const resource = buildAddResource(series, defaults());
	assert.equal('monitor' in resource.addOptions, false);
});

test('series monitored flag mirrors the preset', () => {
	assert.equal(buildAddResource(series, defaults()).monitored, true);
	assert.equal(buildAddResource(series, defaults({ monitored: false })).monitored, false);
});

test('season policy "all" monitors every numbered season', () => {
	const resource = buildAddResource(series, defaults({ seasonMonitorPolicy: 'all' }));
	assert.deepEqual(resource.seasons, numbered({ 1: true, 2: true, 3: true, 4: true, 5: true }));
});

test('season policy "none" monitors no seasons while the series stays per preset', () => {
	const resource = buildAddResource(series, defaults({ seasonMonitorPolicy: 'none' }));
	assert.deepEqual(resource.seasons, numbered({}));
	assert.equal(resource.monitored, true);
});

test('season policy "first" monitors only the earliest season', () => {
	const resource = buildAddResource(series, defaults({ seasonMonitorPolicy: 'first' }));
	assert.deepEqual(resource.seasons, numbered({ 1: true }));
});

test('season policy "latest" monitors only the most recent season', () => {
	const resource = buildAddResource(series, defaults({ seasonMonitorPolicy: 'latest' }));
	assert.deepEqual(resource.seasons, numbered({ 5: true }));
});

test('search-on-add maps to searchForMissingEpisodes', () => {
	assert.equal(buildAddResource(series, defaults()).addOptions.searchForMissingEpisodes, true);
	assert.equal(buildAddResource(series, defaults({ searchOnAdd: false })).addOptions.searchForMissingEpisodes, false);
});

test('carries the rest of the add resource from preset + series', () => {
	const r = buildAddResource(series, defaults());
	assert.equal(r.qualityProfileId, 1);
	assert.equal(r.rootFolderPath, '/tv');
	assert.equal(r.seriesType, 'standard');
	assert.equal(r.tvdbId, 81189);
	assert.equal(r.titleSlug, 'breaking-bad');
});
