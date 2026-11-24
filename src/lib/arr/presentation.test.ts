import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	MEMBER_STATE_LABEL,
	calendarWindow,
	formatArrTime,
	formatBytes,
	formatTimeLeft,
	initials,
	localDateString,
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

/** AD-07: the minutes component was rounded, so 01:59:59 rendered "1h 60m". */
test('AD-07: time left never renders a 60-minute component', () => {
	assert.equal(formatTimeLeft(7199), '1h 59m', '01:59:59 is "1h 59m", not "1h 60m"');
	assert.equal(formatTimeLeft(10799), '2h 59m');
	assert.equal(formatTimeLeft(21599), '5h 59m');
	// Everything else keeps its shape.
	assert.equal(formatTimeLeft(3600), '60m');
	assert.equal(formatTimeLeft(5400), '1h 30m');
	assert.equal(formatTimeLeft(7200), '2h 0m');
	assert.equal(formatTimeLeft(3599), '60m');

	for (let seconds = 0; seconds <= 90 * 3600; seconds += 37) {
		assert.doesNotMatch(formatTimeLeft(seconds), / 60m$/, `${seconds}s rendered a 60-minute component`);
	}
});

/** AD-09: GLOSSARY.md names the member-facing states and lists the *arr words
 * ("Missing", "Unreleased") as ones to avoid — the shipped labels used exactly
 * those two. */
test('AD-09: member labels use the glossary vocabulary, never *arr jargon', () => {
	assert.equal(memberStateLabel('missing'), 'Still looking');
	assert.equal(memberStateLabel('unreleased'), 'Not out yet');

	const jargon = ['Missing', 'Unreleased', 'wanted', 'monitored', 'Quality'];
	for (const [state, label] of Object.entries(MEMBER_STATE_LABEL)) {
		for (const word of jargon) {
			assert.doesNotMatch(label, new RegExp(`\\b${word}\\b`, 'i'), `${state} label "${label}" leaks jargon`);
		}
	}
});

/**
 * AD-08: the console calendar asked the arr for a UTC-day window
 * (`toISOString().slice(0,10)`), so a household in Detroit at 20:30 asked for
 * *tomorrow* as the start and tonight's releases were missing; timestamps were
 * printed by chopping the ISO string, showing UTC as if it were local.
 * The child process pins the zone so the assertion is not at the mercy of the
 * machine running the suite.
 */
test('AD-08: the calendar window is built from local calendar days', () => {
	// Local components, so this holds in any zone the suite runs in.
	const now = new Date(2026, 10, 24, 20, 30);
	assert.equal(localDateString(now), '2026-11-24');
	assert.deepEqual(calendarWindow(14, now), { start: '2026-11-24', end: '2026-12-08' });
	// Month and year rollovers are calendar arithmetic, not 30-day blocks.
	assert.deepEqual(calendarWindow(10, new Date(2026, 11, 25, 23, 59)), {
		start: '2026-12-25',
		end: '2027-01-04'
	});
});

test('AD-08: arr timestamps render as local time, date-only values do not shift', () => {
	// 02:00Z is 21:00 the evening before in Detroit; in any zone this must not
	// look like the raw ISO string.
	assert.equal(formatArrTime('2026-11-25T02:00:00Z', 'en-US'), '11/24/26, 9:00 PM');
	assert.equal(formatArrTime('2026-11-25T02:00:00', 'en-US'), '11/24/26, 9:00 PM', 'no zone means UTC');
	assert.equal(formatArrTime('2026-11-25', 'en-US'), 'Nov 25, 2026', 'a calendar date keeps its day');
	assert.equal(formatArrTime('', 'en-US'), '');
	assert.equal(formatArrTime(null, 'en-US'), '');
	assert.equal(formatArrTime('not a date', 'en-US'), 'not a date');
});

test('AD-08: in America/Detroit the window starts today and the timestamp reads as evening', () => {
	const script = `
		const m = await import(${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, 'presentation.ts')).href)});
		const now = new Date(2026, 10, 24, 20, 30, 0);
		console.log(JSON.stringify({
			start: m.calendarWindow(14, now).start,
			when: m.formatArrTime('2026-11-25T02:00:00Z', 'en-US')
		}));
	`;
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		env: { ...process.env, TZ: 'America/Detroit' },
		encoding: 'utf8'
	});
	assert.equal(run.status, 0, run.stderr);
	const out = JSON.parse(run.stdout.trim()) as { start: string; when: string };
	assert.equal(out.start, '2026-11-24', 'the window starts on the local day, not UTC tomorrow');
	assert.equal(out.when, '11/24/26, 9:00 PM', 'UTC is not presented as local');
});
