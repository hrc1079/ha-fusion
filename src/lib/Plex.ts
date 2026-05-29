import { get } from 'svelte/store';
import { callService } from 'home-assistant-js-websocket';
import { connection, configuration } from '$lib/Stores';

/**
 * Fire a Plex deep-link intent via the existing authenticated WebSocket.
 *
 * This is the client-side counterpart to the (now removed) /_api/plex/play
 * endpoint. By routing through the WebSocket Connection that ha-fusion has
 * already established for the dashboard, we re-use the browser's existing
 * auth (long-lived token OR OAuth flow) and eliminate the need to store a
 * server-side HA token just for Plex playback.
 *
 * SEQUENCE (~1.5–2s total):
 *   1. am force-stop com.plexapp.android  — clear any zombie state
 *   2. sleep 500ms                        — let ActivityManager tear down
 *   3. am start ... 'plex://server://...'  — cold-launch + start playback
 *
 * WHY THE TEARDOWN: bare deep-link intent is only ~70% reliable when fired
 * against a Plex client in various background states. Force-stop guarantees
 * a fresh process and binds the video surface correctly. See the project
 * notes on the Plex Android TV client video-surface bug for full context.
 *
 * @param ratingKey  Numeric Plex library/metadata key (e.g. "55846")
 * @returns          true on success; throws on misconfiguration or service failure
 */
export async function playPlexItem(ratingKey: string): Promise<void> {
	const conn = get(connection);
	const config = get(configuration);
	const plex = config?.plex;

	if (!conn) {
		throw new Error('HA WebSocket connection not ready');
	}
	if (!plex?.enabled) {
		throw new Error('Plex feature is not enabled');
	}
	if (!plex.server_machine_id) {
		throw new Error('Plex server_machine_id is not configured');
	}
	if (!plex.adb_entity) {
		throw new Error('Plex adb_entity is not configured');
	}
	if (!/^\d+$/.test(ratingKey)) {
		throw new Error('ratingKey must be a numeric string');
	}

	const uri = `plex://server://${plex.server_machine_id}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
	const playCommand = `am start --ez "android.intent.extra.START_PLAYBACK" true -a android.intent.action.VIEW '${uri}'`;
	const forceStopCommand = `am force-stop com.plexapp.android`;

	// 1. Force-stop Plex
	await callService(conn, 'androidtv', 'adb_command', {
		entity_id: plex.adb_entity,
		command: forceStopCommand
	});

	// 2. Brief settle window — gives Android's ActivityManager time to fully
	//    tear down the Plex process before we cold-launch it.
	await new Promise((resolve) => setTimeout(resolve, 500));

	// 3. Fire the deep-link intent — cold-launches Plex and starts playback
	await callService(conn, 'androidtv', 'adb_command', {
		entity_id: plex.adb_entity,
		command: playCommand
	});
}
