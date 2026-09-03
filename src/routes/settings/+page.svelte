<script lang="ts">
	type ServiceKind = 'radarr' | 'sonarr';

	type FormState = {
		name: string;
		baseUrl: string;
		apiKey: string;
	};

	type Status = { kind: 'ok' | 'error'; text: string } | null;

	let radarr: FormState = $state({ name: 'Radarr', baseUrl: '', apiKey: '' });
	let sonarr: FormState = $state({ name: 'Sonarr', baseUrl: '', apiKey: '' });
	let statuses: Record<ServiceKind, Status> = $state({ radarr: null, sonarr: null });
	let busy: Record<ServiceKind, boolean> = $state({ radarr: false, sonarr: false });
	let saved: Array<{ type: string; name: string; base_url: string; app_version: string | null }> =
		$state([]);

	async function loadSaved() {
		const res = await fetch('/api/services');
		const data = await res.json();
		saved = data.services ?? [];
		for (const s of saved) {
			const kind = s.type as ServiceKind;
			const form = kind === 'radarr' ? radarr : sonarr;
			form.name = s.name;
			form.baseUrl = s.base_url;
		}
	}
	$effect(() => {
		loadSaved();
	});

	async function save(kind: ServiceKind) {
		const form = kind === 'radarr' ? radarr : sonarr;
		busy[kind] = true;
		statuses[kind] = null;
		try {
			const res = await fetch('/api/services', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: kind, ...form })
			});
			const data = await res.json();
			statuses[kind] = res.ok
				? { kind: 'ok', text: `Connected — ${data.appName} v${data.appVersion}` }
				: { kind: 'error', text: data.error ?? 'Failed' };
			if (res.ok) await loadSaved();
		} catch (err) {
			statuses[kind] = { kind: 'error', text: err instanceof Error ? err.message : 'Failed' };
		} finally {
			busy[kind] = false;
		}
	}
	const kinds: ServiceKind[] = ['radarr', 'sonarr'];
</script>

<svelte:head>
	<title>Settings — Addarr</title>
</svelte:head>

<h1>Settings</h1>

{#each kinds as kind}
	{@const form = kind === 'radarr' ? radarr : sonarr}
	{@const s = statuses[kind]}
	{@const b = busy[kind]}
	<div class="card">
		<h2>{kind === 'radarr' ? 'Radarr' : 'Sonarr'}</h2>
		<label for={`${kind}-name`}>Name</label>
		<input id={`${kind}-name`} bind:value={form.name} />
		<label for={`${kind}-url`}>Base URL</label>
		<input
			id={`${kind}-url`}
			bind:value={form.baseUrl}
			placeholder={`http://192.168.1.x:${kind === 'radarr' ? 7878 : 8989}`}
		/>
		<label for={`${kind}-key`}>API key</label>
		<input id={`${kind}-key`} bind:value={form.apiKey} placeholder="X-Api-Key from Settings → General" />
		<button onclick={() => save(kind)} disabled={b}>
			{b ? 'Testing…' : 'Test & Save'}
		</button>
		{#if s}
			<p class="msg {s.kind === 'ok' ? 'ok' : 'error'}">{s.text}</p>
		{/if}
	</div>
{/each}

{#if saved.length > 0}
	<div class="card">
		<h2>Configured</h2>
		<ul>
			{#each saved as s}
				<li>
					{s.name} ({s.type}) → {s.base_url}
					{#if s.app_version}· v{s.app_version}{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}
