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
		<a href="/setup"><button>Run first-time setup</button></a>
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
				bind:value={pin}
				inputmode="numeric"
				autocomplete="off"
				placeholder="••••"
			/>
			<button type="submit" disabled={busy || !selected}>
				{busy ? 'Checking…' : 'Sign in'}
			</button>
			{#if msg}
				<p class="msg {msg.kind === 'ok' ? 'ok' : 'error'}">{msg.text}</p>
			{/if}
		</form>
	{/if}
</div>

<style>
	.login {
		max-width: 380px;
	}
</style>
