<script lang="ts">
	type Option = { id: number; name?: string; path?: string; label?: string };
	type PresetRow = {
		id: number;
		name: string;
		quality_profile_id: number;
		root_folder_path: string;
		monitored: number;
		tags_json: string;
		minimum_availability: string | null;
		search_on_add: number;
		series_type_default: string | null;
		season_monitor_policy: string | null;
	};

	let {
		service,
		options,
		preset,
		onsave,
		oncancel,
		busy
	}: {
		service: 'radarr' | 'sonarr';
		options: { qualityProfiles: Option[]; rootFolders: Option[]; tags: Option[] };
		preset: PresetRow | null;
		onsave: (body: Record<string, unknown>) => void;
		oncancel: () => void;
		busy: boolean;
	} = $props();

	let name = $state('');
	let qualityProfileId = $state<number | null>(null);
	let rootFolderPath = $state<string | null>(null);
	let monitored = $state(true);
	let searchOnAdd = $state(true);
	let selectedTags = $state<number[]>([]);
	let minimumAvailability = $state('released');
	let seriesTypeDefault = $state('standard');
	let seasonMonitorPolicy = $state('all');

	// Sync form fields from the (optionally pre-filled) preset. The parent
	// remounts this component per editing target via {#key}.
	$effect(() => {
		name = preset?.name ?? '';
		qualityProfileId = preset?.quality_profile_id ?? null;
		rootFolderPath = preset?.root_folder_path ?? null;
		monitored = preset ? preset.monitored === 1 : true;
		searchOnAdd = preset ? preset.search_on_add === 1 : true;
		selectedTags = preset ? (JSON.parse(preset.tags_json) as number[]) : [];
		minimumAvailability = preset?.minimum_availability ?? 'released';
		seriesTypeDefault = preset?.series_type_default ?? 'standard';
		seasonMonitorPolicy = preset?.season_monitor_policy ?? 'all';
	});

	const availabilities = [
		{ value: 'announced', label: 'Announced' },
		{ value: 'inCinemas', label: 'In theaters' },
		{ value: 'released', label: 'Released' }
	];

	function toggleTag(id: number, checked: boolean) {
		selectedTags = checked ? [...selectedTags, id] : selectedTags.filter((t) => t !== id);
	}

	function save(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim() || !qualityProfileId || !rootFolderPath) return;
		onsave({
			name: name.trim(),
			qualityProfileId,
			rootFolderPath,
			monitored,
			tags: selectedTags,
			searchOnAdd,
			...(service === 'radarr' ? { minimumAvailability } : {}),
			...(service === 'sonarr'
				? { seriesTypeDefault, seasonMonitorPolicy }
				: {})
		});
	}
</script>

<form onsubmit={save}>
	<label for="pf-name">Name</label>
	<input id="pf-name" bind:value={name} placeholder={preset ? undefined : 'e.g. Kids shows'} />

	<p class="section-label">What Add does</p>
	<label for="pf-profile">Quality profile</label>
	<select id="pf-profile" bind:value={qualityProfileId}>
		<option value={null} disabled>Select profile…</option>
		{#each options.qualityProfiles as q (q.id)}
			<option value={q.id}>{q.name}</option>
		{/each}
	</select>

	<label class="check">
		<input type="checkbox" bind:checked={monitored} />
		Monitored
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={searchOnAdd} />
		Search for the title as soon as it's added
	</label>

	{#if service === 'radarr'}
		<label for="pf-minavail">Minimum availability</label>
		<select id="pf-minavail" bind:value={minimumAvailability}>
			{#each availabilities as a (a.value)}
				<option value={a.value}>{a.label}</option>
			{/each}
		</select>
	{:else}
		<label for="pf-stype">Series type</label>
		<select id="pf-stype" bind:value={seriesTypeDefault}>
			<option value="standard">Standard</option>
			<option value="daily">Daily (talk shows)</option>
			<option value="anime">Anime</option>
		</select>

		<label for="pf-smon">Season monitoring</label>
		<select id="pf-smon" bind:value={seasonMonitorPolicy}>
			<option value="all">all seasons</option>
			<option value="first">first season</option>
			<option value="latest">latest season</option>
			<option value="none">no seasons</option>
		</select>
	{/if}

	<p class="section-label">Where it goes</p>
	<label for="pf-root">Root folder</label>
	<select id="pf-root" bind:value={rootFolderPath}>
		<option value={null} disabled>Select folder…</option>
		{#each options.rootFolders as r (r.id)}
			<option value={r.path}>{r.path}</option>
		{/each}
	</select>

	<span class="section-label">Tags</span>
	{#if options.tags.length === 0}
		<p class="hint">No tags yet.</p>
	{:else}
		<div class="tag-group">
			{#each options.tags as t (t.id)}
				<label class="check">
					<input
						type="checkbox"
						checked={selectedTags.includes(t.id)}
						onchange={(e) => toggleTag(t.id, e.currentTarget.checked)}
					/>
					{t.label}
				</label>
			{/each}
		</div>
	{/if}

	<button type="submit" disabled={busy || !name.trim() || !qualityProfileId || !rootFolderPath}>
		Save preset
	</button>
	{#if !qualityProfileId || !rootFolderPath}
		<p class="hint" style="margin-top:0.4rem">Choose a quality profile and root folder to save.</p>
	{/if}
	{#if oncancel}
		<button type="button" class="secondary" onclick={oncancel}>Cancel</button>
	{/if}
</form>

<style>
	.section-label {
		display: block;
		margin: 1.25rem 0 0.3rem;
		color: var(--muted-foreground);
		font-size: 0.8rem;
		font-weight: 500;
	}
	.tag-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
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
</style>
