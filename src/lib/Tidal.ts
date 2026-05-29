import { get } from 'svelte/store';
import { callService } from 'home-assistant-js-websocket';
import { connection, configuration } from '$lib/Stores';

export type TidalItemType = 'album' | 'track' | 'artist' | 'playlist' | 'mix';

/**
 * Fire a TIDAL Android App Link intent via the existing authenticated
 * Home Assistant WebSocket.
 *
 * Mirrors `playPlexItem` in $lib/Plex.ts — same WebSocket reuse, same
 * force-stop-then-cold-launch sequence, same double-tap protection at
 * the caller. The two material differences from Plex:
 *
 * 1. URI scheme — TIDAL uses an HTTP App Link, not a custom scheme.
 *    The TIDAL Android app registers `https://tidal.com/browse/...`
 *    as a verified app link, so VIEW+BROWSABLE on that URL goes
 *    straight to the app (no chooser, no Chrome). We still pass the
 *    package name to `am start` to be safe on devices where another
 *    app might also claim tidal.com (rare, but cheap to guard against).
 *
 * 2. Force-stop is best-effort, not load-bearing. The Plex flow needs
 *    it because of the SHIELD video-surface bug; TIDAL is an audio
 *    app with no equivalent issue. Keeping the same shape anyway —
 *    it makes the cold-launch state deterministic, and the ~500ms
 *    cost is invisible inside the existing tap latency.
 *
 * @param type   "album" | "track" | "artist" | "playlist" | "mix"
 * @param id     Numeric ID for album/track/artist; UUID/string for playlist/mix
 */
export async function playTidalItem(type: TidalItemType, id: string): Promise<void> {
	const conn = get(connection);
	const config = get(configuration);
	const tidal = config?.tidal;

	if (!conn) {
		throw new Error('HA WebSocket connection not ready');
	}
	if (!tidal?.enabled) {
		throw new Error('TIDAL feature is not enabled');
	}
	if (!tidal.adb_entity) {
		throw new Error('TIDAL adb_entity is not configured');
	}

	// ID validation per type. Albums/tracks/artists are numeric; playlists
	// are lowercase UUIDs; mixes are short alphanumeric strings. Reject
	// anything that doesn't fit — we're interpolating into a shell command.
	const validators: Record<TidalItemType, RegExp> = {
		album: /^\d+$/,
		track: /^\d+$/,
		artist: /^\d+$/,
		playlist: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		mix: /^[A-Za-z0-9_-]{1,64}$/
	};
	if (!validators[type] || !validators[type].test(id)) {
		throw new Error(`Invalid TIDAL ${type} id: ${id}`);
	}

	const url = `https://tidal.com/browse/${type}/${id}`;

	// android.intent.category.BROWSABLE matches the App Link intent filter
	// the TIDAL app declares for tidal.com — exact parity with how Chrome
	// would dispatch the link, but we name the package so no chooser appears.
	const playCommand =
		`am start -W ` +
		`-a android.intent.action.VIEW ` +
		`-c android.intent.category.BROWSABLE ` +
		`-d '${url}' ` +
		`com.aspiro.tidal`;
	const forceStopCommand = `am force-stop com.aspiro.tidal`;

	// 1. Force-stop TIDAL — best-effort tear-down for deterministic launch
	await callService(conn, 'androidtv', 'adb_command', {
		entity_id: tidal.adb_entity,
		command: forceStopCommand
	});

	// 2. Brief settle window for ActivityManager
	await new Promise((resolve) => setTimeout(resolve, 500));

	// 3. Fire the App Link intent — cold-launches TIDAL into the target
	await callService(conn, 'androidtv', 'adb_command', {
		entity_id: tidal.adb_entity,
		command: playCommand
	});
}
