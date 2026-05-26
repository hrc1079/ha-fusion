<script lang="ts">
	import { editMode, itemHeight, lang, dashboard, states } from '$lib/Stores';
	import { openModal } from 'svelte-modals';
	import Icon, { loadIcon } from '@iconify/svelte';
	import { getSelected } from '$lib/Utils';
	import type { PlayerGroupItem } from '$lib/Types';

	export let sel: PlayerGroupItem;

	// Read live from $dashboard so config modal changes reflect immediately on the tile.
	$: item = (getSelected(sel.id, $dashboard) as PlayerGroupItem) ?? sel;

	$: name = item?.name || $lang('section') || 'Players';
	$: tileIcon = item?.icon || 'mdi:speaker-multiple';
	$: color = item?.color || 'rgba(0,0,0,0.3)';

	// Count of currently selected rooms (for the badge on the tile)
	$: selectionRaw = item?.selection_helper ? ($states[item.selection_helper]?.state ?? '') : '';
	$: selectedCount = selectionRaw
		.split(',')
		.map((s: string) => s.trim())
		.filter((s: string) => s.length > 0).length;

	$: playerCount = item?.players?.length ?? 0;

	$: subtitle = item?.selection_helper
		? `${selectedCount} of ${playerCount} selected`
		: playerCount > 0
			? `${playerCount} players`
			: 'Not configured';

	function handleClick() {
		if ($editMode) {
			openModal(() => import('$lib/Modal/PlayerGroupConfig.svelte'), { sel });
		} else {
			openModal(() => import('$lib/Modal/PlayerGroupModal.svelte'), { sel });
		}
	}
</script>

<button style:height="{$itemHeight}px" style:background-color={color} on:click={handleClick}>
	<div class="icon">
		{#await loadIcon(tileIcon)}
			<Icon icon="ph:dot" style="font-size: 1.6rem" />
		{:then resolvedIcon}
			<Icon icon={resolvedIcon} style="font-size: 1.6rem" />
		{:catch}
			<Icon icon="mdi:speaker-multiple" style="font-size: 1.6rem" />
		{/await}
	</div>

	<div class="label">
		<span class="name">{name}</span>
		<span class="state">{subtitle}</span>
	</div>
</button>

<style>
	button {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		border: none;
		border-radius: 0.65rem;
		cursor: pointer;
		padding: 0 1rem;
		color: white;
		font-family: inherit;
		font-size: 0.95rem;
		transition: filter 150ms ease;
		overflow: hidden;
	}

	button:hover {
		filter: brightness(1.15);
	}

	button:active {
		filter: brightness(0.9);
	}

	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.6rem;
		flex-shrink: 0;
		width: 2.4rem;
		height: 2.4rem;
		background-color: rgba(0, 0, 0, 0.25);
		border-radius: 50%;
		padding: 0.5rem;
	}

	.label {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
		gap: 0.1rem;
	}

	.name {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.state {
		font-size: 0.75rem;
		opacity: 0.55;
	}
</style>
