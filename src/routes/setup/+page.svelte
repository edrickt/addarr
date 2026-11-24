<script lang="ts">
	let username = $state('');
	let pin = $state('');
	let confirm = $state('');
	// Only needed when Setup is opened from another device; loopback setup does
	// not ask for it (the token is printed in the server's console log).
	let token = $state('');
	let msg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		msg = null;
		if (pin !== confirm) {
			msg = { kind: 'error', text: 'PINs do not match' };
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/auth/setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, pin, token: token.trim() || undefined })
			});
			const data = await res.json();
			if (res.ok) {
				// Route the admin into the connect-a-backend step, not the empty
				// search page — the setup flow ends there, not here.
				location.assign('/settings?welcome=1');
			} else {
				msg = { kind: 'error', text: data.error ?? 'Setup failed' };
			}
		} catch (err) {
			msg = { kind: 'error', text: err instanceof Error ? err.message : 'Setup failed' };
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Addarr Welcome</title>
</svelte:head>

<h1>Welcome to Addarr</h1>
<p>Create the admin account. It controls Settings and the Console — family members search and add without any account.</p>

<div class="card">
	<form onsubmit={submit}>
		<label for="setup-username">Admin username</label>
		<input id="setup-username" bind:value={username} autocomplete="off" />
		<label for="setup-pin">Admin PIN (4–6 digits)</label>
		<input id="setup-pin" type="password" bind:value={pin} inputmode="numeric" maxlength={6} autocomplete="off" />
		<label for="setup-confirm">Repeat PIN</label>
		<input id="setup-confirm" type="password" bind:value={confirm} inputmode="numeric" maxlength={6} autocomplete="off" />
		<label for="setup-token">Setup token <small>(only when you opened this page from another device)</small></label>
		<input id="setup-token" bind:value={token} autocomplete="off" placeholder="XXXX-XXXX-XXXX" />
		<p class="hint">Printed in the Addarr console log on the machine running it — <span class="mono">npm run logs</span>. Leave blank on the server itself.</p>
		<button type="submit" disabled={busy || !username || !pin || !confirm}>
			{busy ? 'Creating…' : 'Create admin account'}
		</button>
		{#if msg}
			<p class="msg {msg.kind === 'ok' ? 'ok' : 'error'}" role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>
		{/if}
	</form>
</div>
