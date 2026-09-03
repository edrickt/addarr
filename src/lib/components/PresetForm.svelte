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

	const availabilities = ['announced', 'inCinemas', 'released'];

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

	<label for="pf-profile">Quality profile</label>
	<select id="pf-profile" bind:value={qualityProfileId}>
		<option value={null} disabled>Select profile…</option>
		{#each options.qualityProfiles as q (q.id)}
			<option value={q.id}>{q.name}</option>
		{/each}
	</select>

	<label for="pf-root">Root folder</label>
	<select id="pf-root" bind:value={rootFolderPath}>
		<option value={null} disabled>Select folder…</option>
		{#each options.rootFolders as r (r.id)}
			<option value={r.path}>{r.path}</option>
		{/each}
	</select>

	<label for="pf-tags">Tags</label>
	<select id="pf-tags" multiple bind:value={selectedTags} size={Math.min(4, Math.max(1, options.tags.length))}>
		{#each options.tags as t (t.id)}
			<option value={t.id}>{t.label}</option>
		{/each}
	</select>

	<label class="check">
		<input type="checkbox" bind:checked={monitored} />
		Monitored
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={searchOnAdd} />
		Search when added (addOptions.searchFor*)
	</label>

	{#if service === 'radarr'}
		<label for="pf-minavail">Minimum availability</label>
		<select id="pf-minavail" bind:value={minimumAvailability}>
			{#each availabilities as a (a)}
				<option value={a}>{a}</option>
			{/each}
		</select>
	{:else}
		<label for="pf-stype">Series type</label>
		<select id="pf-stype" bind:value={seriesTypeDefault}>
			<option value="standard">standard</option>
			<option value="daily">daily</option>
			<option value="anime">anime</option>
		</select>

		<label for="pf-smon">Season monitoring</label>
		<select id="pf-smon" bind:value={seasonMonitorPolicy}>
			<option value="all">all seasons</option>
			<option value="first">first season</option>
			<option value="latest">latest season</option>
			<option value="none">no seasons</option>
		</select>
	{/if}

	<button type="submit" disabled={busy || !name.trim() || !qualityProfileId || !rootFolderPath}>
		Save preset
	</button>
	{#if oncancel}
		<button type="button" class="secondary" onclick={oncancel}>Cancel</button>
	{/if}
</form>

<style>
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
	}
</style>
