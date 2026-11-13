<script lang="ts">
	import type { PosterCard } from '$lib/arr/types';
	import type { ArrItemState } from '$lib/arr/status';
	import type { DownloadDetail } from '$lib/arr/downloads';
	import { mergeSearchResponses } from '$lib/arr/search-merge';
	import DownloadSheet from '$lib/components/DownloadSheet.svelte';
	import {
		initials,
		memberProgressBar,
		memberStateDetail,
		memberStateLabel,
		memberStateTone,
		STATIC_MEMBER_STATES
	} from '$lib/arr/presentation';

	type WatchState = ArrItemState;

	type Result = PosterCard & {
		kind: 'movie' | 'series';
		watchId?: number;
		watchStatus?: WatchState;
		watchProgress?: number | null;
		watchTimeLeft?: number | null;
		watchSize?: number | null;
		watchSizeLeft?: number | null;
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
	let selectedCard = $state<Result | null>(null);

	const selectedDetail = $derived(selectedCard ? cardToDetail(selectedCard) : null);

	function cardToDetail(card: Result): DownloadDetail {
		return {
			kind: card.kind,
			id: card.watchId,
			title: card.title,
			year: card.year,
			posterUrl: card.posterUrl,
			state: card.watchStatus ?? 'waiting',
			progress: card.watchProgress ?? null,
			timeLeftSeconds: card.watchTimeLeft ?? null,
			size: card.watchSize ?? null,
			sizeLeft: card.watchSizeLeft ?? null,
			episodes: card.watchEpisodes ?? null
		};
	}

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

			// The merge (skip not-connected libraries, error/partial-error
			// precedence) lives in $lib/arr/search-merge so it is unit-tested.
			const merged = mergeSearchResponses(kinds, settled);
			results = merged.cards.map((card) => ({
				...card,
				// In-library items carry their real *arr state — wire them into the
				// same watch fields so the poller keeps them live.
				watchId: card.status ? card.id : undefined,
				watchStatus: card.status?.state,
				watchProgress: card.status?.progress ?? null,
				watchTimeLeft: card.status?.timeLeftSeconds ?? null,
				watchSize: card.status?.size ?? null,
				watchSizeLeft: card.status?.sizeLeft ?? null,
				watchEpisodes: card.status?.episodes ?? null
			}));
			error = merged.error;
			partialError = merged.partialError;
			// Announce the result count — the only way a screen-reader user
			// knows the grid changed.
			announce = results.length === 0 ? 'Nothing found' : `${results.length} results`;
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
		duration = isError ? 0 : 4000
	) {
		// Single announcement channel: the visual toast is aria-hidden; the sr-only live region announces (F-UI-05).
		announce = text;
		toast = text;
		toastIsError = isError;
		toastRetry = retry;
		if (duration > 0) {
			setTimeout(() => {
				if (toast === text) toast = null;
			}, duration);
		}
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
					!STATIC_MEMBER_STATES.has(r.watchStatus)
				);
			if (watching.length > 0) {
				// Batch: one queue fetch per service per tick (F-MEMBER-07).
				let batch: { movies?: Record<string, { state: string; progress?: number | null; timeLeftSeconds?: number | null; size?: number | null; sizeLeft?: number | null; episodes?: { have: number; total: number } | null }>; series?: Record<string, { state: string; progress?: number | null; timeLeftSeconds?: number | null; size?: number | null; sizeLeft?: number | null; episodes?: { have: number; total: number } | null }> } | null = null;
				try {
					const qs = new URLSearchParams();
					const mIds = watching.filter((c) => c.kind === 'movie').map((c) => String(c.watchId));
					const sIds = watching.filter((c) => c.kind === 'series').map((c) => String(c.watchId));
					if (mIds.length) qs.set('movies', mIds.join(','));
					if (sIds.length) qs.set('series', sIds.join(','));
					const bRes = await fetch(`/api/status/batch?${qs.toString()}`);
					if (bRes.ok) batch = await bRes.json();
				} catch {
					/* fallback to per-card below */
				}
				for (const card of watching) {
					try {
						const bData = card.kind === 'movie' ? batch?.movies?.[String(card.watchId)] : batch?.series?.[String(card.watchId)];
						let data = bData as { state: string; progress?: number | null; timeLeftSeconds?: number | null; size?: number | null; sizeLeft?: number | null; episodes?: { have: number; total: number } | null } | undefined;
						if (!data) {
							const res = await fetch(`/api/status/${card.kind}/${card.watchId}`);
							if (!res.ok) continue;
							data = (await res.json()) as NonNullable<typeof data>;
						}
						if (!data) continue;
						const state = data.state as NonNullable<typeof card.watchStatus>;
						if (state !== card.watchStatus) {
							announce =
								state === 'available'
									? `${card.title} is in the library now`
									: `${card.title}: still on its way`;
						}
						card.watchStatus = state;
						card.watchProgress = data.progress ?? null;
						card.watchTimeLeft = data.timeLeftSeconds ?? null;
						card.watchSize = data.size ?? null;
						card.watchSizeLeft = data.sizeLeft ?? null;
						card.watchEpisodes = data.episodes ?? null;
						if (state === 'available') {
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

	// Shared member-facing vocabulary — see $lib/arr/presentation.
	function badgeText(card: Result): string {
		return memberStateLabel(card.watchStatus!, card.watchEpisodes);
	}

	function badgeTone(card: Result) {
		return memberStateTone(card.watchStatus!);
	}

	function watchDetail(card: Result): string | null {
		if (!card.watchStatus) return null;
		return memberStateDetail(card.watchStatus, {
			timeLeftSeconds: card.watchTimeLeft,
			episodes: card.watchEpisodes
		});
	}

	function watchBar(card: Result) {
		return memberProgressBar(card.watchStatus!, card.watchProgress);
	}

	const modes: { key: Mode; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'movie', label: 'Movies' },
		{ key: 'series', label: 'Series' }
	];
</script>

<svelte:head>
	<title>Addarr</title>
</svelte:head>

<h1 class="sr-only">Search</h1>

<div class="search-bar">
	<p class="eyebrow">Find something to watch</p>
	<input
		class="search-input"
		type="search"
		enterkeyhint="search"
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

<div class="sr-only" aria-live="polite">{announce}</div>

{#if results.length > 0}
	<div class="list-head">
		<h2>Results</h2>
		<span>{results.length} {results.length === 1 ? 'title' : 'titles'}</span>
	</div>
{/if}

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
					<button
						class="poster-open"
						type="button"
						aria-label={`View download status for ${card.title}`}
						onclick={() => (selectedCard = card)}
					></button>
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
				{#if card.watchStatus === 'available' || (!card.watchStatus && card.inLibrary)}
					<span class="added-chip">In library</span>
				{:else if card.watchStatus}
					<span class="added-chip">Added</span>
				{:else}
					<button
						onclick={() => add(card)}
						disabled={busyId === `${card.kind}:${card.sourceId}`}
						aria-label={`Add ${card.title}`}
					>
						{busyId === `${card.kind}:${card.sourceId}` ? 'Adding…' : 'Add'}
					</button>
				{/if}
			</div>
		</div>
	{/each}
</div>

{#if selectedDetail}
	<DownloadSheet item={selectedDetail} onclose={() => (selectedCard = null)} />
{/if}

{#if toast}
	<div class="toast" class:error={toastIsError} aria-hidden="true">
		{toast}
		{#if !toastRetry && toastIsError}
			<button class="toast-retry" onclick={() => (toast = null)}>Dismiss</button>
		{/if}
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
		margin-bottom: 1.25rem;
	}
	.eyebrow {
		margin: 0 0 0.45rem;
		color: var(--muted-foreground);
		font-size: 0.68rem;
		font-weight: 500;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}
	.search-input {
		max-width: 640px;
		font-size: 1.15rem;
		padding: 0.8rem 1rem;
	}
	.mode-tabs {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.55rem;
	}
	.tab {
		margin-top: 0;
		min-height: 2.75rem;
		background: var(--card);
		border: 1px solid var(--border);
		color: var(--muted-foreground);
		font-weight: 500;
		padding: 0.45rem 0.85rem;
		font-size: 0.8rem;
		border-radius: var(--radius);
	}
	.tab.active {
		background: var(--foreground);
		border-color: var(--foreground);
		color: var(--background);
		font-weight: 450;
	}
	.list-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin: 0 0 0.7rem;
	}
	.list-head h2 {
		margin: 0;
		font-size: 0.95rem;
	}
	.list-head span {
		color: var(--muted-foreground);
		font-size: 0.72rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.1rem 0.8rem;
	}
	.poster-card {
		min-width: 0;
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
	@media (min-width: 620px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			gap: 1.25rem 1rem;
		}
	}
	.poster-card:hover .poster-wrap {
		border-color: var(--border-strong);
		transform: translateY(-2px);
	}
	/* Hover lift only where hover exists — touch devices otherwise stick
	   in the lifted state after a tap. */
	@media (hover: none) {
		.poster-card:hover .poster-wrap {
			transform: none;
		}
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
	/* Transparent click target over the poster for in-library items. The Add
	   button stays outside this wrapper, so it keeps its own hit area. */
	.poster-open {
		position: absolute;
		inset: 0;
		z-index: 2;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		cursor: pointer;
	}
	.poster-open:hover:not(:disabled) {
		background: transparent;
	}
	.poster-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
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
	/* Detail line pinned inside the poster's bottom edge. The poster image
	   is absolutely positioned over the whole wrap, so this must be
	   positioned too — in flow it sits under (and clipped by) the image. */
	.watch {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		font-size: 0.75rem;
		font-weight: 450;
		color: var(--primary-foreground);
		background: color-mix(in srgb, var(--foreground) 82%, transparent);
		padding: 0.3rem 0.55rem 0.45rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.watch .dot {
		background: var(--primary-foreground);
		margin-right: 0.35rem;
	}
	.watch .dot.warn {
		background: color-mix(in srgb, var(--warning) 55%, var(--primary-foreground));
	}
	.progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		/* Paint above the watch strip sharing the bottom edge */
		z-index: 1;
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
		.progress-fill {
			transition: none;
		}
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
	.poster-meta button {
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
		font-size: 0.78rem;
		color: var(--muted-foreground);
		background: transparent;
		border: 0;
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
