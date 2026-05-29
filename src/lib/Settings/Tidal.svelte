<script lang="ts">
	import { base } from '$app/paths';
	import { configuration, lang } from '$lib/Stores';
	import { playTidalItem, type TidalItemType } from '$lib/Tidal';

	let client_id = $configuration?.tidal?.client_id ?? '';
	let client_secret = $configuration?.tidal?.client_secret ?? '';
	let country_code = $configuration?.tidal?.country_code ?? 'US';
	let adb_entity = $configuration?.tidal?.adb_entity ?? '';
	let enabled = $configuration?.tidal?.enabled ?? false;

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
	 * Save the in-form values to /data/configuration.yaml first, then hit
	 * /_api/tidal/rows with a known-good search query as a smoke test for
	 * (a) OAuth credentials, (b) country code validity, (c) the JSON:API
	 * shape we assume. "the beatles" returns hits in every supported region.
	 */
	async function testConnection() {
		testInFlight = true;
		testStatus = { kind: 'idle', message: '' };
		try {
			const merged: any = { ...$configuration };
			merged.tidal = {
				enabled: true,
				client_id,
				client_secret,
				country_code: country_code || 'US',
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

			const rowsRes = await fetch(
				`${base}/_api/tidal/rows?source=${encodeURIComponent('search:the beatles')}&limit=1`
			);
			if (!rowsRes.ok) {
				const text = await rowsRes.text();
				throw new Error(`TIDAL API ${rowsRes.status}: ${text.slice(0, 120)}`);
			}
			const data = await rowsRes.json();
			testStatus = {
				kind: 'ok',
				message: `Connected — ${data.title} returned ${data.items?.length ?? 0} item(s)`
			};
			$configuration.tidal = merged.tidal;
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
			// Same smoke-test query — pluck the first item and play it.
			const rowsRes = await fetch(
				`${base}/_api/tidal/rows?source=${encodeURIComponent('search:the beatles')}&limit=1`
			);
			if (!rowsRes.ok) throw new Error(`Could not fetch a test item (${rowsRes.status})`);
			const data = await rowsRes.json();
			const item = data.items?.[0];
			if (!item) throw new Error('No test items returned by TIDAL search');

			await playTidalItem(item.type as TidalItemType, item.id);
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

<h2>{$lang ? $lang('tidal') || 'TIDAL' : 'TIDAL'}</h2>

<p class="overflow">
	Configure a TIDAL Developer app (client credentials) for catalog browsing. Playback is dispatched
	via ADB to the configured Android TV device — the installed TIDAL Android app handles the actual
	streaming. Credentials are stored server-side in configuration.yaml and never exposed to the
	browser.
</p>

<p class="overflow scope">
	<strong>Scope note:</strong> client credentials read the public catalog only — search, album / track
	/ artist lookup, artist top tracks. User-owned data (My Mix, favorites, personal playlists) requires
	the OAuth authorization-code flow and is not yet supported here.
</p>

<label class="checkbox">
	<input type="checkbox" name="tidal_enabled" bind:checked={enabled} value="true" />
	Enable TIDAL feature
</label>

<div class="field">
	<label for="tidal_client_id">Client ID</label>
	<input
		id="tidal_client_id"
		class="input"
		type="text"
		name="tidal_client_id"
		placeholder="from developer.tidal.com/dashboard"
		bind:value={client_id}
	/>
</div>

<div class="field">
	<label for="tidal_client_secret">Client secret</label>
	<input
		id="tidal_client_secret"
		class="input"
		type="password"
		name="tidal_client_secret"
		placeholder="from developer.tidal.com/dashboard"
		bind:value={client_secret}
		on:focus={maskFocus}
		on:blur={maskFocus}
	/>
</div>

<div class="field">
	<label for="tidal_country">Country code (ISO 3166-1 alpha-2)</label>
	<input
		id="tidal_country"
		class="input"
		type="text"
		name="tidal_country_code"
		placeholder="US"
		maxlength="2"
		bind:value={country_code}
	/>
	<p class="hint">
		Required by TIDAL on every catalog call. Affects content availability and the top-tracks /
		top-albums lists. Defaults to <em>US</em>.
	</p>
</div>

<div class="field">
	<label for="tidal_adb">ADB media_player entity (HA legacy androidtv integration)</label>
	<input
		id="tidal_adb"
		class="input"
		type="text"
		name="tidal_adb_entity"
		placeholder="media_player.android_tv_192_168_4_21"
		bind:value={adb_entity}
	/>
	<p class="hint">
		Same entity as Plex if both apps are on the same SHIELD — created by HA's <em>Android TV</em>
		integration (NOT "Android TV Remote"). The TIDAL Android app must be installed and logged in on the
		device.
	</p>
</div>

<div class="buttons">
	<button
		class="action"
		on:click|preventDefault={testConnection}
		disabled={testInFlight || !client_id || !client_secret}
	>
		Test connection
	</button>
	<button
		class="action"
		on:click|preventDefault={testPlayback}
		disabled={testInFlight || !adb_entity}
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

	p.scope {
		font-size: 0.85rem;
		opacity: 0.65;
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
