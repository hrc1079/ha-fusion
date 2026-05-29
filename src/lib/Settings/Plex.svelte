<script lang="ts">
	import { base } from '$app/paths';
	import { configuration, lang } from '$lib/Stores';

	let url = $configuration?.plex?.url ?? '';
	let server_token = $configuration?.plex?.server_token ?? '';
	let server_machine_id = $configuration?.plex?.server_machine_id ?? '';
	let adb_entity = $configuration?.plex?.adb_entity ?? '';
	let enabled = $configuration?.plex?.enabled ?? false;

	let testStatus: { kind: 'idle' | 'ok' | 'error'; message: string } = {
		kind: 'idle',
		message: ''
	};
	let testInFlight = false;

	function maskFocus(event: FocusEvent) {
		const target = event.target as HTMLInputElement;
		target.type = event.type === 'focus' ? 'text' : 'password';
	}

	/**
	 * Save the in-form values to /data/configuration.yaml first, then call
	 * /_api/plex/hubs with source=on_deck as a smoke test for library reads.
	 */
	async function testConnection() {
		testInFlight = true;
		testStatus = { kind: 'idle', message: '' };
		try {
			const merged: any = { ...$configuration };
			merged.plex = {
				enabled: true,
				url,
				server_token,
				server_machine_id,
				adb_entity
			};

			const saveRes = await fetch(`${base}/_api/save_config`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(merged)
			});
			if (!saveRes.ok) {
				throw new Error(`Failed to save config (${saveRes.status})`);
			}

			const hubsRes = await fetch(`${base}/_api/plex/hubs?source=on_deck&limit=1`);
			if (!hubsRes.ok) {
				const text = await hubsRes.text();
				throw new Error(`Plex API ${hubsRes.status}: ${text.slice(0, 120)}`);
			}
			const data = await hubsRes.json();
			testStatus = {
				kind: 'ok',
				message: `Connected — ${data.title} returned ${data.items?.length ?? 0} item(s)`
			};
			$configuration.plex = merged.plex;
		} catch (err: any) {
			testStatus = { kind: 'error', message: err.message ?? 'Unknown error' };
		} finally {
			testInFlight = false;
		}
	}

	async function testPlayback() {
		testInFlight = true;
		testStatus = { kind: 'idle', message: '' };
		try {
			const hubsRes = await fetch(`${base}/_api/plex/hubs?source=on_deck&limit=1`);
			if (!hubsRes.ok) throw new Error(`Could not fetch a test item (${hubsRes.status})`);
			const data = await hubsRes.json();
			const item = data.items?.[0];
			if (!item) throw new Error('No items in On Deck to test with');

			const playRes = await fetch(`${base}/_api/plex/play`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ratingKey: item.ratingKey,
					hassUrl: $configuration?.hassUrl
				})
			});
			if (!playRes.ok) {
				const text = await playRes.text();
				throw new Error(`Playback ${playRes.status}: ${text.slice(0, 120)}`);
			}
			testStatus = {
				kind: 'ok',
				message: `Dispatched "${item.title}" via ADB intent`
			};
		} catch (err: any) {
			testStatus = { kind: 'error', message: err.message ?? 'Unknown error' };
		} finally {
			testInFlight = false;
		}
	}
</script>

<h2>{$lang ? $lang('plex') || 'Plex' : 'Plex'}</h2>

<p class="overflow">
	Configure a Plex Media Server connection for the dashboard. The server token reads your library;
	playback is dispatched via ADB to the configured Android TV device. Tokens are stored server-side
	in configuration.yaml and never exposed to the browser.
</p>

<label class="checkbox">
	<input type="checkbox" name="plex_enabled" bind:checked={enabled} value="true" />
	Enable Plex feature
</label>

<div class="field">
	<label for="plex_url">Server URL</label>
	<input
		id="plex_url"
		class="input"
		type="text"
		name="plex_url"
		placeholder="http://192.168.1.10:32400"
		bind:value={url}
	/>
</div>

<div class="field">
	<label for="plex_server_token">Server token (reads library)</label>
	<input
		id="plex_server_token"
		class="input"
		type="password"
		name="plex_server_token"
		placeholder="X-Plex-Token from server settings"
		bind:value={server_token}
		on:focus={maskFocus}
		on:blur={maskFocus}
	/>
</div>

<div class="field">
	<label for="plex_machine">Server machine identifier</label>
	<input
		id="plex_machine"
		class="input"
		type="text"
		name="plex_server_machine_id"
		placeholder="hex machine id of the Plex Media Server"
		bind:value={server_machine_id}
	/>
</div>

<div class="field">
	<label for="plex_adb">ADB media_player entity (HA legacy androidtv integration)</label>
	<input
		id="plex_adb"
		class="input"
		type="text"
		name="plex_adb_entity"
		placeholder="media_player.android_tv_192_168_4_21"
		bind:value={adb_entity}
	/>
	<p class="hint">
		The entity created by HA's <em>Android TV</em> integration (NOT "Android TV Remote"). Requires Network
		ADB enabled on the device.
	</p>
</div>

<div class="buttons">
	<button
		class="action"
		on:click|preventDefault={testConnection}
		disabled={testInFlight || !url || !server_token}
	>
		Test connection
	</button>
	<button
		class="action"
		on:click|preventDefault={testPlayback}
		disabled={testInFlight || !server_machine_id || !adb_entity}
	>
		Test playback
	</button>

	{#if testStatus.kind === 'ok'}
		<span class="status success">{testStatus.message}</span>
	{:else if testStatus.kind === 'error'}
		<span class="status error">{testStatus.message}</span>
	{/if}
</div>

<style>
	p {
		margin-block-end: 0.6rem;
		font-size: 0.9rem;
		opacity: 0.75;
	}

	.hint {
		margin-block: 0.2rem 0;
		font-size: 0.8rem;
		opacity: 0.6;
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-block: 0.4rem 0.8rem;
		cursor: pointer;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-block-end: 0.6rem;
	}

	.field label {
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.buttons {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-block-start: 0.6rem;
	}

	.status {
		font-size: 0.85rem;
		margin-left: 0.5rem;
	}

	.success {
		color: #00dd17;
	}

	.error {
		color: #f92626;
	}

	.action {
		padding: 0.55rem 1.2rem;
		border: none;
		border-radius: 0.5rem;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 500;
		cursor: pointer;
		background: rgba(255, 255, 255, 0.08);
		color: inherit;
	}

	.action:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.15);
	}

	.action[disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
