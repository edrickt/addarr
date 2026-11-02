import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateQueue, parseTimeleft, seriesStatus, movieStatus } from './status.ts';
import { STATIC_MEMBER_STATES } from './presentation.ts';

test('F-MEMBER-01: missing and unreleased keep polling (only available is static)', () => {
	assert.equal(STATIC_MEMBER_STATES.has('available'), true);
	assert.equal(STATIC_MEMBER_STATES.has('missing'), false);
	assert.equal(STATIC_MEMBER_STATES.has('unreleased'), false);
});

test('F-MEMBER-02: airing series with all aired episodes is available, not partial', () => {
	const s = seriesStatus({ statistics: { episodeFileCount: 10, episodeCount: 10, totalEpisodeCount: 20 } }, []);
	assert.equal(s.state, 'available');
});

test('F-MEMBER-02: unaired series reports unreleased, aired-missing reports missing', () => {
	assert.equal(seriesStatus({ statistics: { episodeFileCount: 0, episodeCount: 0, totalEpisodeCount: 20 } }, []).state, 'unreleased');
	assert.equal(
		seriesStatus({ statistics: { episodeFileCount: 0, episodeCount: 10, totalEpisodeCount: 20 } }, []).state,
		'missing'
	);
	assert.equal(
		seriesStatus({ statistics: { episodeFileCount: 5, episodeCount: 10, totalEpisodeCount: 20 } }, []).state,
		'partial'
	);
});

test('F-MEMBER-05: progress is clamped to 0-100', () => {
	assert.equal(aggregateQueue([{ size: 100, sizeleft: 150, status: 'downloading' }]).progress, 0);
	assert.equal(aggregateQueue([{ size: 100, sizeleft: -50, status: 'downloading' }]).progress, 100);
});

test('F-MEMBER-06: day-prefixed durations parse, bad minutes reject', () => {
	assert.equal(parseTimeleft('02:03:04'), 7384);
	assert.equal(parseTimeleft('1.02:03:04'), 93784);
	assert.equal(parseTimeleft('00:99:99'), null);
	assert.equal(parseTimeleft('garbage'), null);
});

test('F-MEMBER-10: movie states distinguish missing from unreleased', () => {
	assert.equal(movieStatus({ hasFile: true }, []).state, 'available');
	assert.equal(movieStatus({ isAvailable: true }, []).state, 'missing');
	assert.equal(movieStatus({}, []).state, 'unreleased');
});
