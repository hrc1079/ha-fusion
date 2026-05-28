import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import { loadPlexConfig } from '$lib/Server/plex';
import type { Configuration, PlexConfig } from '$lib/Types';

/**
 * POST /_api/plex/play
 * Body: { ratingKey: string, offset?: number }
 *
 * Plays media on the configured Plex target client (typically a SHIELD
 * running Plex Android TV). Routes through the Plex Media Server's player
 * proxy: POST <plex>/player/playback/playMedia
 *
 * THE SHIELD PLEX BUG, AND THE FIX
 *
 * The Plex Android TV companion API cannot cleanly REPLACE a video that's
 * already playing on the SHIELD. A bare second playMedia leaves the new
 * audio decoder running with no visible UI — the orphan audio survives
 * HOME, MEDIA_STOP, BACK, even POWER. The only thing that kills it is
 * force-quitting the Plex app process.
 *
 * We approximate that programmatically by launching the Android TV
 * launcher (com.google.android.tvlauncher) via HA's media_player.play_media.
 * The Activity Manager evicts the Plex process when starting the launcher,
 * which kills the stuck audio. Then we cold-launch Plex and issue the
 * new playMedia. ~4-5 second gap on switches but reliable.
 *
 * THE CONDITIONAL PATH
 *
 * Reading the cast_entity (media_player.<device>_cast) tells us whether
 * anything is currently playing on the target. That entity tracks actual
 * playback state via Cast protocol — more reliable than Plex's own
 * media_player entity which goes "unavailable" and is often stale.
 *
 *   cast.state in {playing, buffering, paused}  → BUSY path (teardown+play)
 *   cast.state in {idle, off, unavailable}      → IDLE path (bare playMedia)
 *
 * Idle path is fast (~300ms). Busy path takes ~4-5s for the teardown.
 *
 * If cast_entity or android_tv_entity isn't configured, the endpoint
 * falls back to bare playMedia — works for idle plays, fails on switches.
 */
export const POST: RequestHandler = async ({ request }) => {
	const plex = await loadPlexConfig();
	if (!plex) {
		error(503, 'Plex not configured. Enable in Settings.');
	}
	if (!plex.target_client_id || !plex.server_machine_id) {
		error(503, 'Plex target_client_id and server_machine_id must be configured.');
	}

	let body;
	try {
		body = await request.json();
	} catch {
		error(400, 'Body must be valid JSON');
	}

	const ratingKey = String(body?.ratingKey ?? '');
	if (!/^\d+$/.test(ratingKey)) {
		error(400, 'ratingKey must be a numeric string');
	}
	const offset = Number.isFinite(body?.offset) ? Math.floor(body.offset) : 0;

	// Decide path: idle (bare play) vs busy (teardown+play).
	// Default to idle when we can't determine state.
	let path: 'idle' | 'busy' = 'idle';
	const ha = await loadHaConnection();
	if (ha && plex.cast_entity) {
		try {
			const castState = await readEntityState(ha, plex.cast_entity);
			if (castState === 'playing' || castState === 'buffering' || castState === 'paused') {
				path = 'busy';
			}
		} catch (err) {
			console.warn('[plex/play] Could not read cast entity state, defaulting to idle path:', err);
		}
	}

	// BUSY: tear down current Plex session, cold-launch Plex, then play
	if (path === 'busy' && ha && plex.android_tv_entity) {
		try {
			await launchApp(ha, plex.android_tv_entity, 'com.google.android.tvlauncher');
			// Wait for Activity Manager to evict Plex (kills orphan audio)
			await sleep(1500);
			await launchApp(ha, plex.android_tv_entity, 'com.plexapp.android');
			// Wait for Plex to cold-start to its home screen
			await sleep(2000);
		} catch (err) {
			// Non-fatal — if the teardown fails we still try playMedia.
			// Worst case: same orphan-audio bug we'd have without the teardown.
			console.warn('[plex/play] Busy-path teardown failed, falling through to playMedia:', err);
		}
	}

	// Fire the actual play (same for both paths)
	try {
		await firePlayMedia(plex, ratingKey, offset);
	} catch (err: any) {
		console.error('[plex/play] playMedia failed:', err);
		error(502, `Plex playback failed: ${err.message ?? 'unknown'}`);
	}

	return json({ action: 'play_dispatched', ratingKey, path });
};

/**
 * Fire the Plex companion playMedia request.
 */
async function firePlayMedia(
	plex: NonNullable<Awaited<ReturnType<typeof loadPlexConfig>>>,
	ratingKey: string,
	offset: number
): Promise<void> {
	let serverUrl: URL;
	try {
		serverUrl = new URL(plex.url ?? '');
	} catch {
		throw new Error('Plex url in configuration is invalid');
	}
	const protocol = serverUrl.protocol.replace(':', '');
	const address = serverUrl.hostname;
	const port = serverUrl.port || (protocol === 'https' ? '443' : '32400');

	const params = new URLSearchParams({
		'X-Plex-Token': plex.account_token ?? plex.server_token ?? '',
		'X-Plex-Client-Identifier': 'ha-fusion',
		'X-Plex-Target-Client-Identifier': plex.target_client_id ?? '',
		machineIdentifier: plex.server_machine_id ?? '',
		key: `/library/metadata/${ratingKey}`,
		containerKey: `/library/metadata/${ratingKey}`,
		address,
		port,
		protocol,
		offset: String(offset),
		type: 'video'
	});

	const playUrl = `${plex.url?.replace(/\/$/, '')}/player/playback/playMedia?${params.toString()}`;
	const res = await fetch(playUrl, { method: 'POST' });
	// Plex returns 200 with body "Failure: 200 OK" even on success.
	// Trust the HTTP status, not the body.
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Plex API ${res.status}: ${text.slice(0, 200)}`);
	}
}

/**
 * HA connection details: URL and long-lived access token, both read
 * from configuration.yaml (the same source the rest of the app uses).
 */
type HaConnection = { url: string; token: string };

async function loadHaConnection(): Promise<HaConnection | null> {
	try {
		const raw = await readFile('./data/configuration.yaml', 'utf8');
		if (!raw.trim()) return null;
		const config = (yaml.load(raw) || {}) as Configuration;
		const url = (process.env.HASS_URL || config.hassUrl || '').replace(/\/$/, '');
		const token = config.token || '';
		if (!url || !token) return null;
		return { url, token };
	} catch {
		return null;
	}
}

/**
 * Read the `state` field of an HA entity via the REST API.
 * Returns the raw state string ("playing", "idle", "off", "unavailable", etc.).
 */
async function readEntityState(ha: HaConnection, entityId: string): Promise<string> {
	const res = await fetch(`${ha.url}/api/states/${encodeURIComponent(entityId)}`, {
		headers: { Authorization: `Bearer ${ha.token}` }
	});
	if (!res.ok) {
		throw new Error(`HA states API ${res.status}`);
	}
	const data = (await res.json()) as { state?: string };
	return String(data?.state ?? 'unknown');
}

/**
 * Launch an Android app on the configured Android TV via HA's
 * media_player.play_media service.
 */
async function launchApp(ha: HaConnection, entityId: string, appId: string): Promise<void> {
	const res = await fetch(`${ha.url}/api/services/media_player/play_media`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ha.token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			entity_id: entityId,
			media_content_id: appId,
			media_content_type: 'app'
		})
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`HA service call failed (${res.status}): ${text.slice(0, 150)}`);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
