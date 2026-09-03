<script lang="ts">
	import PresetForm from '$lib/components/PresetForm.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	type PresetRow = {
		id: number;
		service_id: number;
		name: string;
		is_default: number;
		quality_profile_id: number;
		root_folder_path: string;
		monitored: number;
		tags_json: string;
		minimum_availability: string | null;
		search_on_add: number;
		series_type_default: string | null;
		season_monitor_policy: string | null;
	};

	type Option = { id: number; name?: string; path?: string; label?: string };

	let service = $state<'radarr' | 'sonarr'>('radarr');
	let presets = $state<PresetRow[]>([]);
	let options = $state<{ qualityProfiles: Option[]; rootFolders: Option[]; tags: Option[] } | null>(null);
	let msg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let busy = $state(false);

	let editing = $state<PresetRow | null>(null);
	let deleting = $state<PresetRow | null>(null);
	let showNew = $state(false);

	async function load() {
		msg = null;
		try {
			const res = await fetch(`/api/presets?service=${service}`);
			const data = await res.json();
			if (!res.ok) {
				presets = [];
				options = null;
				msg = { kind: 'error', text: data.error ?? 'Failed to load' };
				return;
			}
			presets = data.presets;
			options = data.options;
			// First visit with no presets: open the form — it powers the member
			// Add button, so an empty list must lead straight to creation.
			showNew = presets.length === 0;
		} catch {
			msg = { kind: 'error', text: 'Failed to load presets' };
		}
	}
	$effect(() => {
		load();
	});

	async function send(method: string, body?: unknown, extraQs = '', okText = 'Preset saved') {
		msg = null;
		busy = true;
		try {
			const res = await fetch(`/api/presets?service=${service}${extraQs}`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: body ? JSON.stringify(body) : undefined
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				await load();
				editing = null;
				showNew = false;
				msg = { kind: 'ok', text: okText };
			} else {
				msg = { kind: 'error', text: data.error ?? 'Failed' };
			}
		} finally {
			busy = false;
		}
	}

	function tagLabels(jsonStr: string): string {
		const ids = JSON.parse(jsonStr) as number[];
		if (ids.length === 0) return '—';
		return ids
			.map((id) => options?.tags.find((t) => t.id === id)?.label ?? `#${id}`)
			.join(', ');
	}
</script>

<svelte:head>
	<title>Presets — Addarr</title>
</svelte:head>

<h1>Presets</h1>
<p>Presets decide what the <strong>Add</strong> button does: quality, folder, monitoring, and whether a search starts.</p>

<div class="tabs">
	<button class="tab" class:active={service === 'radarr'} onclick={() => (service = 'radarr')}>Radarr</button>
	<button class="tab" class:active={service === 'sonarr'} onclick={() => (service = 'sonarr')}>Sonarr</button>
</div>

{#if msg}<p class="msg {msg.kind === 'ok' ? 'ok' : 'error'}" role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>{/if}

{#if !options}
	<p class="hint">Connect {service} in Settings first.</p>
{:else}
	<div class="card">
		<h2>{service === 'radarr' ? 'Radarr' : 'Sonarr'} presets</h2>
		<ul class="preset-list">
			{#each presets as p (p.id)}
				<li>
					<div class="preset-info">
						<strong>{p.name}</strong>
						{#if p.is_default}<span class="tag default">default</span>{/if}
						<small>
							{options.qualityProfiles.find((q) => q.id === p.quality_profile_id)?.name ?? `profile ${p.quality_profile_id}`}
							· {p.root_folder_path}
							· {p.monitored ? 'monitored' : 'unmonitored'}
							· search: {p.search_on_add ? 'on' : 'off'}
							· tags: {tagLabels(p.tags_json)}
							{#if service === 'sonarr'}
								· {p.series_type_default}/{p.season_monitor_policy}
							{/if}
						</small>
					</div>
					<div class="actions">
						{#if !p.is_default}
							<button class="secondary" disabled={busy} onclick={() => send('PATCH', { isDefault: true }, `&id=${p.id}`, 'Default updated')}>
								Make default
							</button>
						{/if}
						<button class="secondary" onclick={() => (editing = p)}>Edit</button>
						<button class="secondary danger" disabled={busy} onclick={() => (deleting = p)}>
							Delete
						</button>
					</div>
				</li>
			{:else}
				<li><small>No presets yet — the form below creates the one that powers your family's <strong>Add</strong> button.</small></li>
			{/each}
		</ul>
	</div>

	{#if editing || showNew}
		<div class="card">
			<h2>{editing ? `Edit “${editing.name}”` : 'New preset'}</h2>
			<PresetForm
				{service}
				{options}
				preset={editing}
				oncancel={() => {
					editing = null;
					showNew = false;
				}}
				onsave={(body: Record<string, unknown>) => send(editing ? 'PATCH' : 'POST', body, editing ? `&id=${editing.id}` : '')}
				{busy}
			/>
		</div>
	{:else}
		<button class="secondary" onclick={() => (showNew = true)}>New preset</button>
	{/if}

	{#if deleting}
		<ConfirmDialog
			title={`Delete preset “${deleting.name}”?`}
			body={deleting.is_default
				? 'This is the default preset — the member Add button stops working until you pick a new default.'
				: 'This preset is not the default, so the member Add button is unaffected.'}
			requireText={deleting.name}
			confirmLabel="Delete preset"
			busy={busy}
			onconfirm={() => {
				const d = deleting;
				deleting = null;
				if (d) send('DELETE', undefined, `&id=${d.id}`, 'Preset deleted');
			}}
			oncancel={() => (deleting = null)}
		/>
	{/if}
{/if}

<style>
	.tabs {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 1rem;
	}
	.tab {
		margin-top: 0;
		background: var(--card);
		border: 1px solid var(--border);
		color: var(--muted-foreground);
		font-weight: 500;
		padding: 0.35rem 0.9rem;
		border-radius: var(--radius);
		font-size: 0.875rem;
	}
	.tab:hover {
		color: var(--foreground);
	}
	.tab.active {
		background: var(--foreground);
		border-color: var(--foreground);
		color: var(--background);
		font-weight: 450;
	}
	.preset-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.preset-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border);
	}
	.preset-list li:last-child {
		border-bottom: none;
	}
	.preset-info small {
		display: block;
		color: var(--muted-foreground);
	}
	.tag {
		font-size: 0.72rem;
		font-weight: 450;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		padding: 0.05rem 0.45rem;
		margin-left: 0.4rem;
		color: var(--muted-foreground);
	}
	.tag.default {
		color: var(--primary);
		border-color: color-mix(in srgb, var(--primary) 40%, transparent);
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
</style>
