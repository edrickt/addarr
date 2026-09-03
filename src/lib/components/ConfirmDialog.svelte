<script lang="ts">
	import { modal } from '$lib/actions/modal';

	let {
		title,
		body = '',
		requireText = '',
		confirmLabel = 'Confirm',
		busy = false,
		onconfirm,
		oncancel
	}: {
		title: string;
		body?: string;
		requireText?: string;
		confirmLabel?: string;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let text = $state('');

	// Reset the typed confirmation whenever the dialog opens on a new target.
	$effect(() => {
		requireText;
		text = '';
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && oncancel()} />

<div class="overlay">
	<div
		class="card dialog"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		use:modal
	>
		<h2>{title}</h2>
		{#if body}<p class="hint">{body}</p>{/if}
		{#if requireText}
			<p class="hint">This cannot be undone. Type “{requireText}” to confirm.</p>
			<input bind:value={text} placeholder={requireText} autocomplete="off" />
		{/if}
		<div class="dialog-actions">
			<button
				class="danger"
				disabled={busy || (!!requireText && text !== requireText)}
				onclick={onconfirm}
			>
				{confirmLabel}
			</button>
			<button class="secondary" onclick={oncancel}>Cancel</button>
		</div>
	</div>
</div>

<style>
	.dialog-actions {
		display: flex;
		gap: 0.5rem;
	}
	.dialog-actions button {
		margin-top: 0.9rem;
	}
</style>
