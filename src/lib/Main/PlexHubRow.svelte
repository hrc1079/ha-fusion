<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import type { PlexHubRowItem } from '$lib/Types';

	export let sel: PlexHubRowItem;

	type PlexItem = {
		ratingKey: string;
		title: string;
		subtitle?: string;
		type: string;
		thumb?: string;
		duration?: number;
		viewOffset?: number;
	};

	let items: PlexItem[] = [];
	let hubTitle = '';
	let loading = true;
	let errorMsg: string | undefined;
	let lastTapped: string | undefined;
	let tappedAt = 0;

	$: limit = sel?.limit && sel.limit > 0 ? sel.limit : 12;
	$: source = sel?.source ?? '';

	async function load() {
		loading = true;
		errorMsg = undefined;
		try {
			const res = await fetch(
				`${base}/_api/plex/hubs?source=${encodeURIComponent(source)}&limit=${limit}`
			);
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`(${res.status}) ${text.slice(0, 100)}`);
			}
			const data = await res.json();
			items = data.items ?? [];
			hubTitle = sel?.name || data.title || '';
		} catch (err: any) {
			errorMsg = err.message ?? 'Failed to load Plex content';
		} finally {
			loading = false;
		}
	}

	async function play(item: PlexItem) {
		// Double-tap protection: ignore if same item tapped within 1.5s
		const now = Date.now();
		if (lastTapped === item.ratingKey && now - tappedAt < 1500) return;
		lastTapped = item.ratingKey;
		tappedAt = now;

		try {
			const res = await fetch(`${base}/_api/plex/play`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ratingKey: item.ratingKey })
			});
			if (!res.ok) {
				const text = await res.text();
				console.error('Plex play failed:', res.status, text);
			}
		} catch (err) {
			console.error('Plex play error:', err);
		}
	}

	function posterUrl(item: PlexItem): string {
		if (!item.thumb) return '';
		return `${base}/_api/plex/poster?key=${encodeURIComponent(item.thumb)}&w=300&h=450`;
	}

	function progressPct(item: PlexItem): number {
		if (!item.duration || !item.viewOffset) return 0;
		return Math.min(100, Math.round((item.viewOffset / item.duration) * 100));
	}

	onMount(load);
</script>

<div class="plex-row">
	<div class="header">
		<h3>{hubTitle || sel?.name || 'Plex'}</h3>
		{#if loading}
			<span class="meta">Loading…</span>
		{:else if errorMsg}
			<span class="meta error">{errorMsg}</span>
		{:else if items.length === 0}
			<span class="meta">No items</span>
		{/if}
	</div>

	{#if !loading && !errorMsg && items.length > 0}
		<div class="strip">
			{#each items as item (item.ratingKey)}
				<button
					class="tile"
					type="button"
					on:click={() => play(item)}
					title={item.title + (item.subtitle ? ' — ' + item.subtitle : '')}
				>
					{#if item.thumb}
						<img class="poster" src={posterUrl(item)} alt={item.title} loading="lazy" />
					{:else}
						<div class="poster placeholder">No poster</div>
					{/if}
					{#if progressPct(item) > 0}
						<div class="progress">
							<div class="progress-fill" style="width: {progressPct(item)}%"></div>
						</div>
					{/if}
					<div class="title">{item.title}</div>
					{#if item.subtitle}
						<div class="subtitle">{item.subtitle}</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.plex-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem;
		min-height: 0;
	}

	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.header h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--theme-button-color-on);
	}

	.meta {
		font-size: 0.85rem;
		opacity: 0.7;
	}

	.meta.error {
		color: #f92626;
		opacity: 1;
	}

	.strip {
		display: flex;
		gap: 0.6rem;
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: 0.4rem;
		scroll-snap-type: x mandatory;
		-webkit-overflow-scrolling: touch;
	}

	.strip::-webkit-scrollbar {
		height: 6px;
	}

	.strip::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.18);
		border-radius: 3px;
	}

	.tile {
		flex: 0 0 auto;
		width: 9rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: transparent;
		border: none;
		padding: 0;
		text-align: left;
		color: inherit;
		cursor: pointer;
		scroll-snap-align: start;
		transition: transform 0.12s ease;
	}

	.tile:hover,
	.tile:focus-visible {
		transform: scale(1.03);
	}

	.tile:focus-visible {
		outline: 2px solid #ffc107;
		outline-offset: 2px;
		border-radius: 0.5rem;
	}

	.poster {
		width: 100%;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		border-radius: 0.5rem;
		background: rgba(0, 0, 0, 0.3);
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.4),
			0 1px 2px rgba(0, 0, 0, 0.2);
	}

	.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		opacity: 0.6;
	}

	.progress {
		height: 3px;
		background: rgba(255, 255, 255, 0.15);
		border-radius: 2px;
		overflow: hidden;
		margin-top: -0.25rem;
	}

	.progress-fill {
		height: 100%;
		background: #e5a00d; /* Plex orange */
	}

	.title {
		font-size: 0.85rem;
		font-weight: 500;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.subtitle {
		font-size: 0.75rem;
		opacity: 0.7;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
