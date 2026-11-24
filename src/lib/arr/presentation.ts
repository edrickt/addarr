import type { ArrItemState } from './status.ts';

/**
 * Member-facing acquisition vocabulary. The poster grid, the Downloads tab,
 * and the shared detail sheet all read from here so a state never gets two
 * different labels.
 */

export const MEMBER_STATE_LABEL: Record<Exclude<ArrItemState, 'available'>, string> = {
	waiting: 'Looking for it…',
	queued: 'Queued',
	paused: 'Paused',
	downloading: 'Downloading…',
	importing: 'Importing…',
	partial: 'Episodes',
	attention: 'Waiting',
	// GLOSSARY.md is the member-vocabulary contract: "Still looking" and
	// "Not out yet" are the member words; Missing/Unreleased are admin-side
	// *arr state names this screen must never show (AD-09).
	missing: 'Still looking',
	unreleased: 'Not out yet'
};

/** Terminal states — only `available` never changes on its own. `missing` and
 * `unreleased` self-heal (release dates pass, arrs catch up), so they keep
 * polling at the slow cadence instead of freezing. */
export const STATIC_MEMBER_STATES: ReadonlySet<ArrItemState> = new Set([
	'available'
]);

export type MemberStateTone = 'ok' | 'active' | 'warn' | 'muted';

export function memberStateLabel(
	state: ArrItemState,
	episodes?: { have: number; total: number } | null
): string {
	if (state === 'available') return 'In library';
	if (state === 'partial' && episodes) return `${episodes.have} of ${episodes.total}`;
	return MEMBER_STATE_LABEL[state].replace(/…$/, '');
}

export function memberStateTone(state: ArrItemState): MemberStateTone {
	switch (state) {
		case 'downloading':
		case 'queued':
		case 'importing':
			return 'active';
		case 'paused':
			return 'warn';
		case 'attention':
		case 'partial':
		case 'missing':
		case 'unreleased':
		case 'waiting':
			return 'muted';
		default:
			return 'ok'; // available
	}
}

/** Detail line shown under a badge — only when it adds information. */
export function memberStateDetail(
	state: ArrItemState,
	opts: {
		timeLeftSeconds?: number | null;
		episodes?: { have: number; total: number } | null;
	}
): string | null {
	if (state === 'downloading' && opts.timeLeftSeconds != null) {
		return `${formatTimeLeft(opts.timeLeftSeconds)} left`;
	}
	if (state === 'partial' && opts.episodes) {
		return `${opts.episodes.have} of ${opts.episodes.total} episodes`;
	}
	if (state === 'attention') return null; // hidden from members — admin sees it in the console
	if (state === 'waiting' || (state === 'downloading' && opts.timeLeftSeconds == null)) {
		return MEMBER_STATE_LABEL[state];
	}
	return null;
}

export type ProgressBar = {
	mode: 'determinate' | 'indeterminate';
	progress: number | null;
	tone: 'primary' | 'muted' | 'warning';
} | null;

export function memberProgressBar(state: ArrItemState, progress?: number | null): ProgressBar {
	const p = progress ?? null;
	switch (state) {
		case 'downloading':
			return p != null
				? { mode: 'determinate', progress: p, tone: 'primary' }
				: { mode: 'indeterminate', progress: null, tone: 'primary' };
		case 'queued':
		case 'importing':
			return { mode: 'indeterminate', progress: null, tone: 'primary' };
		case 'paused':
			return p != null
				? { mode: 'determinate', progress: p, tone: 'warning' }
				: { mode: 'indeterminate', progress: null, tone: 'warning' };
		case 'partial':
			return p != null ? { mode: 'determinate', progress: p, tone: 'muted' } : null;
		default:
			return null; // waiting, attention, available, missing, unreleased
	}
}

/**
 * `YYYY-MM-DD` for a Date's *local* calendar day. The arr calendar's window is
 * a pair of local days; `toISOString().slice(0, 10)` is the UTC day, which is
 * already tomorrow for a US evening (AD-08).
 */
export function localDateString(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Local `[start, end]` window for the console calendar, `days` days ahead. */
export function calendarWindow(days: number, now: Date = new Date()): { start: string; end: string } {
	const span = Math.max(1, Math.round(days));
	const end = new Date(now);
	end.setDate(end.getDate() + span); // calendar days, not 24h blocks (DST-safe)
	return { start: localDateString(now), end: localDateString(end) };
}

/**
 * Render an *arr timestamp in the viewer's local time.
 *
 * arr sends UTC for `airDateUtc`/`digitalRelease`/history dates; slicing the ISO
 * string printed UTC as if it were local (an episode at 21:00 Detroit read
 * "02:00" on the next day). A bare `YYYY-MM-DD` is a calendar date and must not
 * be shifted into the previous day, and a timestamp without a zone designator is
 * UTC by arr convention.
 */
export function formatArrTime(value: unknown, locale?: string): string {
	const raw = String(value ?? '').trim();
	if (raw === '') return '';
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
	if (dateOnly) {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
			new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
		);
	}
	const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
	const date = new Date(zoned);
	if (Number.isNaN(date.getTime())) return raw;
	return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function formatTimeLeft(seconds: number): string {
	if (seconds < 60) return 'under a minute';
	if (seconds < 90 * 60) return `${Math.round(seconds / 60)}m`;
	// Floor both parts: rounding the minutes turned 01:59:59 into "1h 60m".
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** Two-letter poster fallback used when a title has no artwork. */
export function initials(title: string): string {
	const parts = title.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '';
	return parts
		.slice(0, 2)
		.map((word) => word[0]!.toUpperCase())
		.join('');
}

export function formatBytes(value: unknown): string {
	if (value == null || value === '') return '—';
	const v = Number(value);
	if (!Number.isFinite(v) || v < 0) return '—';
	if (v === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	let x = v;
	while (x >= 1024 && i < units.length - 1) {
		x /= 1024;
		i++;
	}
	return `${x.toFixed(1)} ${units[i]}`;
}
