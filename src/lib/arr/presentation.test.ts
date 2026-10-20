import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	formatBytes,
	formatTimeLeft,
	initials,
	memberProgressBar,
	memberStateDetail,
	memberStateLabel,
	memberStateTone
} from './presentation.ts';

test('member state labels are readable and hide problem-state jargon', () => {
	assert.equal(memberStateLabel('downloading'), 'Downloading');
	assert.equal(memberStateLabel('attention'), 'Waiting');
	assert.equal(memberStateLabel('available'), 'In library');
	assert.equal(memberStateLabel('partial', { have: 3, total: 8 }), '3 of 8');
});

test('member state tones match the poster-card vocabulary', () => {
	assert.equal(memberStateTone('downloading'), 'active');
	assert.equal(memberStateTone('paused'), 'warn');
	assert.equal(memberStateTone('attention'), 'muted');
	assert.equal(memberStateTone('available'), 'ok');
});

test('time-left formatting switches from minutes to hours', () => {
	assert.equal(formatTimeLeft(30), 'under a minute');
	assert.equal(formatTimeLeft(600), '10m');
	assert.equal(formatTimeLeft(5400), '1h 30m');
});

test('poster initials use the first two words', () => {
	assert.equal(initials('The Bear'), 'TB');
	assert.equal(initials('  severance  '), 'S');
	assert.equal(initials(''), '');
});

test('byte formatting handles unknown, zero, and units', () => {
	assert.equal(formatBytes(null), '—');
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(1536), '1.5 KB');
});

test('progress bars only appear for active acquisition states', () => {
	assert.deepEqual(memberProgressBar('queued', null), {
		mode: 'indeterminate',
		progress: null,
		tone: 'primary'
	});
	assert.deepEqual(memberProgressBar('downloading', 40), {
		mode: 'determinate',
		progress: 40,
		tone: 'primary'
	});
	assert.deepEqual(memberProgressBar('paused', 20), {
		mode: 'determinate',
		progress: 20,
		tone: 'warning'
	});
	assert.equal(memberProgressBar('available', null), null);
	assert.equal(memberProgressBar('attention', null), null);
});

test('detail text only adds information beyond the badge', () => {
	assert.equal(
		memberStateDetail('downloading', { timeLeftSeconds: 600 }),
		'10m left'
	);
	assert.equal(
		memberStateDetail('partial', { episodes: { have: 3, total: 8 } }),
		'3 of 8 episodes'
	);
	assert.equal(memberStateDetail('queued', {}), null);
});
