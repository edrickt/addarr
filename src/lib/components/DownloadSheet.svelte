<script lang="ts">
	import { modal } from '$lib/actions/modal';
	import type { DownloadDetail } from '$lib/arr/downloads';
	import {
		formatBytes,
		formatTimeLeft,
		initials,
		memberProgressBar,
		memberStateLabel,
		memberStateTone
	} from '$lib/arr/presentation';

	let { item, onclose }: { item: DownloadDetail; onclose: () => void } = $props();

	const tone = $derived(memberStateTone(item.state));
	const label = $derived(memberStateLabel(item.state, item.episodes));
	const bar = $derived(memberProgressBar(item.state, item.progress));
	const downloaded = $derived(
		item.size != null && item.sizeLeft != null
			? Math.max(0, item.size - item.sizeLeft)
			: null
	);
	const showDetails = $derived(
		(item.state === 'downloading' && item.timeLeftSeconds != null) ||
			(item.size != null && item.size > 0 && downloaded != null) ||
			item.episodes != null
	);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="overlay">
	<div
		class="card dialog download-sheet"
		role="dialog"
		aria-modal="true"
		aria-label={`${item.title} download status`}
		tabindex="-1"
		use:modal
	>
		<div class="sheet-head">
			<div class="poster">
				<span class="poster-fallback mono">{initials(item.title)}</span>
				{#if item.posterUrl}
					<img
						src={item.posterUrl}
						alt=""
						onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
					/>
				{/if}
			</div>

			<div class="sheet-copy">
				<h2>
					{item.title}{#if item.year}<span class="year"> ({item.year})</span>{/if}
				</h2>
				<p class="state-line">
					<span
						class="dot"
						class:active={tone === 'active'}
						class:warn={tone === 'warn'}
						class:ok={tone === 'ok'}
					></span>
					{label}
				</p>

				{#if bar}
					<div
						class="progress"
						role="progressbar"
						aria-label="Download progress"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={bar.mode === 'determinate' ? Math.round(bar.progress ?? 0) : undefined}
					>
						<div
							class="progress-fill"
							class:indeterminate={bar.mode === 'indeterminate'}
							class:tone-warning={bar.tone === 'warning'}
							class:tone-muted={bar.tone === 'muted'}
							style={bar.mode === 'determinate'
								? `transform: scaleX(${Math.min(1, Math.max(0, (bar.progress ?? 0) / 100))})`
								: ''}
						></div>
					</div>
				{/if}
			</div>
		</div>

		{#if showDetails}
			<dl class="details">
				{#if item.state === 'downloading' && item.timeLeftSeconds != null}
					<div>
						<dt>Time left</dt>
						<dd class="mono">{formatTimeLeft(item.timeLeftSeconds)}</dd>
					</div>
				{/if}
				{#if item.size != null && item.size > 0 && downloaded != null}
					<div>
						<dt>Downloaded</dt>
						<dd class="mono">{formatBytes(downloaded)} of {formatBytes(item.size)}</dd>
					</div>
				{/if}
				{#if item.episodes}
					<div>
						<dt>Episodes</dt>
						<dd class="mono">{item.episodes.have} of {item.episodes.total}</dd>
					</div>
				{/if}
			</dl>
		{/if}

		<p class="hint read-only">This view is read-only. Ask an admin to change or remove a download.</p>

		<div class="sheet-actions">
			<button class="secondary" onclick={onclose}>Close</button>
		</div>
	</div>
</div>

<style>
	.download-sheet {
		max-width: 560px;
	}
	.sheet-head {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 1rem;
		align-items: start;
	}
	.poster {
		position: relative;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		background: var(--elevated);
		border: 1px solid var(--border);
	}
	.poster-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 1.35rem;
		color: var(--muted-foreground);
		letter-spacing: 0.05em;
	}
	.poster img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.sheet-copy {
		min-width: 0;
	}
	.sheet-copy h2 {
		margin-top: 0;
		font-size: 1.05rem;
		line-height: 1.3;
	}
	.year {
		color: var(--muted-foreground);
		font-weight: 400;
	}
	.state-line {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0.35rem 0 0.6rem;
		font-size: 0.9rem;
		font-weight: 450;
	}
	.state-line .dot {
		margin-right: 0;
	}
	.progress {
		position: relative;
		height: 4px;
		overflow: hidden;
		background: var(--border);
	}
	.progress-fill {
		height: 100%;
		width: 100%;
		background: var(--primary);
		transform-origin: left;
		transition: transform 1s ease;
	}
	.progress-fill.tone-warning {
		background: var(--warning);
		transition: none;
	}
	.progress-fill.tone-muted {
		background: var(--muted-foreground);
	}
	.progress-fill.indeterminate {
		width: 25%;
		transform: none;
		transition: none;
		animation: sheet-progress-slide 1.4s ease-in-out infinite;
	}
	@keyframes sheet-progress-slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(400%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.progress-fill {
			transition: none;
		}
		.progress-fill.indeterminate {
			animation: none;
		}
	}
	.details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
		margin: 1.1rem 0 0;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border);
	}
	.details div {
		min-width: 0;
	}
	.details dt {
		color: var(--muted-foreground);
		font-size: 0.72rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.details dd {
		margin: 0.15rem 0 0;
		font-size: 0.9rem;
	}
	.read-only {
		margin-top: 1rem;
	}
	.sheet-actions button {
		margin-top: 0;
	}
	@media (max-width: 520px) {
		.sheet-head {
			grid-template-columns: 82px 1fr;
		}
	}
</style>
