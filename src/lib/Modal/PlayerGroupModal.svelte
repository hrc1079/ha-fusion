<script lang="ts">
	import Modal from '$lib/Modal/Index.svelte';
	import Icon from '@iconify/svelte';
	import { dashboard, states, connection, ripple } from '$lib/Stores';
	import { getSelected } from '$lib/Utils';
	import { callService } from 'home-assistant-js-websocket';
	import { closeModal } from 'svelte-modals';
	import Ripple from 'svelte-ripple';
	import type { PlayerGroupItem } from '$lib/Types';

	export let isOpen: boolean;
	export let sel: PlayerGroupItem;

	$: liveItem = (getSelected(sel.id, $dashboard) as PlayerGroupItem | undefined) ?? sel;
	$: name = liveItem?.name || 'Players';
	$: players = liveItem?.players ?? [];
	$: sourcePlayer = liveItem?.source_player;
	$: selectionHelper = liveItem?.selection_helper;

	// Parse the current selection from the helper into a Set of entity_ids
	$: selectionRaw = selectionHelper ? ($states[selectionHelper]?.state ?? '') : '';
	$: selected = new Set(
		selectionRaw
			.split(',')
			.map((s: string) => s.trim())
			.filter((s: string) => s.length > 0)
	);

	$: sourceState = sourcePlayer ? $states[sourcePlayer] : undefined;
	$: sourceTitle = sourceState?.attributes?.media_title as string | undefined;
	$: sourceArtist = sourceState?.attributes?.media_artist as string | undefined;
	$: sourcePlaying = sourceState?.state === 'playing';

	let busy = false;

	async function writeSelection(next: Set<string>) {
		if (!selectionHelper || !$connection) return;
		const value = Array.from(next).join(',');
		await callService($connection, 'input_text', 'set_value', {
			entity_id: selectionHelper,
			value
		});
	}

	async function toggleRoom(entity_id: string) {
		if (busy) return;
		const next = new Set(selected);
		if (next.has(entity_id)) {
			next.delete(entity_id);
		} else {
			next.add(entity_id);
		}
		await writeSelection(next);
	}

	async function clearSelection() {
		if (busy || !selectionHelper) return;
		await writeSelection(new Set());
	}

	async function castSelection() {
		if (busy || !$connection) return;
		if (!sourcePlayer) {
			console.warn('PlayerGroup: no source_player configured');
			return;
		}
		if (selected.size === 0) {
			console.warn('PlayerGroup: nothing selected');
			return;
		}

		busy = true;
		try {
			const targets = Array.from(selected);
			const [primary, ...rest] = targets;

			// Move the queue from the source player to the primary target.
			// If primary IS the source, transfer_queue is a no-op; skip it.
			if (primary !== sourcePlayer) {
				await callService($connection, 'music_assistant', 'transfer_queue', {
					source_player: sourcePlayer,
					auto_play: true,
					entity_id: primary
				});
			}

			// Join any additional rooms to the primary so they all play in sync.
			if (rest.length > 0) {
				await callService($connection, 'media_player', 'join', {
					entity_id: primary,
					group_members: rest
				});
			}

			closeModal();
		} catch (err) {
			console.error('PlayerGroup cast failed:', err);
		} finally {
			busy = false;
		}
	}

	function playerState(entity_id: string) {
		return $states[entity_id]?.state;
	}
</script>

{#if isOpen}
	<Modal>
		<h1 slot="title">{name}</h1>

		{#if sourcePlayer}
			<div class="source-row">
				<Icon icon="mdi:music-circle" style="font-size: 1.4rem; opacity: 0.7" />
				<div class="source-meta">
					<span class="source-label">Source</span>
					<span class="source-name">
						{sourceState?.attributes?.friendly_name || sourcePlayer}
					</span>
					{#if sourcePlaying && sourceTitle}
						<span class="source-now">
							{sourceTitle}{sourceArtist ? ` — ${sourceArtist}` : ''}
						</span>
					{:else}
						<span class="source-now muted">Not playing</span>
					{/if}
				</div>
			</div>
		{:else}
			<p class="empty">No source player configured. Edit this tile to set one.</p>
		{/if}

		{#if players.length === 0}
			<p class="empty">No players configured. Edit this tile to add rooms.</p>
		{:else if !selectionHelper}
			<p class="empty">No selection helper configured. Edit this tile to set one.</p>
		{:else}
			<div class="rows">
				{#each players as p (p.entity_id)}
					{@const isSelected = selected.has(p.entity_id)}
					{@const stateStr = playerState(p.entity_id)}
					{@const isPlaying = stateStr === 'playing'}
					{@const friendly =
						p.name || $states[p.entity_id]?.attributes?.friendly_name || p.entity_id}
					<button
						class="row"
						class:selected={isSelected}
						on:click={() => toggleRoom(p.entity_id)}
						use:Ripple={$ripple}
					>
						<div class="check">
							{#if isSelected}
								<Icon icon="mdi:check-circle" style="font-size: 1.5rem" />
							{:else}
								<Icon
									icon="mdi:checkbox-blank-circle-outline"
									style="font-size: 1.5rem; opacity: 0.45"
								/>
							{/if}
						</div>
						<div class="row-icon">
							<Icon icon={p.icon || 'mdi:speaker'} style="font-size: 1.4rem" />
						</div>
						<div class="row-text">
							<span class="row-name">{friendly}</span>
							<span class="row-state" class:playing={isPlaying}>
								{stateStr ?? 'unavailable'}
							</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}

		<div class="actions">
			<button
				class="action clear"
				on:click={clearSelection}
				disabled={selected.size === 0 || busy}
				use:Ripple={$ripple}
			>
				Clear
			</button>
			<button
				class="action cast"
				on:click={castSelection}
				disabled={selected.size === 0 || !sourcePlayer || busy}
				use:Ripple={{ ...$ripple, color: 'rgba(0, 0, 0, 0.35)' }}
			>
				{busy ? 'Casting…' : `Cast to ${selected.size}`}
			</button>
		</div>
	</Modal>
{/if}

<style>
	.source-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.8rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 0.5rem;
		margin-bottom: 0.8rem;
	}
	.source-meta {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.source-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.55;
	}
	.source-name {
		font-weight: 500;
		font-size: 0.95rem;
	}
	.source-now {
		font-size: 0.8rem;
		opacity: 0.7;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.source-now.muted {
		opacity: 0.45;
	}

	.empty {
		opacity: 0.6;
		font-size: 0.9rem;
		padding: 0.6rem 0;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0.4rem 0 0.9rem;
		max-height: 50vh;
		overflow-y: auto;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		padding: 0.6rem 0.7rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.04);
		color: inherit;
		font-family: inherit;
		font-size: 0.95rem;
		cursor: pointer;
		text-align: left;
		transition:
			background-color 150ms ease,
			border-color 150ms ease;
	}

	.row:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.row.selected {
		background: rgba(29, 185, 84, 0.18);
		border-color: rgba(29, 185, 84, 0.55);
	}

	.check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
	}

	.row-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.8rem;
		opacity: 0.85;
	}

	.row-text {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		flex: 1;
		min-width: 0;
	}

	.row-name {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-state {
		font-size: 0.72rem;
		opacity: 0.55;
		text-transform: capitalize;
	}

	.row-state.playing {
		color: #1db954;
		opacity: 0.95;
	}

	.actions {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		padding-top: 1.1rem;
		margin-top: 0.4rem;
	}

	.action {
		padding: 0.55rem 1.2rem;
		border: none;
		border-radius: 0.5rem;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 500;
		cursor: pointer;
		color: inherit;
	}

	.action.clear {
		background: rgba(255, 255, 255, 0.08);
		color: white;
	}

	.action.clear:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.15);
	}

	.action.cast {
		background: #1db954;
		color: #0a3318;
	}

	.action.cast:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
