<script lang="ts">
	import type { PosterCard } from '$lib/arr/types';

	type WatchState = 'waiting' | 'queued' | 'paused' | 'downloading' | 'partial' | 'attention' | 'available';

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
	let toast = $state<string | null>(null);
	let busyId = $state<number | null>(null);

	let searchSeq = 0;

	$effect(() => {
		const term = q.trim();
		const m = mode;
		if (term.length < 2) {
			results = [];
			loading = false;
			error = null;
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
			settled.forEach((s, i) => {
				if (s.status === 'fulfilled' && Array.isArray(s.value.results)) {
					for (const card of s.value.results as PosterCard[]) merged.push({ ...card, kind: kinds[i] });
				} else if (!firstError) {
					firstError =
						s.status === 'fulfilled'
							? (s.value.error ?? 'Search failed')
							: 'Search failed — try again';
				}
			});
			results = merged;
			error = merged.length === 0 ? firstError : null;
			loading = false;
		}, 350);
		return () => clearTimeout(timer);
	});

	async function add(card: Result) {
		busyId = card.sourceId;
		try {
			const res = await fetch('/api/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ service: card.kind, id: card.sourceId })
			});
			const data = await res.json();
			if (res.ok) {
				card.inLibrary = true;
				if (typeof data.id === 'number') {
					card.watchId = data.id;
					card.watchStatus = 'queued';
				}
				showToast(data.searchQueued === false ? `Added “${card.title}”` : `Added “${card.title}” — searching now`);
			} else {
				showToast(`Couldn't add: ${data.error ?? 'unknown error'}`, true);
			}
		} catch {
			showToast("Couldn't add — network error", true);
		} finally {
			busyId = null;
		}
	}

	function showToast(text: string, isError = false) {
		toast = text;
		toastIsError = isError;
		setTimeout(() => {
			if (toast === text) toast = null;
		}, 4000);
	}
	let toastIsError = $state(false);

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
				(r) => r.watchId && r.watchStatus && r.watchStatus !== 'available'
			);
			if (watching.length > 0) {
				for (const card of watching) {
					try {
						const res = await fetch(`/api/status/${card.kind}/${card.watchId}`);
						if (!res.ok) continue;
						const data = await res.json();
						card.watchStatus = data.state;
						card.watchProgress = data.progress ?? null;
						card.watchTimeLeft = data.timeLeftSeconds ?? null;
						card.watchEpisodes = data.episodes ?? null;
						if (data.state === 'available') {
							card.inLibrary = true;
							showToast(`“${card.title}” is available`);
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
	const WATCH_LABEL: Record<Exclude<WatchState, 'available'>, string> = {
		waiting: 'Looking for it…',
		queued: 'Queued',
		paused: 'Paused',
		downloading: 'Downloading…',
		partial: 'Episodes',
		attention: 'Needs attention'
	};

	function watchText(card: Result): string {
		const s = card.watchStatus!;
		if (s === 'available') return 'In library';
		if (s === 'downloading' && card.watchTimeLeft != null) return `${fmtLeft(card.watchTimeLeft)} left`;
		if (s === 'partial' && card.watchEpisodes) {
			return `${card.watchEpisodes.have} of ${card.watchEpisodes.total} episodes`;
		}
		return WATCH_LABEL[s];
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
			case 'paused':
				return p != null ? { mode: 'determinate', progress: p, tone: 'warning' } : { mode: 'indeterminate', progress: null, tone: 'warning' };
			case 'attention':
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
		return title
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]!.toUpperCase())
			.join('');
	}
</script>

<svelte:head>
	<title>Addarr</title>
</svelte:head>

<div class="search-bar">
	<input
		class="search-input"
		bind:value={q}
		placeholder="Search for a movie or series…"
		autocomplete="off"
	/>
	<div class="mode-tabs" role="tablist">
		{#each modes as m (m.key)}
			<button
				type="button"
				class="tab"
				class:active={mode === m.key}
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
	<p class="msg error">{error}</p>
{:else if q.trim().length >= 2 && results.length === 0}
	<p class="hint">Nothing found. Try another title?</p>
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
				{#if card.inLibrary}
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
								style={bar.mode === 'determinate' ? `width: ${Math.min(100, Math.max(0, bar.progress ?? 0))}%` : ''}
							></div>
						</div>
					{/if}
				{/if}
				{#if card.watchStatus}
					<span class="watch" class:done={card.watchStatus === 'available'}>
						{#if card.watchStatus !== 'available'}
							<span
								class="dot"
								class:warn={card.watchStatus === 'attention' || card.watchStatus === 'paused'}
								class:active={card.watchStatus === 'downloading' || card.watchStatus === 'queued'}
							></span>
						{/if}
						{watchText(card)}
					</span>
				{/if}
			</div>
			<div class="poster-meta">
				<p class="title" title={card.title}>{card.title}</p>
				<p class="year">{card.year ?? ''}</p>
				{#if card.inLibrary}
					<button class="secondary" disabled>Already added</button>
				{:else}
					<button onclick={() => add(card)} disabled={busyId === card.sourceId}>
						{busyId === card.sourceId ? 'Adding…' : 'Add'}
					</button>
				{/if}
			</div>
		</div>
	{/each}
</div>

{#if toast}
	<div class="toast" class:error={toastIsError} role="status">{toast}</div>
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
		background: var(--card);
		border: 1px solid var(--border);
		color: var(--muted-foreground);
		font-weight: 500;
		padding: 0.35rem 0.9rem;
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
	}
	.poster-card {
		width: 150px;
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
	.watch {
		display: block;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		min-height: 1rem;
	}
	.watch:has(.dot.active) {
		color: var(--foreground);
	}
	.watch.done {
		color: var(--success);
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
		background: var(--primary);
		transition: width 1s ease;
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
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.poster-meta .year {
		margin: 0.1rem 0 0.4rem;
		color: var(--muted-foreground);
		font-size: 0.8rem;
		min-height: 1rem;
	}
	.poster-card button {
		margin-top: 0;
		width: 100%;
		padding: 0.4rem 0;
		font-size: 0.85rem;
	}
	.hint {
		color: var(--muted-foreground);
	}
	.toast {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--success);
		color: var(--primary-foreground);
		font-weight: 450;
		padding: 0.7rem 1.3rem;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
	}
	.toast.error {
		background: var(--destructive);
		color: var(--primary-foreground);
	}
</style>
