import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import { loadPlexConfig } from '$lib/Server/plex';
import type { Configuration } from '$lib/Types';

/**
 * POST /_api/plex/play
 * Body: { ratingKey: string, offset?: number }
 *
 * Routes through the Plex Media Server's player proxy:
 *   POST <plex>/player/playback/playMedia
 *
 * The server then forwards the play command to the configured target client
 * (typically the SHIELD running Plex Android TV) over Plex's pubsub channel.
 *
 * Foreground handling: Plex's Android TV companion API has a known issue
 * where playback can start in the background while another app (e.g.
 * YouTube TV) stays on screen. To fix that, if `android_tv_entity` is
 * configured AND we can read a HA token from configuration.yaml, we first
 * call HA's media_player.play_media service to launch the Plex app on the
 * target device. This forces Plex to the foreground before we issue
 * playMedia.
 *
 * Switch-while-playing: if Plex is already playing something on the target
 * and the user taps a new tile, we stop the current session first so the
 * new playMedia request can start cleanly without requiring a second tap.
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

	// Parse the configured server URL into address/port/protocol
	let serverUrl: URL;
	try {
		serverUrl = new URL(plex.url ?? '');
	} catch {
		error(500, 'Plex url in configuration is invalid');
	}
	const protocol = serverUrl.protocol.replace(':', '');
	const address = serverUrl.hostname;
	const port = serverUrl.port || (protocol === 'https' ? '443' : '32400');

	// Stop any existing playback on the target client. This fixes the
	// double-tap-to-switch bug where switching media required two taps.
	try {
		await stopCurrentPlayback(plex);
	} catch (err) {
		// Non-fatal: just log and continue. If the client wasn't playing
		// anything, Plex returns 200/404 either way — we don't care.
		console.warn('[plex/play] stop attempt failed (non-fatal):', err);
	}

	// Optionally bring Plex to the foreground on the configured Android TV
	// device by calling HA's media_player.play_media with media_content_type: app.
	// We intentionally swallow errors here — if the app launch fails, we still
	// try the playMedia call because the user might have Plex already open.
	if (plex.android_tv_entity) {
		try {
			await launchPlexApp(plex.android_tv_entity);
			// Brief settle so the Plex app is foregrounded before we send playMedia
			await new Promise((resolve) => setTimeout(resolve, 1200));
		} catch (err) {
			console.warn('[plex/play] Could not launch Plex app on Android TV:', err);
		}
	}

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

	try {
		const res = await fetch(playUrl, { method: 'POST' });
		// Plex returns 200 with weird "Failure: 200 OK" body even on success.
		// We trust the HTTP status code.
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			error(502, `Plex playback failed (${res.status}): ${text.slice(0, 200)}`);
		}
		return json({ action: 'play_dispatched', ratingKey });
	} catch (err: any) {
		console.error('[plex/play]', err);
		error(502, `Plex playback request failed: ${err.message ?? 'unknown'}`);
	}
};

/**
 * Send a stop command to the target client via Plex's player proxy.
 * Used to clear any current playback before issuing a new playMedia.
 */
async function stopCurrentPlayback(
	plex: NonNullable<Awaited<ReturnType<typeof loadPlexConfig>>>
): Promise<void> {
	const params = new URLSearchParams({
		'X-Plex-Token': plex.account_token ?? plex.server_token ?? '',
		'X-Plex-Client-Identifier': 'ha-fusion',
		'X-Plex-Target-Client-Identifier': plex.target_client_id ?? '',
		type: 'video'
	});
	const stopUrl = `${plex.url?.replace(/\/$/, '')}/player/playback/stop?${params.toString()}`;
	await fetch(stopUrl, { method: 'POST' });
}

/**
 * Launch the Plex app on the configured Android TV via HA's
 * media_player.play_media service. Reads HA URL + token from
 * configuration.yaml (same place the rest of the app reads them).
 */
async function launchPlexApp(entityId: string): Promise<void> {
	const raw = await readFile('./data/configuration.yaml', 'utf8').catch(() => '');
	if (!raw.trim()) throw new Error('Cannot launch Plex app: configuration.yaml unreadable');
	const config = (yaml.load(raw) || {}) as Configuration;
	const hassUrl = process.env.HASS_URL || config.hassUrl;
	const haToken = config.token;
	if (!hassUrl || !haToken) {
		throw new Error('Cannot launch Plex app: HA url/token not configured');
	}
	const res = await fetch(`${hassUrl.replace(/\/$/, '')}/api/services/media_player/play_media`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${haToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			entity_id: entityId,
			media_content_id: 'com.plexapp.android',
			media_content_type: 'app'
		})
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`HA service call failed (${res.status}): ${text.slice(0, 150)}`);
	}
}
