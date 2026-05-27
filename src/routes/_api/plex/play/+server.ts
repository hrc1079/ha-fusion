import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadPlexConfig } from '$lib/Server/plex';

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
 * Requires `target_client_id` and `server_machine_id` to be set in config.
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

	const params = new URLSearchParams({
		'X-Plex-Token': plex.account_token ?? plex.server_token ?? '',
		'X-Plex-Client-Identifier': 'ha-fusion',
		'X-Plex-Target-Client-Identifier': plex.target_client_id,
		machineIdentifier: plex.server_machine_id,
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

