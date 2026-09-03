<script lang="ts">
	let { data } = $props();

	let username = $state<string | null>(null);
	let pin = $state('');
	const selected = $derived(username ?? data.usernames[0] ?? '');

	// Pre-select the first admin once the option list hydrates.
	$effect(() => {
		if (username === null && data.usernames.length > 0) username = data.usernames[0];
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		msg = null;
		busy = true;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: selected, pin })
			});
			const body = await res.json();
			if (res.ok) {
				location.assign('/');
			} else {
				msg = { kind: 'error', text: body.error ?? 'Login failed' };
				pin = '';
			}
		} catch (err) {
			msg = { kind: 'error', text: err instanceof Error ? err.message : 'Login failed' };
		} finally {
			busy = false;
		}
	}

	let msg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let busy = $state(false);
</script>

<svelte:head>
	<title>Admin sign in — Addarr</title>
</svelte:head>

<h1>Admin sign in</h1>
<p class="hint">Only for managing settings and the console. Searching and adding needs no account.</p>

<div class="card login">
	{#if data.usernames.length === 0}
		<p class="hint">No admin account exists yet.</p>
		<a class="button-link" href="/setup">Run first-time setup</a>
	{:else}
		<form onsubmit={submit}>
			<label for="login-user">Admin</label>
			<select id="login-user" bind:value={username}>
				{#each data.usernames as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
			<label for="login-pin">PIN</label>
			<input
				id="login-pin"
				type="password"
				bind:value={pin}
				inputmode="numeric"
				maxlength={6}
				autocomplete="off"
				placeholder="••••"
			/>
			<button type="submit" disabled={busy || !selected}>
				{busy ? 'Checking…' : 'Sign in'}
			</button>
			{#if msg}
				<p class="msg {msg.kind === 'ok' ? 'ok' : 'error'}" role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>
			{/if}
		</form>
	{/if}
	<p class="hint" style="margin-top:0.9rem">Forgot the PIN? It lives only on this server — ask whoever runs it.</p>
</div>

<style>
	.login {
		max-width: 380px;
	}
	.button-link {
		display: inline-block;
		background: var(--primary);
		color: var(--primary-foreground);
		padding: 0.45rem 0.9rem;
		border-radius: var(--radius);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 450;
	}
	.button-link:hover {
		background: var(--primary-hover);
	}
</style>
