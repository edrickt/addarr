<script lang="ts">
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
	let page = $state(1);
	let hasMore = $state(false);
	let loading = $state(false);

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/api/activity?page=${page}`);
			const data = await res.json();
			entries = data.entries ?? [];
			hasMore = entries.length === (data.pageSize ?? 50);
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		page;
		load();
	});
</script>

<svelte:head>
	<title>Activity — Addarr</title>
</svelte:head>

<h1>Activity log</h1>
<p class="hint">Who added what, when — plus admin actions.</p>

<div class="card">
	<ul class="rows">
		{#each entries as e (e.id)}
			<li>
				<div class="grow">
					<strong>{e.title ?? e.action}</strong>
					<small>{e.action} · {e.username ?? 'anonymous'}{e.service_type ? ` · ${e.service_type}` : ''}</small>
				</div>
				<small class="when">{e.created_at}</small>
			</li>
		{:else}
			<li><small>No activity yet.</small></li>
		{/each}
	</ul>
</div>

<div class="pager">
	<button class="secondary" disabled={page <= 1 || loading} onclick={() => page--}>Newer</button>
	<span class="hint">page {page}</span>
	<button class="secondary" disabled={!hasMore || loading} onclick={() => page++}>Older</button>
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
	.pager {
		display: flex;
		gap: 1rem;
		align-items: center;
	}
	.pager button {
		margin-top: 0;
	}
</style>
