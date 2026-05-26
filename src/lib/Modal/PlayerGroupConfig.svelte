<script lang="ts">
	import { dashboard, lang, ripple, states, entityList } from '$lib/Stores';
	import Modal from '$lib/Modal/Index.svelte';
	import ConfigButtons from '$lib/Modal/ConfigButtons.svelte';
	import Select from '$lib/Components/Select.svelte';
	import InputClear from '$lib/Components/InputClear.svelte';
	import Icon from '@iconify/svelte';
	import Ripple from 'svelte-ripple';
	import { getSelected } from '$lib/Utils';
	import type { PlayerGroupItem, PlayerGroupPlayer } from '$lib/Types';

	export let isOpen: boolean;
	export let sel: PlayerGroupItem;

	let name: string | undefined = sel?.name;
	let icon: string | undefined = sel?.icon;
	let color: string | undefined = sel?.color;
	let sourcePlayer: string | undefined = sel?.source_player;
	let selectionHelper: string | undefined = sel?.selection_helper;
	let players: PlayerGroupPlayer[] = sel?.players ? [...sel.players] : [];

	$: mediaPlayerEntities = $entityList('media_player');
	$: inputTextEntities = $entityList('input_text');

	function patch<K extends keyof PlayerGroupItem>(key: K, value: PlayerGroupItem[K]) {
		const found = getSelected(sel.id, $dashboard) as PlayerGroupItem | undefined;
		if (!found) return;
		if (value === undefined || value === '') {
			delete (found as any)[key];
		} else {
			(found as any)[key] = value;
		}
		$dashboard = $dashboard;
	}

	function handleName(event: Event) {
		const val = (event.target as HTMLInputElement).value || undefined;
		name = val;
		patch('name', val);
	}

	function handleIcon(event: Event) {
		const val = (event.target as HTMLInputElement).value || undefined;
		icon = val;
		patch('icon', val);
	}

	function handleColor(event: Event) {
		const val = (event.target as HTMLInputElement).value || undefined;
		color = val;
		patch('color', val);
	}

	function handleSource(detail: string | undefined) {
		sourcePlayer = detail || undefined;
		patch('source_player', sourcePlayer);
	}

	function handleSelectionHelper(detail: string | undefined) {
		selectionHelper = detail || undefined;
		patch('selection_helper', selectionHelper);
	}

	function persistPlayers() {
		patch('players', players);
	}

	function addPlayer() {
		players = [...players, { entity_id: '' }];
		persistPlayers();
	}

	function removePlayer(idx: number) {
		players = players.filter((_, i) => i !== idx);
		persistPlayers();
	}

	function updatePlayerEntity(idx: number, entity_id: string) {
		players = players.map((p, i) => (i === idx ? { ...p, entity_id } : p));
		persistPlayers();
	}

	function updatePlayerName(idx: number, ev: Event) {
		const val = (ev.target as HTMLInputElement).value || undefined;
		players = players.map((p, i) => (i === idx ? { ...p, name: val } : p));
		persistPlayers();
	}

	function updatePlayerIcon(idx: number, ev: Event) {
		const val = (ev.target as HTMLInputElement).value || undefined;
		players = players.map((p, i) => (i === idx ? { ...p, icon: val } : p));
		persistPlayers();
	}
</script>

{#if isOpen}
	<Modal>
		<h1 slot="title">Player Group</h1>

		<h2>{$lang('name') || 'Name'}</h2>
		<InputClear
			condition={name}
			on:clear={() => {
				name = undefined;
				patch('name', undefined);
			}}
			let:padding
		>
			<input
				class="input"
				type="text"
				bind:value={name}
				placeholder="Multi-Room"
				on:change={handleName}
				style:padding
				autocomplete="off"
				spellcheck="false"
			/>
		</InputClear>

		<h2>{$lang('icon') || 'Icon'}</h2>
		<InputClear
			condition={icon}
			on:clear={() => {
				icon = undefined;
				patch('icon', undefined);
			}}
			let:padding
		>
			<input
				class="input"
				type="text"
				bind:value={icon}
				placeholder="mdi:speaker-multiple"
				on:change={handleIcon}
				style:padding
				autocomplete="off"
				spellcheck="false"
			/>
		</InputClear>

		<h2>{$lang('color') || 'Color'}</h2>
		<InputClear
			condition={color}
			on:clear={() => {
				color = undefined;
				patch('color', undefined);
			}}
			let:padding
		>
			<input
				class="input"
				type="text"
				bind:value={color}
				placeholder="#1db954"
				on:change={handleColor}
				style:padding
				autocomplete="off"
				spellcheck="false"
			/>
		</InputClear>

		<h2>Source Player</h2>
		<p class="hint">
			The player whose queue is transferred when you press Cast. Pick whichever speaker usually has
			music playing on this dashboard.
		</p>
		<Select
			options={mediaPlayerEntities}
			placeholder="media_player.*"
			value={sourcePlayer}
			computeIcons={true}
			on:change={(e) => handleSource(e.detail)}
		/>

		<h2>Selection Helper</h2>
		<p class="hint">
			An <code>input_text</code> helper that stores the currently-selected rooms as a comma-separated
			list of entity IDs.
		</p>
		<Select
			options={inputTextEntities}
			placeholder="input_text.*"
			value={selectionHelper}
			computeIcons={true}
			on:change={(e) => handleSelectionHelper(e.detail)}
		/>

		<h2 style:margin-top="1.6rem">Players</h2>
		<p class="hint">Each row is one room/speaker you can cast to.</p>

		{#if players.length === 0}
			<p class="empty">No players added yet.</p>
		{:else}
			<div class="player-list">
				{#each players as p, idx (idx)}
					<div class="player-row">
						<div class="row-head">
							<span class="row-num">#{idx + 1}</span>
							<button
								class="row-remove"
								on:click={() => removePlayer(idx)}
								use:Ripple={$ripple}
								aria-label="Remove player"
								title="Remove"
							>
								<Icon icon="mdi:close" style="font-size: 1.1rem" />
							</button>
						</div>
						<div class="row-fields">
							<div class="field">
								<span class="field-label">Entity</span>
								<Select
									options={mediaPlayerEntities}
									placeholder="media_player.*"
									value={p.entity_id}
									computeIcons={true}
									on:change={(e) => updatePlayerEntity(idx, e.detail)}
								/>
							</div>
							<label class="field">
								<span class="field-label">Name (optional)</span>
								<input
									class="input small"
									type="text"
									value={p.name ?? ''}
									placeholder="Family Room"
									on:change={(e) => updatePlayerName(idx, e)}
									autocomplete="off"
									spellcheck="false"
								/>
							</label>
							<label class="field">
								<span class="field-label">Icon (optional)</span>
								<input
									class="input small"
									type="text"
									value={p.icon ?? ''}
									placeholder="mdi:speaker"
									on:change={(e) => updatePlayerIcon(idx, e)}
									autocomplete="off"
									spellcheck="false"
								/>
							</label>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<button class="action add-player" on:click={addPlayer} use:Ripple={$ripple}>
			<Icon icon="mdi:plus" style="font-size: 1.1rem" />
			Add player
		</button>

		<ConfigButtons {sel} />
	</Modal>
{/if}

<style>
	.hint {
		font-size: 0.82rem;
		opacity: 0.6;
		margin: 0.1rem 0 0.5rem;
	}

	.hint code {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.8em;
		background: rgba(255, 255, 255, 0.08);
		padding: 0.05em 0.3em;
		border-radius: 0.2em;
	}

	.empty {
		opacity: 0.55;
		font-size: 0.85rem;
		padding: 0.4rem 0;
	}

	.player-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}

	.player-row {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 0.5rem;
		padding: 0.6rem 0.7rem;
		background: rgba(255, 255, 255, 0.03);
	}

	.row-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.4rem;
	}

	.row-num {
		font-size: 0.8rem;
		opacity: 0.55;
	}

	.row-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.8rem;
		height: 1.8rem;
		border: none;
		border-radius: 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		color: inherit;
		cursor: pointer;
	}

	.row-remove:hover {
		background: rgba(255, 64, 64, 0.2);
	}

	.row-fields {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.field-label {
		font-size: 0.75rem;
		opacity: 0.55;
	}

	.input.small {
		padding: 0.5em 0.7em;
	}

	.action.add-player {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.7rem;
		padding: 0.55rem 0.9rem;
		border: 1px dashed rgba(255, 255, 255, 0.25);
		border-radius: 0.5rem;
		background: transparent;
		color: inherit;
		font-family: inherit;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.action.add-player:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(255, 255, 255, 0.4);
	}
</style>
