import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadTidalConfig, tidalFetchJson } from '$lib/Server/tidal';
import type { TidalConfig } from '$lib/Types';

/**
 * GET /_api/tidal/rows?source=<id>&limit=<n>
 *
 * source formats (matches the docstring on TidalRowItem in Types.ts):
 *   search:<query>          — top results for the query (mix of albums + tracks)
 *   albums:<id>,<id>,…      — curated album IDs (max 20 per row by API limit)
 *   tracks:<id>,<id>,…      — curated track IDs
 *   artist_top:<id>          — top tracks for one artist
 *
 * Returns:
 *   { source, title, items: TidalItem[] }
 *
 * TidalItem normalized shape:
 *   {
 *     id: string,                         // numeric or UUID; what playback uses
 *     type: 'album'|'track'|'artist'|'playlist'|'mix',
 *     title: string,
 *     subtitle?: string,                  // artist name (for albums/tracks), etc.
 *     imageUuid?: string,                 // resolved via /_api/tidal/image
 *     duration?: number                   // seconds (tracks only)
 *   }
 *
 * IMPORTANT: server-side cache. The TIDAL v2 client-credentials rate limit
 * is aggressive (a couple of requests then long backoff). A dashboard with
 * several TIDAL rows mounting in parallel would blow it within seconds.
 * We cache per (source, country) for 5 minutes — long enough to soak up
 * dashboard remounts and tab switches, short enough that a curated row
 * edit reflects quickly. Search rows for the same query are identical
 * within that window anyway.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

type NormalizedItem = {
	id: string;
	type: 'album' | 'track' | 'artist' | 'playlist' | 'mix';
	title: string;
	subtitle?: string;
	imageUuid?: string;
	duration?: number;
};

type CacheEntry = {
	expiresAt: number;
	payload: { source: string; title: string; items: NormalizedItem[] };
};

const cache = new Map<string, CacheEntry>();

function cacheKey(source: string, country: string, limit: number) {
	return `${country}|${limit}|${source}`;
}

export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source');
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '12', 10), 20);

	if (!source) {
		error(400, 'Missing required query param: source');
	}

	const tidal = await loadTidalConfig();
	if (!tidal) {
		error(503, 'TIDAL not configured. Enable in Settings.');
	}

	const country = tidal.country_code || 'US';
	const key = cacheKey(source, country, limit);
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return json(cached.payload);
	}

	try {
		const payload = await fetchRow(tidal, source, limit);
		cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
		return json(payload);
	} catch (err: any) {
		console.error('[tidal/rows]', err);
		error(502, `TIDAL API error: ${err.message ?? 'unknown'}`);
	}
};

async function fetchRow(
	tidal: TidalConfig,
	source: string,
	limit: number
): Promise<{ source: string; title: string; items: NormalizedItem[] }> {
	if (source.startsWith('search:')) {
		const query = source.slice('search:'.length).trim();
		if (!query) throw new Error('Empty search query');
		return await fetchSearch(tidal, source, query, limit);
	}

	if (source.startsWith('albums:')) {
		const ids = parseCsvIds(source.slice('albums:'.length), /^\d+$/);
		if (ids.length === 0) throw new Error('No valid album IDs in source');
		return await fetchAlbumsByIds(tidal, source, ids.slice(0, limit));
	}

	if (source.startsWith('tracks:')) {
		const ids = parseCsvIds(source.slice('tracks:'.length), /^\d+$/);
		if (ids.length === 0) throw new Error('No valid track IDs in source');
		return await fetchTracksByIds(tidal, source, ids.slice(0, limit));
	}

	if (source.startsWith('artist_top:')) {
		const id = source.slice('artist_top:'.length).trim();
		if (!/^\d+$/.test(id)) throw new Error('Invalid artist id');
		return await fetchArtistTop(tidal, source, id, limit);
	}

	throw new Error(`Unknown source: ${source}`);
}

function parseCsvIds(raw: string, pattern: RegExp): string[] {
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter((s) => pattern.test(s));
}

// ---------------------------------------------------------------------------
// JSON:API resource resolution
// ---------------------------------------------------------------------------
//
// TIDAL v2 responses follow JSON:API. Two halves:
//
//   data:     primary resource(s). For a list endpoint this is an array of
//             {id, type, attributes, relationships}.
//   included: array of related resources pulled in via `include=` param.
//             Same shape as `data` items. Used to resolve, e.g., an album's
//             artist without a second HTTP call.
//
// `byRef` builds a lookup so we can resolve `relationships.artists.data[0].id`
// → the actual artist resource from `included`.

type JsonApiResource = {
	id: string;
	type: string;
	attributes?: any;
	relationships?: Record<
		string,
		{ data?: { id: string; type: string }[] | { id: string; type: string } }
	>;
};

function indexIncluded(resp: any): Map<string, JsonApiResource> {
	const map = new Map<string, JsonApiResource>();
	const included = (resp?.included ?? []) as JsonApiResource[];
	for (const r of included) {
		map.set(`${r.type}:${r.id}`, r);
	}
	// `data` itself is sometimes useful as a lookup too (e.g. when `data`
	// is an array of albums and one of them is referenced by a track's
	// relationships.albums).
	const data = resp?.data;
	if (Array.isArray(data)) {
		for (const r of data as JsonApiResource[]) {
			map.set(`${r.type}:${r.id}`, r);
		}
	} else if (data && typeof data === 'object') {
		map.set(`${data.type}:${data.id}`, data);
	}
	return map;
}

function firstRelId(res: JsonApiResource, rel: string): { id: string; type: string } | undefined {
	const r = res.relationships?.[rel]?.data;
	if (!r) return undefined;
	if (Array.isArray(r)) return r[0];
	return r;
}

function resolveArtistName(
	res: JsonApiResource,
	lookup: Map<string, JsonApiResource>
): string | undefined {
	const ref = firstRelId(res, 'artists');
	if (!ref) return undefined;
	const artist = lookup.get(`${ref.type}:${ref.id}`);
	return artist?.attributes?.name;
}

function resolveAlbumName(
	res: JsonApiResource,
	lookup: Map<string, JsonApiResource>
): string | undefined {
	const ref = firstRelId(res, 'albums');
	if (!ref) return undefined;
	const album = lookup.get(`${ref.type}:${ref.id}`);
	return album?.attributes?.title;
}

// `imageLinks` in attributes is an array of {href, meta:{width,height}}. We
// prefer the largest one ≤ 640 to keep download size sane for the dashboard.
// If none match, fall back to the first link.
function extractImageUuid(attrs: any): string | undefined {
	const links = (attrs?.imageLinks ?? []) as Array<{ href: string; meta?: any }>;
	if (links.length === 0) return undefined;

	// Pick the entry closest to (but not over) 640px on either dimension.
	const sorted = [...links].sort((a, b) => {
		const aw = a.meta?.width ?? 0;
		const bw = b.meta?.width ?? 0;
		return aw - bw;
	});
	const pick = sorted.find((l) => (l.meta?.width ?? 0) >= 320) ?? sorted[sorted.length - 1];
	if (!pick?.href) return undefined;

	// Strip the size suffix to get the UUID. The CDN URLs look like
	// https://resources.tidal.com/images/aa/bb/cc/dd/ee/640x640.jpg
	// → reassemble UUID `aabbccdd-eeff-...`. We extract the path portion
	// and join the segments back into a UUID with dashes.
	const m = pick.href.match(
		/\/images\/([0-9a-f]{8})\/([0-9a-f]{4})\/([0-9a-f]{4})\/([0-9a-f]{4})\/([0-9a-f]{12})\//i
	);
	if (!m) return undefined;
	return `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`;
}

function normalizeAlbum(
	res: JsonApiResource,
	lookup: Map<string, JsonApiResource>
): NormalizedItem {
	return {
		id: res.id,
		type: 'album',
		title: res.attributes?.title ?? 'Unknown album',
		subtitle: resolveArtistName(res, lookup),
		imageUuid: extractImageUuid(res.attributes)
	};
}

function normalizeTrack(
	res: JsonApiResource,
	lookup: Map<string, JsonApiResource>
): NormalizedItem {
	// Track images aren't always set in the track itself — prefer the album
	// cover when missing. (This matches how the TIDAL apps display tracks.)
	let imageUuid = extractImageUuid(res.attributes);
	if (!imageUuid) {
		const albumRef = firstRelId(res, 'albums');
		if (albumRef) {
			const album = lookup.get(`${albumRef.type}:${albumRef.id}`);
			if (album) imageUuid = extractImageUuid(album.attributes);
		}
	}
	const artist = resolveArtistName(res, lookup);
	const albumName = resolveAlbumName(res, lookup);

	// Subtitle: "Artist · Album" if we have both, else whichever we do.
	let subtitle: string | undefined;
	if (artist && albumName) subtitle = `${artist} · ${albumName}`;
	else subtitle = artist || albumName;

	// duration is ISO 8601 duration (e.g. "PT3M45S"). Parse to seconds.
	const duration = parseIsoDurationSeconds(res.attributes?.duration);

	return {
		id: res.id,
		type: 'track',
		title: res.attributes?.title ?? 'Unknown track',
		subtitle,
		imageUuid,
		duration
	};
}

function parseIsoDurationSeconds(iso: string | undefined): number | undefined {
	if (!iso || typeof iso !== 'string') return undefined;
	const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
	if (!m) return undefined;
	return parseInt(m[1] || '0') * 3600 + parseInt(m[2] || '0') * 60 + parseInt(m[3] || '0');
}

// ---------------------------------------------------------------------------
// Per-source fetchers
// ---------------------------------------------------------------------------

async function fetchSearch(tidal: TidalConfig, source: string, query: string, limit: number) {
	// /v2/searchresults/{query} returns a single resource whose relationships
	// reference albums + tracks. Using `include=` pulls everything inline in
	// one request — no need for the multi-fetch pattern shown in some
	// example code. Nested includes (tracks.artists, albums.artists) make
	// subtitles resolvable without further calls.
	const path = `/searchresults/${encodeURIComponent(query)}`;
	const data = await tidalFetchJson(tidal, path, {
		include: 'albums,albums.artists,tracks,tracks.artists,tracks.albums'
	});

	const root = data?.data as JsonApiResource | undefined;
	if (!root) return { source, title: `Search: ${query}`, items: [] };

	const lookup = indexIncluded(data);
	const albumRefs = (root.relationships?.albums?.data as { id: string; type: string }[]) || [];
	const trackRefs = (root.relationships?.tracks?.data as { id: string; type: string }[]) || [];

	// Interleave: albums first (usually a stronger signal for a query like
	// "dark side of the moon"), then tracks to fill. Cap at limit.
	const items: NormalizedItem[] = [];
	for (const ref of albumRefs) {
		if (items.length >= limit) break;
		const r = lookup.get(`${ref.type}:${ref.id}`);
		if (r) items.push(normalizeAlbum(r, lookup));
	}
	for (const ref of trackRefs) {
		if (items.length >= limit) break;
		const r = lookup.get(`${ref.type}:${ref.id}`);
		if (r) items.push(normalizeTrack(r, lookup));
	}

	return { source, title: `Search: ${query}`, items };
}

async function fetchAlbumsByIds(tidal: TidalConfig, source: string, ids: string[]) {
	// Batched filter: /v2/albums?filter[id]=1,2,3&include=artists
	const data = await tidalFetchJson(tidal, '/albums', {
		'filter[id]': ids.join(','),
		include: 'artists'
	});
	const lookup = indexIncluded(data);
	const list = (data?.data ?? []) as JsonApiResource[];

	// API doesn't promise to return items in filter[id] order. Preserve the
	// row's curated order by index lookup.
	const byId = new Map(list.map((r) => [r.id, r]));
	const items: NormalizedItem[] = [];
	for (const id of ids) {
		const r = byId.get(id);
		if (r) items.push(normalizeAlbum(r, lookup));
	}
	return { source, title: 'Albums', items };
}

async function fetchTracksByIds(tidal: TidalConfig, source: string, ids: string[]) {
	const data = await tidalFetchJson(tidal, '/tracks', {
		'filter[id]': ids.join(','),
		include: 'artists,albums'
	});
	const lookup = indexIncluded(data);
	const list = (data?.data ?? []) as JsonApiResource[];

	const byId = new Map(list.map((r) => [r.id, r]));
	const items: NormalizedItem[] = [];
	for (const id of ids) {
		const r = byId.get(id);
		if (r) items.push(normalizeTrack(r, lookup));
	}
	return { source, title: 'Tracks', items };
}

async function fetchArtistTop(tidal: TidalConfig, source: string, artistId: string, limit: number) {
	// Two-step: first resolve the artist's name for the row title, then
	// fetch top tracks. The topTracks relationship endpoint supports
	// `include=topTracks` to inline the actual track resources.
	const [artistResp, topResp] = await Promise.all([
		tidalFetchJson(tidal, `/artists/${artistId}`),
		tidalFetchJson(tidal, `/artists/${artistId}/relationships/topTracks`, {
			include: 'topTracks,topTracks.artists,topTracks.albums'
		})
	]);

	const artistName: string = artistResp?.data?.attributes?.name ?? 'Artist';
	const lookup = indexIncluded(topResp);
	const refs = ((topResp?.data ?? []) as { id: string; type: string }[]) || [];

	const items: NormalizedItem[] = [];
	for (const ref of refs) {
		if (items.length >= limit) break;
		const r = lookup.get(`${ref.type}:${ref.id}`);
		if (r) items.push(normalizeTrack(r, lookup));
	}

	return { source, title: `${artistName} · Top Tracks`, items };
}
