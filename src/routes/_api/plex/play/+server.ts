import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import { loadPlexConfig } from '$lib/Server/plex';
import type { Configuration } from '$lib/Types';

/**
 * POST /_api/plex/play
 * Body: { ratingKey: string, hassUrl?: string }
 *
 * Plays a Plex media item on the configured Android TV device by firing
 * a `plex://` deep-link intent via ADB.
 *
 * WHY ADB INTENT INSTEAD OF PLEX'S COMPANION API:
 *
 * Plex's official companion playMedia API (POST /player/playback/playMedia)
 * was tested exhaustively against the SHIELD Plex Android TV client. It
 * reliably leaves the video stream stuck behind the Plex home screen, with
 * only audio reaching the TV — confirmed in logcat as:
 *   PlexTVPlayerAdapter: Sending VIDEO_STATUS to mobile
 * which indicates the client is treating us as a remote-display controller
 * (casting receiver mode) rather than a "play this locally" request. This
 * happens with spec-compliant transient tokens + PlayQueue + commandID, and
 * with bare requests — it's a Plex Android TV client limitation, not our
 * request shape.
 *
 * The Android intent path is what Plex itself uses internally for
 * "open this item and play it" triggered by the Plex Android TV UI. It works
 * from idle, cleanly REPLACES any active playback when fired during a video,
 * and works from any source app — all confirmed by live testing.
 *
 * HA URL RESOLUTION (matches +page.server.ts pattern):
 *   1. process.env.HASS_URL — set via container env / .env file
 *   2. X-Proxy-Target request header — set when running through HA addon ingress
 *   3. body.hassUrl — client-supplied fallback (sent by PlexHubRow.svelte from
 *      $configuration.hassUrl, which is already populated at page load)
 *
 * The token is read from configuration.yaml's top-level `token` key, the same
 * place ha-fusion's WebSocket auth reads it from.
 *
 * REQUIREMENTS:
 *   - HA's legacy `androidtv` integration (ADB-based) installed against the
 *     target device. NOT `androidtv_remote` — that one doesn't expose
 *     adb_command.
 *   - Network ADB debugging enabled on the Android TV device.
 *   - PlexConfig.adb_entity set to the legacy integration's media_player
 *     entity (e.g. `media_player.android_tv_192_168_4_21`).
 */
export const POST: RequestHandler = async ({ request }) => {
	const plex = await loadPlexConfig();
	if (!plex) {
		error(503, 'Plex not configured. Enable in Settings.');
	}
	if (!plex.server_machine_id) {
		error(503, 'Plex server_machine_id must be configured.');
	}
	if (!plex.adb_entity) {
		error(
			503,
			'Plex adb_entity must be configured. Add HA legacy androidtv integration and set the entity in Plex Settings.'
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		error(400, 'Body must be valid JSON');
	}

	const ratingKey = String(body?.ratingKey ?? '');
	if (!/^\d+$/.test(ratingKey)) {
		error(400, 'ratingKey must be a numeric string');
	}

	// Resolve HA URL: env > proxy header > body-supplied
	const haUrl = (
		process.env.HASS_URL ||
		request.headers.get('X-Proxy-Target') ||
		String(body?.hassUrl ?? '')
	)
		.trim()
		.replace(/\/$/, '');

	if (!haUrl) {
		error(
			502,
			'HA URL not resolvable. Set HASS_URL env var on the container, or ensure the dashboard is loaded with hassUrl configured.'
		);
	}

	// Token comes from configuration.yaml's top-level `token` key (same as ha-fusion's WebSocket auth)
	const haToken = await loadHaToken();
	if (!haToken) {
		error(502, 'HA token not configured (configuration.yaml missing `token`).');
	}

	// Build the plex:// deep-link URI and the am start command.
	// Single-quote the URI so the shell doesn't interpret the // and special chars.
	const uri = `plex://server://${plex.server_machine_id}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
	const command = `am start --ez "android.intent.extra.START_PLAYBACK" true -a android.intent.action.VIEW '${uri}'`;

	try {
		const res = await fetch(`${haUrl}/api/services/androidtv/adb_command`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${haToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				entity_id: plex.adb_entity,
				command
			})
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`HA androidtv.adb_command failed (${res.status}): ${text.slice(0, 200)}`);
		}
		return json({ action: 'play_dispatched', ratingKey });
	} catch (err: any) {
		console.error('[plex/play] ADB intent failed:', err);
		error(502, `Plex playback failed: ${err.message ?? 'unknown'}`);
	}
};

async function loadHaToken(): Promise<string | null> {
	try {
		const raw = await readFile('./data/configuration.yaml', 'utf8');
		if (!raw.trim()) return null;
		const config = (yaml.load(raw) || {}) as Configuration;
		return config.token || null;
	} catch {
		return null;
	}
}
