<script lang="ts">
	import { page } from '$app/state';

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

	let saveError: string | null = $state(null);
	async function loadSaved() {
		saveError = null;
		try {
			const res = await fetch('/api/services');
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				saveError = (d as { error?: string }).error ?? `Could not load saved services (${res.status})`;
				return;
			}
			const data = await res.json();
			saved = data.services ?? [];
			for (const s of saved) {
				const kind = s.type as ServiceKind;
				const form = kind === 'radarr' ? radarr : sonarr;
				form.name = s.name;
				form.baseUrl = s.base_url;
			}
		} catch {
			/* keep whatever the forms already show — saving still works */
		}
	}
	$effect(() => {
		loadSaved();
		loadLan();
	});

	$effect(() => {
		if (welcome && saved.length > 0) checkPresets();
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

	// First-run handoff from /setup: guide the admin to connect an instance,
	// then confirm the household is ready to go.
	const welcome = page.url.searchParams.get('welcome') === '1';

	// Step 2 of onboarding: the member Add button needs a default preset.
	let hasDefaultPreset = $state<boolean | null>(null);

	async function checkPresets() {
		try {
			const kinds: ServiceKind[] = saved.map((s) => s.type as ServiceKind);
			const results = await Promise.all(
				kinds.map((k) =>
					fetch(`/api/presets?service=${k}`)
						.then((r) => (r.ok ? r.json() : { presets: [] }))
						.catch(() => ({ presets: [] }))
				)
			);
			hasDefaultPreset = results.some((d) =>
				((d.presets ?? []) as Array<{ is_default?: number }>).some((p) => p.is_default)
			);
		} catch {
			hasDefaultPreset = null;
		}
	}

	// Server restart — moved here from the topbar so a whole-household
	// interruption sits behind a deliberate two-step confirmation.
	let restartAsk = $state(false);
	let restarting = $state(false);
	let restartStatus = $state<string | null>(null);

	async function restartApp() {
		if (restarting) return;
		restarting = true;
		restartAsk = false;
		try {
			const res = await fetch('/api/restart', { method: 'POST' });
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				restartStatus = (d as { error?: string }).error ?? `Restart failed (${res.status})`;
				restarting = false;
				return;
			}
		} catch {
			/* the server may drop the connection mid-restart — expected */
		}
		// Poll until the new process is answering, then reload.
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 1000));
			try {
				const res = await fetch('/', { cache: 'no-store' });
				if (res.ok) {
					location.reload();
					return;
				}
			} catch {
				/* still down, keep polling */
			}
		}
		restartStatus = 'Addarr did not come back within 30 s — check the log (npm run logs), then reload this page.';
		restarting = false;
	}

	let lan = $state<{ enabled: boolean; broadcasting: boolean; boundLan: boolean; forced: boolean; managedExternally: boolean; host: string | null; port: number | null; addresses: string[] } | null>(null);
	let lanBusy = $state(false);
	let lanStatus: Status = $state(null);

	async function loadLan() {
		try {
			const res = await fetch('/api/settings/lan');
			if (res.ok) lan = await res.json();
			else lanStatus = { kind: 'error', text: 'Could not load network settings.' };
		} catch {
			lanStatus = { kind: 'error', text: 'Could not load network settings — reload to retry.' };
		}
	}

	async function toggleLan() {
		if (!lan) return;
		lanBusy = true;
		lanStatus = null;
		try {
			const res = await fetch('/api/settings/lan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !lan.enabled })
			});
			const data = await res.json();
			if (!res.ok) {
				lanStatus = { kind: 'error', text: data.error ?? 'Failed' };
			} else if (data.enabled && data.broadcasting === false) {
				lanStatus = { kind: 'error', text: 'LAN is on, but discovery failed — check the server log.' };
			} else {
				lanStatus = { kind: 'ok', text: data.message ?? (data.broadcasting ? 'Broadcasting on the LAN.' : 'LAN sharing off.') };
			}
			if (res.ok) await loadLan();
		} catch {
			lanStatus = { kind: 'error', text: 'Request failed' };
		} finally {
			lanBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Addarr Settings</title>
</svelte:head>

<h1>Settings</h1>

{#if welcome}
	<div class="card welcome">
		{#if saved.length === 0}
			<h2>Almost done</h2>
			<p class="hint">Connect Radarr or Sonarr below. After that, one more step and your family is live.</p>
		{:else if hasDefaultPreset === false}
			<h2>One step left</h2>
			<p class="hint">Create your first preset — it decides what the <strong>Add</strong> button does for your family.</p>
			<a class="button-link" href="/presets">Open Presets</a>
		{:else}
			<h2>You're set</h2>
			<p class="hint">Hand your family <span class="mono">http://addarr.local:{lan?.port ?? 4545}</span> (or your machine's IP — the address is printed in the server console). Searching and adding needs no account.</p>
		{/if}
	</div>
{/if}

{#each kinds as kind}
	{@const form = kind === 'radarr' ? radarr : sonarr}
	{@const s = statuses[kind]}
	{@const b = busy[kind]}
	{@const svc = saved.find((sv) => sv.type === kind)}
	<div class="card">
		<h2>{kind === 'radarr' ? 'Radarr' : 'Sonarr'}</h2>
		{#if svc}
			<p class="msg ok">Connected — {svc.base_url}{#if svc.app_version} · v{svc.app_version}{/if}</p>
		{/if}
		<label for={`${kind}-name`}>Name</label>
		<input id={`${kind}-name`} bind:value={form.name} />
		<label for={`${kind}-url`}>Base URL</label>
		<input
			id={`${kind}-url`}
			bind:value={form.baseUrl}
			placeholder={`http://192.168.1.x:${kind === 'radarr' ? 7878 : 8989}`}
		/>
		<label for={`${kind}-key`}>API key</label>
		<input id={`${kind}-key`} type="password" bind:value={form.apiKey} placeholder="X-Api-Key from Settings → General" autocomplete="off" />
		<button onclick={() => save(kind)} disabled={b}>
			{b ? 'Testing…' : 'Test & Save'}
		</button>
		{#if s}
			<p class="msg {s.kind === 'ok' ? 'ok' : 'error'}" role={s.kind === 'error' ? 'alert' : 'status'}>{s.text}</p>
		{/if}
	</div>
{/each}

{#if saveError}<p class="msg error" role="alert">{saveError} <button class="secondary" onclick={loadSaved}>Retry</button></p>{/if}
<div class="card">
	<h2>Network</h2>
	{#if lan}
		<label class="check">
			<input
				type="checkbox"
				checked={lan.enabled || lan.forced}
				disabled={lanBusy || lan.forced}
				onchange={toggleLan}
			/>
			Share on LAN (discoverable via mDNS/Bonjour as “Addarr”)
		</label>
		<p class="hint">
			{#if lan.forced}
				Forced on via --lan / ADDARR_LAN=1 in the command that started Addarr.
			{:else if lan.broadcasting}
				On — other devices can reach Addarr and see it in network discovery.
			{:else if lan.enabled && !lan.boundLan}
				Saved on — restart Addarr to make it reachable on the LAN.
			{:else if lan.enabled}
				Preference on, but not broadcasting on this session.
			{:else}
				Off — Addarr is reachable from this machine only.
			{/if}
			{#if lan.addresses?.length}
				<br />Reachable at {#each lan.addresses as addr, i}{i > 0 ? ', ' : ''}<span class="mono">http://{addr}:{lan.port ?? 4545}</span>{/each}{#if lan.host && lan.host !== '0.0.0.0'} (bound to <span class="mono">{lan.host}</span> via HOST){/if}
			{/if}
		</p>
		<p class="hint">To keep Addarr off the Tailnet, bind one interface: <span class="mono">HOST=192.168.1.x npm start</span> (your LAN IP).</p>
		{#if lanStatus}<p class="msg {lanStatus.kind}" role={lanStatus.kind === 'error' ? 'alert' : 'status'}>{lanStatus.text}</p>{/if}
	{:else if lanStatus}
		<p class="msg {lanStatus.kind}" role={lanStatus.kind === 'error' ? 'alert' : 'status'}>{lanStatus.text}</p>
	{:else}
		<p class="hint">Loading…</p>
	{/if}
</div>

<div class="card">
	<h2>Server</h2>
	{#if restarting}
		<p class="hint">Restarting… this page reloads automatically when Addarr is back.</p>
	{:else if restartStatus}
		<p class="msg error" role="alert">{restartStatus}</p>
		<button class="secondary" onclick={() => (restartStatus = null)}>Dismiss</button>
	{:else if restartAsk}
		<p class="hint">Restart Addarr? Everyone loses access for a few seconds.</p>
		<button class="danger" onclick={restartApp}>Restart now</button>
		<button class="secondary" onclick={() => (restartAsk = false)}>Cancel</button>
	{:else}
		<p class="hint">Applies settings marked “restart Addarr to make it reachable.”</p>
		<button class="secondary" onclick={() => (restartAsk = true)}>Restart server…</button>
	{/if}
</div>

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
