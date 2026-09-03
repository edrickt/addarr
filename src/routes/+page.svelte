<script lang="ts">
	import type { PosterCard } from '$lib/arr/types';

	type Result = PosterCard & { kind: 'movie' | 'series'; watchId?: number; watchStatus?: string; watchProgress?: number };

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
	$effect(() => {
		const timer = setInterval(async () => {
			const watching = results.filter(
				(r) => r.watchId && r.watchStatus && r.watchStatus !== 'available'
			);
			if (watching.length === 0) return;
			for (const card of watching) {
				try {
					const res = await fetch(`/api/status/${card.kind}/${card.watchId}`);
					if (!res.ok) continue;
					const data = await res.json();
					card.watchStatus = data.state;
					card.watchProgress = data.progress;
					if (data.state === 'available') showToast(`“${card.title}” is available`);
				} catch {
					/* transient — keep last state */
				}
			}
		}, 5000);
		return () => clearInterval(timer);
	});

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
				{#if card.watchStatus}
					<span class="watch" class:done={card.watchStatus === 'available'}>
						<span
							class="dot"
							class:ok={card.watchStatus === 'available'}
							class:active={card.watchStatus === 'downloading' || card.watchStatus === 'queued'}
						></span>
						{card.watchStatus === 'downloading' ? `downloading ${card.watchProgress ?? 0}%` : card.watchStatus}
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
