<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	type Entry = {
		id: number;
		action: string;
		title: string | null;
		arr_item_id: number | null;
		created_at: string;
		username: string | null;
		service: string | null;
		service_type: string | null;
	};

	let entries = $state<Entry[]>([]);
	let hasMore = $state(false);
	let loading = $state(false);
	const PAGE_SIZE = 50;

	// Page number lives in the URL — refresh and deep links keep your place.
	let pageNum = $derived(Number(page.url.searchParams.get('page')) || 1);

	function setPage(n: number) {
		goto(`/activity?page=${n}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/api/activity?page=${pageNum}`);
			const data = await res.json();
			entries = data.entries ?? [];
			hasMore = entries.length === (data.pageSize ?? PAGE_SIZE);
		} finally {
			loading = false;
		}
	}

	// Relative time for recent rows; the raw date for anything older.
	// SQLite timestamps are UTC without a timezone marker.
	function when(v: string): string {
		const t = Date.parse(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
		if (Number.isNaN(t)) return v;
		const s = Math.round((Date.now() - t) / 1000);
		if (s < 0) return v;
		if (s < 60) return 'just now';
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
		return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
	$effect(() => {
		pageNum;
		load();
	});
</script>

<svelte:head>
	<title>Activity — Addarr</title>
</svelte:head>

<h1>Activity log</h1>
<p class="hint">Who added what, when — plus admin actions.</p>

{#if loading}
	<p class="hint">Loading…</p>
{:else}
	<div class="card">
		<ul class="rows">
			{#each entries as e (e.id)}
				<li>
					<div class="grow">
						<strong>{e.title ?? e.action}</strong>
						<small>{e.action} · {e.username ?? 'anonymous'}{e.service_type ? ` · ${e.service_type}` : ''}</small>
					</div>
					<small class="when" title={e.created_at}>{when(e.created_at)}</small>
				</li>
			{:else}
				<li><small>No activity yet.</small></li>
			{/each}
		</ul>
	</div>
{/if}

<div class="pager">
	<button class="secondary" disabled={pageNum <= 1 || loading} onclick={() => setPage(pageNum - 1)}>Previous</button>
	{#if entries.length > 0}
		<span class="hint">{(pageNum - 1) * PAGE_SIZE + 1}–{(pageNum - 1) * PAGE_SIZE + entries.length}</span>
	{/if}
	<button class="secondary" disabled={!hasMore || loading} onclick={() => setPage(pageNum + 1)}>Next</button>
</div>

<style>
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border);
	}
	.rows li:last-child {
		border-bottom: none;
	}
	.grow {
		min-width: 0;
	}
	.grow small {
		display: block;
		color: var(--muted-foreground);
	}
	.when {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	@media (max-width: 640px) {
		.rows li {
			flex-wrap: wrap;
		}
		.when {
			margin-left: auto;
		}
	}
</style>
