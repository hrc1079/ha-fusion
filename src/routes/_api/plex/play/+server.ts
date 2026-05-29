import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import { loadPlexConfig } from '$lib/Server/plex';
import type { Configuration } from '$lib/Types';

/**
 * POST /_api/plex/play
 * Body: { ratingKey: string }
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
 * "open this item and play it" triggered by the Plex Android TV UI. The
 * intent is:
 *
 *   am start --ez "android.intent.extra.START_PLAYBACK" true \
 *            -a android.intent.action.VIEW \
 *            'plex://server://<machineId>/com.plexapp.plugins.library/library/metadata/<ratingKey>'
 *
 * It works from idle (Plex closed or on home screen), and cleanly REPLACES
 * any active playback when fired during a video — both confirmed by live
 * testing.
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

	// Build the plex:// deep-link URI and the am start command.
	// Single-quote the URI so the shell doesn't interpret the // and special chars.
	const uri = `plex://server://${plex.server_machine_id}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
	const command = `am start --ez "android.intent.extra.START_PLAYBACK" true -a android.intent.action.VIEW '${uri}'`;

	try {
		await callHaService('androidtv', 'adb_command', {
			entity_id: plex.adb_entity,
			command
		});
		return json({ action: 'play_dispatched', ratingKey });
	} catch (err: any) {
		console.error('[plex/play] ADB intent failed:', err);
		error(502, `Plex playback failed: ${err.message ?? 'unknown'}`);
	}
};

/**
 * Fire an HA service via REST. Reads HA URL + token from configuration.yaml.
 */
async function callHaService(
	domain: string,
	service: string,
	serviceData: Record<string, unknown>
): Promise<void> {
	const ha = await loadHaConnection();
	if (!ha) {
		throw new Error('HA connection not configured (configuration.yaml missing hassUrl/token)');
	}
	const res = await fetch(`${ha.url}/api/services/${domain}/${service}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ha.token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(serviceData)
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`HA ${domain}.${service} failed (${res.status}): ${text.slice(0, 200)}`);
	}
}

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
