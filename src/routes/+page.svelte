<script lang="ts">
	import type { PosterCard } from '$lib/arr/types';
import type { ArrItemState } from '$lib/arr/status';

	type WatchState = ArrItemState;

	type Result = PosterCard & {
		kind: 'movie' | 'series';
		watchId?: number;
		watchStatus?: WatchState;
		watchProgress?: number | null;
		watchTimeLeft?: number | null;
		watchEpisodes?: { have: number; total: number } | null;
	};

	type Mode = 'all' | 'movie' | 'series';

	let q = $state('');
	let mode = $state<Mode>('all');
	let results = $state<Result[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	// Set when one backend answers but the other doesn't — the member sees
	// half the catalog and deserves to know which half is missing.
	let partialError = $state<string | null>(null);
	// Screen-reader announcement channel for add + watch-state transitions.
	let announce = $state('');
	let toast = $state<string | null>(null);
	let toastIsError = $state(false);
	let toastRetry = $state<(() => void) | null>(null);
	let retryTick = $state(0);
	// Keyed by kind + sourceId — a movie and a series can share a sourceId.
	let busyId = $state<string | null>(null);

	let searchSeq = 0;

	$effect(() => {
		const term = q.trim();
		const m = mode;
		retryTick; // re-run when the member taps Retry after a failure
		if (term.length < 2) {
			results = [];
			loading = false;
			error = null;
			partialError = null;
			return;
		}

		const seq = ++searchSeq;
		const timer = setTimeout(async () => {
			loading = true;
			error = null;
			const kinds: ('movie' | 'series')[] = m === 'all' ? ['movie', 'series'] : [m];
			const settled = await Promise.allSettled(
				kinds.map((k) =>
					fetch(`/api/search?service=${k}&q=${encodeURIComponent(term)}`).then((r) => r.json())
				)
			);
			if (seq !== searchSeq) return;

			const merged: Result[] = [];
			let firstError: string | null = null;
			let failedKind: 'movie' | 'series' | null = null;
			settled.forEach((s, i) => {
				if (s.status === 'fulfilled' && Array.isArray(s.value.results)) {
					for (const card of s.value.results as PosterCard[]) {
						// In-library items carry their real *arr state — wire them into
						// the same watch fields so the poller keeps them live.
						merged.push({
							...card,
							kind: kinds[i],
							watchId: card.status ? card.id : undefined,
							watchStatus: card.status?.state,
							watchProgress: card.status?.progress ?? null,
							watchTimeLeft: card.status?.timeLeftSeconds ?? null,
							watchEpisodes: card.status?.episodes ?? null
						});
					}
				} else {
					failedKind = kinds[i];
					if (!firstError) {
						firstError =
							s.status === 'fulfilled'
								? (s.value.error ?? 'Search failed')
								: 'Search failed — try again';
					}
				}
			});
			results = merged;
			// Announce the result count — the only way a screen-reader user
			// knows the grid changed.
			announce = merged.length === 0 ? 'Nothing found' : `${merged.length} results`;
			if (merged.length === 0) {
				error = firstError;
				partialError = null;
			} else if (failedKind) {
				error = null;
				partialError =
					failedKind === 'movie'
						? "Couldn't reach the movie library — showing series instead."
						: "Couldn't reach the series library — showing movies instead.";
			} else {
				error = null;
				partialError = null;
			}
			loading = false;
		}, 350);
		return () => clearTimeout(timer);
	});

	async function add(card: Result) {
		busyId = `${card.kind}:${card.sourceId}`;
		try {
			const res = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ service: card.kind, id: card.sourceId })
			});
			const data = await res.json();
			if (res.ok) {
				// Don't set inLibrary here — the item is only *monitored* until it's
				// actually on disk. The watch badge tracks acquisition instead.
				if (typeof data.id === 'number') {
					card.watchId = data.id;
					card.watchStatus = 'queued';
				}
				const message =
					data.searchQueued === false
						? `Added “${card.title}”`
						: `Added “${card.title}” — searching now`;
				announce = message;
				showToast(message);
			} else {
				showToast(`Couldn't add: ${data.error ?? 'unknown error'}`, true, () => add(card));
			}
		} catch {
			showToast("Couldn't add — network error", true, () => add(card));
		} finally {
			busyId = null;
		}
	}

	function showToast(
		text: string,
		isError = false,
		retry: (() => void) | null = null,
		duration = isError ? 8000 : 4000
	) {
		toast = text;
		toastIsError = isError;
		toastRetry = retry;
		setTimeout(() => {
			if (toast === text) toast = null;
		}, duration);
	}

	// Poll the add-status badge for recently added items (decision D4).
	// One grid-wide self-scheduling timer: 5s while any watched card is
	// downloading, 20s otherwise (council decision — warning states keep
	// polling so cards self-heal when an admin clears them).
	$effect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const tick = async () => {
			if (cancelled) return;
			const watching = results.filter(
				(r) =>
					r.watchId &&
					r.watchStatus &&
					!STATIC_STATES.has(r.watchStatus)
				);
			if (watching.length > 0) {
				for (const card of watching) {
					try {
						const res = await fetch(`/api/status/${card.kind}/${card.watchId}`);
						if (!res.ok) continue;
						const data = await res.json();
						if (data.state !== card.watchStatus) {
							announce =
								data.state === 'available'
									? `${card.title} is in the library now`
									: `${card.title}: still on its way`;
						}
						card.watchStatus = data.state;
						card.watchProgress = data.progress ?? null;
						card.watchTimeLeft = data.timeLeftSeconds ?? null;
						card.watchEpisodes = data.episodes ?? null;
						if (data.state === 'available') {
							card.inLibrary = true;
							// The emotional peak — give it a longer window on screen.
							showToast(`“${card.title}” is available`, false, null, 8000);
						}
					} catch {
						/* transient — keep last state */
					}
				}
			}
			if (cancelled) return;
			const anyDownloading = results.some((r) => r.watchStatus === 'downloading');
			timer = setTimeout(tick, anyDownloading ? 5000 : 20000);
		};
		timer = setTimeout(tick, 5000);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	// Member-facing vocabulary — the only place labels are worded.
	// Problem states are hidden from members on purpose: the badge shows a
	// neutral, truthful "Waiting" while the admin sees the real state in the
	// console. Failures route to the admin, not the household.
	const WATCH_LABEL: Record<Exclude<WatchState, 'available'>, string> = {
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

	// States that never change on their own — no point polling them.
	const STATIC_STATES: ReadonlySet<WatchState> = new Set(['available', 'missing', 'unreleased']);

	/** Short badge text shown on the poster. */
	function badgeText(card: Result): string {
		const s = card.watchStatus;
		if (!s || s === 'available') return 'In library';
		if (s === 'partial' && card.watchEpisodes) {
			return `${card.watchEpisodes.have} of ${card.watchEpisodes.total}`;
		}
		return WATCH_LABEL[s].replace(/…$/, '');
	}

	function badgeTone(card: Result): 'ok' | 'active' | 'warn' | 'muted' {
		switch (card.watchStatus) {
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

	/** Detail line under the poster — only when it adds info beyond the badge. */
	function watchDetail(card: Result): string | null {
		const s = card.watchStatus;
		if (!s || s === 'available' || s === 'missing' || s === 'unreleased') return null;
		if (s === 'downloading' && card.watchTimeLeft != null) return `${fmtLeft(card.watchTimeLeft)} left`;
		if (s === 'partial' && card.watchEpisodes) {
			return `${card.watchEpisodes.have} of ${card.watchEpisodes.total} episodes`;
		}
		if (s === 'attention') return null; // hidden from members — admin sees it in the console
		if (s === 'waiting' || (s === 'downloading' && card.watchTimeLeft == null)) return WATCH_LABEL[s];
		return null; // queued/paused/importing/attention — the badge already says it
	}

	function fmtLeft(seconds: number): string {
		if (seconds < 60) return 'under a minute';
		if (seconds < 90 * 60) return `${Math.round(seconds / 60)}m`;
		return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
	}

	type Bar = { mode: 'determinate' | 'indeterminate'; progress: number | null; tone: 'primary' | 'muted' | 'warning' } | null;

	function watchBar(card: Result): Bar {
		const s = card.watchStatus!;
		const p = card.watchProgress ?? null;
		switch (s) {
			case 'downloading':
				return p != null ? { mode: 'determinate', progress: p, tone: 'primary' } : { mode: 'indeterminate', progress: null, tone: 'primary' };
			case 'queued':
				return { mode: 'indeterminate', progress: null, tone: 'primary' };
			case 'importing':
				return { mode: 'indeterminate', progress: null, tone: 'primary' };
			case 'paused':
				return p != null ? { mode: 'determinate', progress: p, tone: 'warning' } : { mode: 'indeterminate', progress: null, tone: 'warning' };
			case 'partial':
				return p != null ? { mode: 'determinate', progress: p, tone: 'muted' } : null;
			default:
				return null; // waiting, available — no bar
		}
	}

	const modes: { key: Mode; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'movie', label: 'Movies' },
		{ key: 'series', label: 'Series' }
	];

	function initials(title: string): string {
		const parts = title.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '';
		return parts
			.slice(0, 2)
			.map((w) => w[0]!.toUpperCase())
			.join('');
	}
</script>

<svelte:head>
	<title>Addarr</title>
</svelte:head>

<h1 class="sr-only">Search</h1>

<div class="search-bar">
	<input
		class="search-input"
		bind:value={q}
		placeholder="Search for a movie or series…"
		aria-label="Search for a movie or series"
		autocomplete="off"
	/>
	<div class="mode-tabs" role="group" aria-label="Media type">
		{#each modes as m (m.key)}
			<button
				type="button"
				class="tab"
				class:active={mode === m.key}
				aria-pressed={mode === m.key}
				onclick={() => (mode = m.key)}
			>
				{m.label}
			</button>
		{/each}
	</div>
</div>

{#if loading}
	<p class="hint">Searching…</p>
{:else if error}
	<p class="msg error" role="alert">
		{error}
		<button class="secondary retry-btn" onclick={() => retryTick++}>Retry</button>
	</p>
{:else if partialError}
	<p class="msg error" role="alert">
		{partialError}
		<button class="secondary retry-btn" onclick={() => retryTick++}>Retry</button>
	</p>
{:else if q.trim().length >= 2 && results.length === 0}
	<p class="hint">Nothing found. Try another title?</p>
{:else if results.length === 0}
	<p class="hint empty-invite">Type a movie or series name above — one tap and it's on its way to your library.</p>
{/if}

<div class="sr-only" aria-live="assertive">{announce}</div>

<div class="grid">
	{#each results as card (card.kind + card.sourceId)}
		<div class="poster-card" class:owned={card.inLibrary}>
			<div class="poster-wrap">
				<div class="poster-fallback mono">{initials(card.title)}</div>
				{#if card.posterUrl}
					<img
						src={card.posterUrl}
						alt=""
						loading="lazy"
						onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
					/>
				{/if}
				{#if card.watchStatus}
					<span
						class="badge"
						class:active={badgeTone(card) === 'active'}
						class:warn={badgeTone(card) === 'warn'}
						class:muted={badgeTone(card) === 'muted'}
					>
						{badgeText(card)}
					</span>
				{:else if card.inLibrary}
					<span class="badge">In library</span>
				{/if}
				{#if card.watchStatus && card.watchStatus !== 'available'}
					{@const bar = watchBar(card)}
					{#if bar}
						<div class="progress" aria-hidden="true">
							<div
								class="progress-fill"
								class:indeterminate={bar.mode === 'indeterminate'}
								class:tone-muted={bar.tone === 'muted'}
								class:tone-warning={bar.tone === 'warning'}
								style={bar.mode === 'determinate' ? `transform: scaleX(${Math.min(1, Math.max(0, (bar.progress ?? 0) / 100))})` : ''}
							></div>
						</div>
					{/if}
				{/if}
				{#if watchDetail(card)}
					<span class="watch">
						<span class="dot" class:warn={card.watchStatus === 'attention' || card.watchStatus === 'paused'}></span>
						{watchDetail(card)}
					</span>
				{/if}
			</div>
			<div class="poster-meta">
				<p class="title" title={card.title}>{card.title}</p>
				<p class="year">{card.year ?? ''}</p>
				{#if card.inLibrary}
					<span class="added-chip">In library</span>
				{:else if card.watchStatus && card.watchStatus !== 'available'}
					<span class="added-chip">Added</span>
				{:else}
					<button
						onclick={() => add(card)}
						disabled={busyId === `${card.kind}:${card.sourceId}`}
					>
						{busyId === `${card.kind}:${card.sourceId}` ? 'Adding…' : 'Add'}
					</button>
				{/if}
			</div>
		</div>
	{/each}
</div>

{#if toast}
	<div class="toast" class:error={toastIsError} role={toastIsError ? 'alert' : 'status'}>
		{toast}
		{#if toastRetry}
			<button
				class="toast-retry"
				onclick={() => {
					const r = toastRetry;
					toast = null;
					r?.();
				}}
			>Retry</button>
		{/if}
	</div>
{/if}

<style>
	.search-bar {
		margin-bottom: 1.5rem;
	}
	.search-input {
		font-size: 1.15rem;
		padding: 0.8rem 1rem;
	}
	.mode-tabs {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.6rem;
	}
	.tab {
		margin-top: 0;
		min-height: 2.75rem;
		background: var(--card);
		border: 1px solid var(--border);
		color: var(--muted-foreground);
		font-weight: 500;
		padding: 0.55rem 1rem;
		border-radius: var(--radius);
	}
	.tab.active {
		background: var(--foreground);
		border-color: var(--foreground);
		color: var(--background);
		font-weight: 450;
	}
	.grid {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		/* Center partial rows — on phones a 2-card row leaves stray space
	   that otherwise piles up on the right. */
		justify-content: center;
	}
	.poster-card {
		width: 150px;
		/* Column layout so the Add button/chip pins to the card bottom —
	   one- and two-line titles keep their actions on the same baseline. */
		display: flex;
		flex-direction: column;
	}
	.poster-meta {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.poster-card:hover .poster-wrap {
		border-color: var(--border-strong);
		transform: translateY(-2px);
	}
	.poster-wrap {
		transition:
			border-color 150ms ease,
			transform 150ms ease;
	}
	.poster-wrap {
		position: relative;
		aspect-ratio: 2 / 3;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--elevated);
		border: 1px solid var(--border);
	}
	.poster-wrap img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.poster-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 1.6rem;
		color: var(--muted-foreground);
		letter-spacing: 0.05em;
	}
	.badge {
		position: absolute;
		top: 6px;
		left: 6px;
		background: var(--success);
		color: var(--primary-foreground);
		font-size: 0.7rem;
		font-weight: 450;
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius);
	}
	.badge.active {
		background: var(--primary);
	}
	.badge.warn {
		background: color-mix(in srgb, var(--warning) 80%, var(--foreground));
	}
	.badge.muted {
		background: color-mix(in srgb, var(--muted-foreground) 80%, var(--foreground));
	}
	.watch {
		display: block;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		min-height: 1rem;
	}
	.watch:has(.dot.warn) {
		color: var(--foreground);
	}
	.progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		background: color-mix(in srgb, var(--border) 75%, transparent);
	}
	.progress-fill {
		height: 100%;
		width: 100%;
		background: var(--primary);
		transform-origin: left;
		transition: transform 1s ease;
	}
	.progress-fill.tone-muted {
		background: var(--muted-foreground);
	}
	.progress-fill.tone-warning {
		background: var(--warning);
		transition: none;
	}
	.progress-fill.indeterminate {
		width: 25%;
		transform: none;
		transition: none;
		animation: progress-slide 1.4s ease-in-out infinite;
	}
	@keyframes progress-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(400%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.progress-fill.indeterminate {
			animation: none;
		}
	}
	.poster-meta .title {
		margin: 0.45rem 0 0;
		font-size: 0.85rem;
		font-weight: 450;
		line-height: 1.25;
		/* Reserve the full two-line height so short titles don't shift the
	   year and action relative to longer ones. */
		min-height: 2.125rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.poster-meta .year {
		margin: 0.1rem 0 0.4rem;
		color: var(--muted-foreground);
		font-size: 0.8rem;
		min-height: 1rem;
	}
	/* Add button and the In library/Added chip must be the same box so the
	   card doesn't jump when an item's state changes. Fixed height + flex
	   centering keeps UA line-height/border quirks from shifting either. */
	.poster-card button {
		margin-top: auto;
		width: 100%;
		height: 2.75rem;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.95rem;
	}
	.added-chip {
		margin-top: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 2.75rem;
		padding: 0;
		box-sizing: border-box;
		font-size: 0.95rem;
		color: var(--muted-foreground);
		background: var(--elevated);
		border: 1px solid var(--border);
	}
	.empty-invite {
		margin-top: 2.5rem;
		max-width: 34rem;
	}
	.retry-btn {
		margin-top: 0;
		margin-left: 0.6rem;
		padding: 0.2rem 0.7rem;
		font-size: 0.8rem;
		vertical-align: middle;
	}
	.hint {
		color: var(--muted-foreground);
	}
	.toast {
		position: fixed;
		bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		max-width: min(calc(100vw - 2rem), 34rem);
		box-sizing: border-box;
		text-align: center;
		background: var(--success);
		color: var(--primary-foreground);
		font-weight: 450;
		padding: 0.7rem 1.3rem;
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
	}
	.toast.error {
		background: var(--destructive);
		color: var(--primary-foreground);
	}
	.toast-retry {
		margin-top: 0;
		margin-left: 0.75rem;
		padding: 0.45rem 0.9rem;
		font-size: 0.85rem;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--primary-foreground) 55%, transparent);
		color: var(--primary-foreground);
	}
</style>
