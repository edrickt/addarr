import type { ArrItemState } from './status.js';

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
	missing: 'Missing',
	unreleased: 'Unreleased'
};

/** States that do not change on their own — polling them is wasted work. */
export const STATIC_MEMBER_STATES: ReadonlySet<ArrItemState> = new Set([
	'available',
	'missing',
	'unreleased'
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

export function formatTimeLeft(seconds: number): string {
	if (seconds < 60) return 'under a minute';
	if (seconds < 90 * 60) return `${Math.round(seconds / 60)}m`;
	return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
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
