<script lang="ts">
	import DownloadSheet from '$lib/components/DownloadSheet.svelte';
	import type { DownloadItem } from '$lib/arr/downloads';
	import {
		formatTimeLeft,
		initials,
		memberProgressBar,
		memberStateLabel,
		memberStateTone
	} from '$lib/arr/presentation';

	type DownloadError = { service: string; message: string };
	type DownloadsResponse = { items?: DownloadItem[]; errors?: DownloadError[]; error?: string };

	let items = $state<DownloadItem[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let partialErrors = $state<DownloadError[]>([]);
	let selectedKey = $state<string | null>(null);
	let announce = $state('');
	let inFlight = false;

	const selected = $derived(items.find((item) => downloadKey(item) === selectedKey) ?? null);

	function downloadKey(item: Pick<DownloadItem, 'kind' | 'id'>): string {
		return `${item.kind}:${item.id}`;
	}

	async function load() {
		if (inFlight) return;
		inFlight = true;
		try {
			const res = await fetch('/api/downloads', { cache: 'no-store' });
			const data: DownloadsResponse = await res.json().catch(() => ({}));
			if (!res.ok) {
				error = data.error ?? 'Could not load downloads';
				if (items.length === 0) partialErrors = [];
				return;
			}

			const next = Array.isArray(data.items) ? data.items : [];
			const previous = new Set(items.map(downloadKey));
			const added = next.filter((item) => !previous.has(downloadKey(item)));
			if (items.length > 0 && added.length > 0) {
				announce =
					added.length === 1
						? `${added[0]!.title} started downloading`
						: `${added.length} new downloads`;
			}

			items = next;
			partialErrors = Array.isArray(data.errors) ? data.errors : [];
			error = null;
			if (selectedKey && !next.some((item) => downloadKey(item) === selectedKey)) {
				selectedKey = null;
			}
		} catch {
			error = 'Could not load downloads';
		} finally {
			inFlight = false;
			loading = false;
		}
	}

	$effect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;

		const tick = async () => {
			if (cancelled) return;
			await load();
			if (cancelled) return;
			const active = items.some(
				(item) =>
					item.state === 'downloading' || item.state === 'importing' || item.state === 'queued'
			);
			timer = setTimeout(tick, active ? 5000 : 20000);
		};

		tick();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});
</script>

<svelte:head>
	<title>Addarr Downloads</title>
</svelte:head>

<h1>Downloads</h1>
<p class="hint intro">Movies and series currently on their way to the library.</p>

<div class="sr-only" aria-live="polite">{announce}</div>

{#if loading && items.length === 0}
	<p class="hint">Loading downloads…</p>
{:else if error && items.length === 0}
	<p class="msg error" role="alert">
		{error}
		<button class="secondary retry" onclick={load}>Retry</button>
	</p>
{:else if partialErrors.length > 0 && items.length === 0}
	<p class="msg error" role="alert">
		{partialErrors.map((e) => e.message).join(' · ')}.
		<button class="secondary retry" onclick={load}>Retry</button>
	</p>
{:else if items.length === 0}
	<div class="card empty">
		<p>Nothing is downloading right now.</p>
		<p class="hint">New downloads will appear here automatically.</p>
	</div>
{:else}
	{#if error}
		<p class="msg error" role="alert">
			Could not refresh downloads. Showing the last update.
			<button class="secondary retry" onclick={load}>Retry</button>
		</p>
	{:else if partialErrors.length > 0}
		<p class="msg error" role="alert">
			{partialErrors.map((e) => e.message).join(' · ')} — showing the rest.
		</p>
	{/if}

	<ul class="download-list">
		{#each items as item (downloadKey(item))}
			{@const tone = memberStateTone(item.state)}
			{@const bar = memberProgressBar(item.state, item.progress)}
			<li>
				<button
					class="download-row"
					type="button"
					onclick={() => (selectedKey = downloadKey(item))}
				>
					<span class="thumb" aria-hidden="true">
						<span class="thumb-fallback mono">{initials(item.title)}</span>
						{#if item.posterUrl}
							<img
								src={item.posterUrl}
								alt=""
								loading="lazy"
								onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
							/>
						{/if}
					</span>

					<span class="row-main">
						<span class="row-title">
							{item.title}{#if item.year}<span class="row-year"> ({item.year})</span>{/if}
						</span>
						<span class="row-state">
							<span
								class="dot"
								class:active={tone === 'active'}
								class:warn={tone === 'warn'}
								class:ok={tone === 'ok'}
							></span>
							{memberStateLabel(item.state, item.episodes)}
							{#if item.state === 'downloading' && item.timeLeftSeconds != null}
								· {formatTimeLeft(item.timeLeftSeconds)} left
							{/if}
							{#if item.episodes}
								· {item.episodes.have} of {item.episodes.total} episodes
							{/if}
						</span>
						{#if bar}
							<span class="row-progress" aria-hidden="true">
								<span
									class="row-progress-fill"
									class:indeterminate={bar.mode === 'indeterminate'}
									class:tone-warning={bar.tone === 'warning'}
									class:tone-muted={bar.tone === 'muted'}
									style={bar.mode === 'determinate'
										? `transform: scaleX(${Math.min(1, Math.max(0, (bar.progress ?? 0) / 100))})`
										: ''}
								></span>
							</span>
						{/if}
					</span>

					<span class="chevron" aria-hidden="true">›</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if selected}
	<DownloadSheet item={selected} onclose={() => (selectedKey = null)} />
{/if}

<style>
	.intro {
		margin-bottom: 1.25rem;
	}
	.download-list {
		list-style: none;
		margin: 0;
		padding: 0;
		background: var(--card);
		border: 1px solid var(--border);
	}
	.download-list li + li {
		border-top: 1px solid var(--border);
	}
	.download-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		width: 100%;
		margin: 0;
		padding: 0.75rem 1rem;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--foreground);
		text-align: left;
		cursor: pointer;
	}
	.download-list .download-row:hover:not(:disabled) {
		background: var(--elevated);
	}
	.thumb {
		position: relative;
		width: 42px;
		aspect-ratio: 2 / 3;
		flex-shrink: 0;
		overflow: hidden;
		background: var(--elevated);
		border: 1px solid var(--border);
	}
	.thumb-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		letter-spacing: 0.05em;
	}
	.thumb img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.row-title {
		font-weight: 450;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-year {
		color: var(--muted-foreground);
		font-weight: 400;
	}
	.row-state {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.15rem;
		font-size: 0.78rem;
		color: var(--muted-foreground);
	}
	.row-state .dot {
		margin-right: 0.2rem;
	}
	.row-progress {
		display: block;
		height: 3px;
		margin-top: 0.25rem;
		overflow: hidden;
		background: var(--border);
	}
	.row-progress-fill {
		display: block;
		height: 100%;
		width: 100%;
		background: var(--primary);
		transform-origin: left;
		transition: transform 1s ease;
	}
	.row-progress-fill.tone-warning {
		background: var(--warning);
		transition: none;
	}
	.row-progress-fill.tone-muted {
		background: var(--muted-foreground);
	}
	.row-progress-fill.indeterminate {
		width: 25%;
		transform: none;
		transition: none;
		animation: download-progress-slide 1.4s ease-in-out infinite;
	}
	@keyframes download-progress-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(400%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.row-progress-fill {
			transition: none;
		}
		.row-progress-fill.indeterminate {
			animation: none;
		}
	}
	.chevron {
		color: var(--muted-foreground);
		font-size: 1.2rem;
		line-height: 1;
		padding-left: 0.25rem;
	}
	.retry {
		margin-top: 0;
		margin-left: 0.6rem;
		padding: 0.2rem 0.7rem;
		font-size: 0.8rem;
		vertical-align: middle;
	}
	.empty {
		margin-top: 1rem;
	}
	@media (max-width: 520px) {
		.download-row {
			padding: 0.65rem 0.75rem;
			gap: 0.7rem;
		}
		.thumb {
			width: 36px;
		}
	}
	@media (pointer: coarse) {
		.download-row {
			min-height: 4.5rem;
		}
	}
</style>
