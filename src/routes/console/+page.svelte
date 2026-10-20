<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { modal } from '$lib/actions/modal';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	type Item = {
		id: number;
		title: string;
		year: number | null;
		monitored: boolean;
		qualityProfileId?: number;
		rootFolderPath?: string;
		tags: number[];
		detail: string;
		seriesType?: string;
		seasons?: { seasonNumber: number; monitored: boolean }[];
	};

	type Tab = 'library' | 'queue' | 'history' | 'exclusions' | 'blocklist' | 'calendar';
	type Service = 'radarr' | 'sonarr';

	// Tab and service live in the URL: refresh and deep links keep their place.
	const TAB_KEYS: Tab[] = ['library', 'queue', 'history', 'exclusions', 'blocklist', 'calendar'];
	let tab = $derived<Tab>(
		TAB_KEYS.includes(page.url.searchParams.get('tab') as Tab)
			? (page.url.searchParams.get('tab') as Tab)
			: 'library'
	);
	let service = $derived<Service>(
		page.url.searchParams.get('service') === 'sonarr' ? 'sonarr' : 'radarr'
	);

	function setTab(t: Tab) {
		goto(`/console?tab=${t}&service=${service}`, { replaceState: true, noScroll: true, keepFocus: true });
	}
	function setService(s: Service) {
		goto(`/console?tab=${tab}&service=${s}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let data = $state<Record<string, unknown> | null>(null);
	let loading = $state(false);
	let msg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	// Edit dialog state
	let editItem = $state<Item | null>(null);
	let editMonitored = $state(false);
	let editProfile = $state<number | null>(null);
	let editRoot = $state<string | null>(null);
	let editTags = $state<number[]>([]);
	let editSeasons = $state<{ seasonNumber: number; monitored: boolean }[]>([]);

	// Delete dialog state
	let deleteItem = $state<Item | null>(null);
	let deleteFiles = $state(false);
	let addExclusion = $state(false);
	let confirmText = $state('');

	// Episodes dialog state
	let episodesFor = $state<Item | null>(null);
	let episodes = $state<Record<string, unknown>[]>([]);
	// Long-running series can have hundreds of episodes — paginate the dialog.
	const EP_PAGE_SIZE = 25;
	let epPage = $state(1);

	// Lightweight confirmation for lower-stakes removals (queue, exclusions,
	// blocklist) — the typed-confirmation dialog stays reserved for library deletes.
	type ConfirmTarget = { title: string; body?: string; qs: string; okText: string } | null;
	let confirmTarget = $state<ConfirmTarget>(null);

	let loadSeq = 0;

	// Library pagination — a 1,000-item library must not render 4,000 buttons.
	const LIB_PAGE_SIZE = 50;
	let libPage = $state(1);
	const libItems = $derived(((data?.items as Item[]) ?? []) as Item[]);

	async function load() {
		const seq = ++loadSeq; // guard against out-of-order responses when switching tabs quickly
		loading = true;
		msg = null;
		try {
			const res = await fetch(`/api/console/${tab}?service=${service}`, { cache: 'no-store' });
			const json = await res.json().catch(() => ({}));
			if (seq !== loadSeq) return; // superseded by a newer tab/service switch
			if (!res.ok) {
				msg = { kind: 'error', text: json.error ?? 'Failed to load' };
				data = null;
			} else {
				data = json;
			}
		} catch {
			if (seq === loadSeq) {
				msg = { kind: 'error', text: 'Request failed' };
				data = null;
			}
		} finally {
			// Only the newest request may clear the spinner
			if (seq === loadSeq) loading = false;
		}
	}
	$effect(() => {
		tab;
		service;
		libPage = 1;
		load();
		loadSummary();
	});

	async function send(method: string, qs: string, body?: unknown, okText = 'Done') {
		msg = null;
		try {
			const res = await fetch(`/api/console/${tab}?service=${service}${qs}`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: body ? JSON.stringify(body) : undefined
			});
			const out = await res.json().catch(() => ({}));
			msg = res.ok
				? { kind: 'ok', text: okText }
				: { kind: 'error', text: out.error ?? 'Failed' };
			if (res.ok) {
				closeDialogs();
				await load();
				loadSummary();
			}
			return res.ok;
		} catch {
			msg = { kind: 'error', text: 'Request failed' };
			return false;
		}
	}

	function closeDialogs() {
		editItem = null;
		deleteItem = null;
		episodesFor = null;
		confirmText = '';
		deleteFiles = false;
		addExclusion = false;
	}

	function openEdit(item: Item) {
		editItem = item;
		editMonitored = item.monitored;
		editProfile = item.qualityProfileId ?? null;
		editRoot = item.rootFolderPath || null;
		editTags = [...item.tags];
		editSeasons = (item.seasons ?? []).map((s) => ({ ...s }));
	}

	function saveEdit() {
		if (!editItem) return;
		const body: Record<string, unknown> = {
			monitored: editMonitored,
			qualityProfileId: editProfile,
			rootFolderPath: editRoot,
			tags: editTags
		};
		if (service === 'sonarr' && editItem.seasons) body.seasons = editSeasons;
		send('PATCH', `&id=${editItem.id}`, body, 'Saved changes');
	}

	function doDelete() {
		if (!deleteItem) return;
		send(
			'DELETE',
			`&id=${deleteItem.id}&confirm=${encodeURIComponent(confirmText)}&deleteFiles=${deleteFiles ? 1 : 0}&addExclusion=${addExclusion ? 1 : 0}`,
			undefined,
			`Deleted “${deleteItem.title}”`
		);
	}

	function searchItem(item: Item) {
		const body =
			service === 'radarr'
				? { name: 'MoviesSearch', ids: [item.id] }
				: { name: 'SeriesSearch', ids: [item.id] };
		send('POST', '', body, `Search started for “${item.title}”`);
	}

	async function openEpisodes(item: Item) {
		episodesFor = item;
		episodes = [];
		epPage = 1;
		try {
			const res = await fetch(`/api/console/episodes?service=sonarr&seriesId=${item.id}`);
			const out = await res.json().catch(() => ({}));
			if (res.ok) episodes = out.items ?? [];
			else throw new Error(out.error ?? 'Failed to load episodes');
		} catch (e) {
			// Close the dialog so the message is visible behind nothing —
			// the overlay would hide a page-level message.
			episodesFor = null;
			msg = { kind: 'error', text: e instanceof Error && e.message ? e.message : 'Request failed' };
		}
	}

	function searchEpisode(episodeId: number) {
		send('POST', '', { name: 'EpisodesSearch', ids: [episodeId] }, 'Episode search started');
	}

	const SERIES_TYPE: Record<string, string> = {
		standard: 'Standard',
		daily: 'Daily',
		anime: 'Anime'
	};

	const EVENT_LABEL: Record<string, string> = {
		grabbed: 'Grabbed',
		downloadFolderImported: 'Imported',
		movieFolderImported: 'Imported',
		episodeImported: 'Imported',
		renamed: 'Renamed',
		deleted: 'Deleted'
	};

	const tabs: { key: Tab; label: string }[] = [
		{ key: 'library', label: 'Library' },
		{ key: 'queue', label: 'Queue' },
		{ key: 'history', label: 'History' },
		{ key: 'exclusions', label: 'Exclusions' },
		{ key: 'blocklist', label: 'Blocklist' },
		{ key: 'calendar', label: 'Calendar' }
	];

	// KPI strip (fetched per service, refreshed after mutations)
	let summary = $state<{ library: number; monitored: number; queue: number; blocked: number } | null>(
		null
	);
	let kpiSeq = 0;
	async function loadSummary() {
		const seq = ++kpiSeq;
		try {
			const res = await fetch(`/api/console/summary?service=${service}`);
			if (!res.ok) return;
			const data = await res.json();
			if (seq === kpiSeq) summary = data;
		} catch {
			/* keep last values */
		}
	}

	function bytes(n: unknown): string {
		const v = Number(n ?? 0);
		if (!v) return '—';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let i = 0;
		let x = v;
		while (x >= 1024 && i < units.length - 1) {
			x /= 1024;
			i++;
		}
		return `${x.toFixed(1)} ${units[i]}`;
	}

	type Profile = { id: number; name: string };
	type RootFolder = { id: number; path: string };
	type Tag = { id: number; label: string };

	function sub(o: unknown, key: string): Record<string, unknown> | undefined {
		return (o as Record<string, unknown> | undefined)?.[key] as Record<string, unknown> | undefined;
	}

	function when(item: Record<string, unknown>): string {
		return String(item.date ?? item.airDateUtc ?? item.when ?? '').replace('T', ' ').slice(0, 16);
	}
</script>

<svelte:head>
	<title>Console — Addarr</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && (editItem || deleteItem || episodesFor)) closeDialogs();
	}}
/>

<h1>Operations console</h1>

{#if summary}
	<div class="kpi-strip">
		<div class="kpi">
			<div class="kpi-value">{summary.library}</div>
			<div class="kpi-label">In library</div>
		</div>
		<div class="kpi">
			<div class="kpi-value">{summary.monitored}</div>
			<div class="kpi-label">Monitored</div>
		</div>
		<div class="kpi">
			<div class="kpi-value">{summary.queue}</div>
			<div class="kpi-label">In queue</div>
		</div>
		<div class="kpi">
			<div class="kpi-value">{summary.blocked}</div>
			<div class="kpi-label">Blocklisted</div>
		</div>
	</div>
{/if}

<div class="controls">
	<div class="tabs" role="group" aria-label="Console sections">
		{#each tabs as t (t.key)}
			<button class="tab" class:active={tab === t.key} aria-pressed={tab === t.key} onclick={() => setTab(t.key)}>{t.label}</button>
		{/each}
	</div>
	<div class="service-switch" role="group" aria-label="Service">
		<span class="service-label">Service</span>
		<button class="tab" class:active={service === 'radarr'} aria-pressed={service === 'radarr'} onclick={() => setService('radarr')}>Radarr</button>
		<button class="tab" class:active={service === 'sonarr'} aria-pressed={service === 'sonarr'} onclick={() => setService('sonarr')}>Sonarr</button>
	</div>
</div>

{#if msg}<p class="msg {msg.kind === 'ok' ? 'ok' : 'error'}" role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>{/if}
{#if loading}<p class="hint">Loading…</p>{/if}

{#if !loading && data}
	<!-- LIBRARY -->
	{#if tab === 'library'}
		{#if (data.items as Item[] | undefined)?.length === 0}
			<p class="hint">Library is empty.</p>
		{/if}
		<div class="card">
			<ul class="rows">
				{#each libItems.slice((libPage - 1) * LIB_PAGE_SIZE, libPage * LIB_PAGE_SIZE) as item (item.id)}
					<li>
						<div class="grow">
							<strong>{item.title}</strong> <small>({item.year ?? '—'})</small>
							<small>{item.detail}{#if item.seriesType} · {SERIES_TYPE[item.seriesType] ?? item.seriesType}{/if} · {item.monitored ? 'monitored' : 'unmonitored'}</small>
						</div>
						<div class="actions">
							<button class="secondary" onclick={() => searchItem(item)} disabled={loading}>Search</button>
							{#if service === 'sonarr'}
								<button class="secondary" onclick={() => openEpisodes(item)} disabled={loading}>Episodes</button>
							{/if}
							<button class="secondary" onclick={() => openEdit(item)} disabled={loading}>Edit</button>
							<button class="secondary danger" onclick={() => { deleteItem = item; confirmText = ''; }} disabled={loading}>
								Delete
							</button>
						</div>
					</li>
				{/each}
			</ul>
		</div>
		{#if libItems.length > LIB_PAGE_SIZE}
			<div class="pager">
				<button class="secondary" disabled={libPage <= 1 || loading} onclick={() => libPage--}>Previous</button>
				<span class="hint">{(libPage - 1) * LIB_PAGE_SIZE + 1}–{Math.min(libPage * LIB_PAGE_SIZE, libItems.length)} of {libItems.length}</span>
				<button class="secondary" disabled={libPage * LIB_PAGE_SIZE >= libItems.length || loading} onclick={() => libPage++}>Next</button>
			</div>
		{/if}

	<!-- QUEUE -->
	{:else if tab === 'queue'}
		<div class="card">
			<ul class="rows">
				{#each (data.items as Record<string, unknown>[]) ?? [] as q (String(q.id))}
					<li>
						<div class="grow">
							<strong>{String(q.title ?? sub(q, 'movie')?.title ?? sub(q, 'series')?.title ?? '—')}</strong>
							<small>
								<span class="dot" class:active={q.status === 'downloading'} class:warn={q.status === 'queued' || q.status === 'completed'}></span>
								{String(q.status ?? '—')} ·
								<span class="mono">{bytes(Number(q.size ?? 0) - Number(q.sizeleft ?? q.sizeLeft ?? 0))} / {bytes(q.size)}</span>
								· <span class="mono">{String(q.timeleft ?? '—')}</span>
							</small>
						</div>
						<div class="actions">
							<button
								class="secondary danger"
								onclick={() => {
									confirmTarget = {
										title: 'Remove from queue',
										body: `Remove “${String(q.title ?? '')}” from the queue and delete it from the download client?`,
										qs: `&id=${q.id}&removeFromClient=1`,
										okText: 'Removed from queue'
									};
								}}
							>Remove</button>
						</div>
					</li>
				{:else}
					<li><small>Queue is empty.</small></li>
				{/each}
			</ul>
		</div>

	<!-- HISTORY -->
	{:else if tab === 'history'}
		<div class="card">
			<ul class="rows">
				{#each (data.items as Record<string, unknown>[]) ?? [] as h (String(h.id))}
					<li>
						<div class="grow">
							<strong>{String(h.sourceTitle ?? sub(h, 'movie')?.title ?? sub(h, 'series')?.title ?? '—')}</strong>
							<small><span class="mono">{when(h)}</span> · {EVENT_LABEL[String(h.eventType ?? '')] ?? String(h.eventType ?? '')} · {String(sub(sub(h, 'quality'), 'quality')?.name ?? '')}</small>
						</div>
					</li>
				{:else}
					<li><small>No history yet.</small></li>
				{/each}
			</ul>
		</div>

	<!-- EXCLUSIONS -->
	{:else if tab === 'exclusions'}
		<div class="card">
			<ul class="rows">
				{#each (data.items as Record<string, unknown>[]) ?? [] as x (String(x.id))}
					<li>
						<div class="grow"><strong>{x.movieTitle ?? x.title ?? x.tvdbId ?? '—'}</strong></div>
						<div class="actions">
							<button
								class="secondary danger"
								onclick={() => {
									confirmTarget = {
										title: 'Remove exclusion',
										body: `Allow “${String(x.movieTitle ?? x.title ?? x.tvdbId ?? 'this item')}” to be imported again?`,
										qs: `&id=${x.id}`,
										okText: 'Removed from import exclusions'
									};
								}}
							>Remove</button>
						</div>
					</li>
				{:else}
					<li><small>No import exclusions.</small></li>
				{/each}
			</ul>
		</div>

	<!-- BLOCKLIST -->
	{:else if tab === 'blocklist'}
		<div class="card">
			<ul class="rows">
				{#each (data.items as Record<string, unknown>[]) ?? [] as b (String(b.id))}
					<li>
						<div class="grow"><strong>{b.sourceTitle ?? b.title ?? '—'}</strong> <small><span class="mono">{when(b)}</span></small></div>
						<div class="actions">
							<button
								class="secondary danger"
								onclick={() => {
									confirmTarget = {
										title: 'Remove from blocklist',
										body: `Remove “${String(b.sourceTitle ?? b.title ?? 'this item')}” from the blocklist? It can be added again later.`,
										qs: `&id=${b.id}`,
										okText: 'Removed from blocklist'
									};
								}}
							>Remove</button>
						</div>
					</li>
				{:else}
					<li><small>Blocklist is empty.</small></li>
				{/each}
			</ul>
		</div>

	<!-- CALENDAR -->
	{:else if tab === 'calendar'}
		<div class="card">
			<ul class="rows">
				{#each (data.items as Record<string, unknown>[]) ?? [] as c, i (i)}
					<li>
						<div class="grow"><strong>{c.title}</strong> <small>{c.what} · <span class="mono">{when(c)}</span></small></div>
					</li>
				{:else}
					<li><small>Nothing upcoming in the next two weeks.</small></li>
				{/each}
			</ul>
		</div>
	{/if}
{/if}

<!-- Global curated command -->
<div class="card">
	<h2>Commands</h2>
	<button class="secondary" onclick={() => send('POST', '', { name: 'RefreshMonitoredDownloads' }, 'Refresh queued')}>
		Refresh monitored downloads
	</button>
	<p class="hint">Per-item Search buttons live in the Library tab. No free-form commands, by design.</p>
</div>

<!-- EDIT DIALOG -->
{#if editItem}
	<div class="overlay">
		<div
			class="card dialog"
			role="dialog"
			aria-modal="true"
			aria-label={`Edit “${editItem.title}”`}
			tabindex="-1"
			use:modal
		>
			<h2>Edit “{editItem.title}”</h2>
		<label class="check"><input type="checkbox" bind:checked={editMonitored} /> Monitored</label>

		<label for="edit-profile">Quality profile</label>
		<select id="edit-profile" bind:value={editProfile}>
			{#each ((data?.profiles ?? []) as Profile[]) as p (p.id)}
				<option value={p.id}>{p.name}</option>
			{/each}
		</select>

		<label for="edit-root">Root folder</label>
		<select id="edit-root" bind:value={editRoot}>
			{#each ((data?.rootFolders ?? []) as RootFolder[]) as r (r.id)}
				<option value={r.path}>{r.path}</option>
			{/each}
		</select>

		<span class="section-label">Tags</span>
		{#if ((data?.tags ?? []) as Tag[]).length === 0}
			<p class="hint">No tags in {service === 'radarr' ? 'Radarr' : 'Sonarr'} yet.</p>
		{:else}
			<div class="tag-group">
				{#each ((data?.tags ?? []) as Tag[]) as t (t.id)}
					<label class="check">
						<input
							type="checkbox"
							checked={editTags.includes(t.id)}
							onchange={(e) => {
								if (e.currentTarget.checked) editTags = [...editTags, t.id];
								else editTags = editTags.filter((id) => id !== t.id);
							}}
						/>
						{t.label}
					</label>
				{/each}
			</div>
		{/if}

		{#if service === 'sonarr' && editSeasons.length > 0}
			<p class="hint" style="margin-bottom:0">Season monitoring</p>
			{#each editSeasons as s (s.seasonNumber)}
				<label class="check">
					<input type="checkbox" bind:checked={s.monitored} />
					Season {s.seasonNumber}
				</label>
			{/each}
		{/if}

		<button onclick={saveEdit} disabled={loading}>Save</button>
		<button class="secondary" onclick={closeDialogs}>Cancel</button>
		</div>
	</div>
{/if}

<!-- DELETE DIALOG (typed confirmation) -->
{#if deleteItem}
	<div class="overlay">
		<div
			class="card dialog"
			role="dialog"
			aria-modal="true"
			aria-label={`Delete “${deleteItem.title}”`}
			tabindex="-1"
			use:modal
		>
			<h2>Delete “{deleteItem.title}”</h2>
			<p class="hint">This cannot be undone. Type the title exactly to confirm.</p>
			<label class="check"><input type="checkbox" bind:checked={deleteFiles} /> Also delete files from disk</label>
			<label class="check"><input type="checkbox" bind:checked={addExclusion} /> Add import exclusion (block re-adding)</label>
			<input bind:value={confirmText} aria-label="Type the title to confirm deletion" />
			<button class="danger" disabled={confirmText !== deleteItem.title || loading} onclick={doDelete}>
				Delete permanently
			</button>
			<button class="secondary" onclick={closeDialogs}>Cancel</button>
		</div>
	</div>
{/if}

<!-- EPISODES DIALOG -->
{#if episodesFor}
	<div class="overlay">
		<div
			class="card dialog wide"
			role="dialog"
			aria-modal="true"
			aria-label={`Episodes — ${episodesFor.title}`}
			tabindex="-1"
			use:modal
		>
			<h2>Episodes — {episodesFor.title}</h2>
		<ul class="rows">
			{#each episodes.slice((epPage - 1) * EP_PAGE_SIZE, epPage * EP_PAGE_SIZE) as ep (String(ep.id))}
				<li>
					<div class="grow">
						<strong>{ep.seasonNumber}x{String(ep.episodeNumber).padStart(2, '0')}</strong>
						<small>{ep.title} {ep.hasFile ? '· on disk' : ep.airDateUtc ? '· ' + String(ep.airDateUtc).slice(0, 10) : ''}</small>
					</div>
					<div class="actions">
						<button class="secondary" onclick={() => searchEpisode(Number(ep.id))}>Search</button>
					</div>
				</li>
			{/each}
		</ul>
		{#if episodes.length > EP_PAGE_SIZE}
			<div class="pager">
				<button class="secondary" disabled={epPage <= 1} onclick={() => epPage--}>Previous</button>
				<span class="hint">{(epPage - 1) * EP_PAGE_SIZE + 1}–{Math.min(epPage * EP_PAGE_SIZE, episodes.length)} of {episodes.length}</span>
				<button class="secondary" disabled={epPage * EP_PAGE_SIZE >= episodes.length} onclick={() => epPage++}>Next</button>
			</div>
		{/if}
		<button class="secondary" onclick={closeDialogs}>Close</button>
		</div>
	</div>
{/if}

<!-- LIGHTWEIGHT CONFIRMATION (queue / exclusions / blocklist) -->
{#if confirmTarget}
	<ConfirmDialog
		title={confirmTarget.title}
		body={confirmTarget.body ?? ''}
		confirmLabel="Remove"
		busy={loading}
		onconfirm={() => {
			const t = confirmTarget;
			confirmTarget = null;
			if (t) send('DELETE', t.qs, undefined, t.okText);
		}}
		oncancel={() => (confirmTarget = null)}
	/>
{/if}

<style>
	.controls {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0 1.5rem;
	}
	.tabs {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
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
	.service-switch {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.service-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-foreground);
		margin-right: 0.25rem;
	}
	.section-label {
		display: block;
		margin: 0.75rem 0 0.3rem;
		color: var(--muted-foreground);
		font-size: 0.8rem;
		font-weight: 500;
	}
	.tag-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
	}
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
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}
	.actions button {
		margin-top: 0;
		padding: 0.3rem 0.7rem;
		font-size: 0.85rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
		color: var(--foreground);
		font-size: 0.95rem;
	}
	.check input {
		width: auto;
		accent-color: var(--primary);
	}
	/* 44px hit area on touch: enlarge the box and give the label breathing room */
	@media (pointer: coarse) {
		.check {
			min-height: 2.75rem;
		}
		.check input {
			width: 1.2rem;
			height: 1.2rem;
		}
	}
	/* Rows keep their two-part shape down to phone width, then the action
	   cluster drops below the title instead of crushing it. */
	@media (max-width: 640px) {
		.rows li {
			flex-wrap: wrap;
		}
		.rows li .actions {
			width: 100%;
			justify-content: flex-end;
		}
	}
</style>
