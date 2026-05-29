import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadPlexConfig, plexFetchJson } from '$lib/Server/plex';

/**
 * GET /_api/plex/hubs?source=<id>&limit=<n>
 *
 * source values:
 *   continue_watching   → /hubs/continueWatching (recently played, with progress)
 *   on_deck             → /hubs (extracts home.ondeck — next-up TV episodes)
 *   section_recent:<key> → /library/sections/<key>/recentlyAdded
 *
 * Returns:
 *   { items: PlexItem[], title: string, source: string }
 *
 *   PlexItem = {
 *     ratingKey: string,    // playback identifier
 *     title: string,        // display title (for TV episodes, combines show + episode)
 *     subtitle?: string,    // e.g. year for movies, "S2E3" for episodes
 *     type: 'movie' | 'episode' | 'show' | 'season',
 *     thumb: string,        // poster path on Plex server (proxy via /_api/plex/poster)
 *     duration?: number,    // milliseconds
 *     viewOffset?: number   // ms watched (continue-watching only)
 *   }
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source');
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '12', 10), 50);

	if (!source) {
		error(400, 'Missing required query param: source');
	}

	const plex = await loadPlexConfig();
	if (!plex) {
		error(503, 'Plex not configured. Enable in Settings.');
	}

	try {
		let title = '';
		let rawItems: any[] = [];

		if (source === 'continue_watching') {
			const data = await plexFetchJson(plex, '/hubs/continueWatching', {
				'X-Plex-Container-Start': '0',
				'X-Plex-Container-Size': String(limit)
			});
			title = 'Continue Watching';
			rawItems = data?.MediaContainer?.Metadata ?? [];
		} else if (source === 'on_deck') {
			const data = await plexFetchJson(plex, '/hubs', {
				'X-Plex-Container-Size': String(limit)
			});
			const hubs = data?.MediaContainer?.Hub ?? [];
			const onDeck = hubs.find((h: any) => h.hubIdentifier === 'home.ondeck');
			title = onDeck?.title || 'On Deck';
			rawItems = onDeck?.Metadata ?? [];
		} else if (source.startsWith('section_recent:')) {
			const sectionKey = source.slice('section_recent:'.length);
			if (!/^\d+$/.test(sectionKey)) {
				error(400, `Invalid section key in source: ${source}`);
			}
			const data = await plexFetchJson(plex, `/library/sections/${sectionKey}/recentlyAdded`, {
				'X-Plex-Container-Start': '0',
				'X-Plex-Container-Size': String(limit)
			});
			title =
				data?.MediaContainer?.title1 ||
				data?.MediaContainer?.librarySectionTitle ||
				'Recently Added';
			rawItems = data?.MediaContainer?.Metadata ?? [];
		} else {
			error(400, `Unknown source: ${source}`);
		}

		// Normalize each Plex item to a small consistent shape
		const items = rawItems.map((m) => normalizeItem(m));

		return json({ source, title, items });
	} catch (err: any) {
		console.error('[plex/hubs]', err);
		error(502, `Plex API error: ${err.message ?? 'unknown'}`);
	}
};

function normalizeItem(m: any) {
	const type = m.type as string;

	// For TV episodes, prefer the show poster (grandparentThumb)
	// because episode posters are often missing or just a still frame.
	let thumb: string | undefined;
	if (type === 'episode') {
		thumb = m.grandparentThumb || m.parentThumb || m.thumb;
	} else {
		thumb = m.thumb;
	}

	// Title composition:
	//  - movie: title (year)
	//  - episode: ShowName · S2E3 — Episode Title
	//  - show: title
	let title = m.title || '';
	let subtitle: string | undefined;

	if (type === 'movie') {
		subtitle = m.year ? String(m.year) : undefined;
	} else if (type === 'episode') {
		title = m.grandparentTitle || m.title;
		const s = m.parentIndex ?? '?';
		const e = m.index ?? '?';
		const epTitle = m.title || '';
		subtitle = `S${s}E${e}${epTitle ? ' · ' + epTitle : ''}`;
	} else if (type === 'show' || type === 'season') {
		subtitle = m.year ? String(m.year) : undefined;
	}

	return {
		ratingKey: String(m.ratingKey),
		title,
		subtitle,
		type,
		thumb,
		duration: m.duration,
		viewOffset: m.viewOffset
	};
}

