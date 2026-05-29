import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadTidalConfig, tidalImageUrl } from '$lib/Server/tidal';

/**
 * GET /_api/tidal/image?uuid=<image-uuid>&size=<size>
 *
 * Proxies a TIDAL resources.tidal.com image. Unlike Plex, TIDAL covers are
 * public and need no auth — so the proxy exists for two narrower reasons:
 *
 *   1. Consistent caching. The dashboard re-mounts rows on every view switch;
 *      letting the browser hit the same upstream URL every time is fine
 *      (it's CDN-cached) but we set Cache-Control: immutable on our end so
 *      the browser short-circuits even harder. Covers don't change.
 *
 *   2. URL validation. We never let arbitrary upstream URLs through — only
 *      valid UUID + whitelisted sizes — so a malformed `imageLinks` entry
 *      from the API can't be turned into an open redirector.
 *
 * If TIDAL is unconfigured we 503 — keeps the row component's error path
 * symmetric with the Plex one.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const uuid = url.searchParams.get('uuid');
	const size = url.searchParams.get('size') || '320x320';

	if (!uuid) {
		error(400, 'Missing required query param: uuid');
	}

	const tidal = await loadTidalConfig();
	if (!tidal) {
		error(503, 'TIDAL not configured');
	}

	let upstream: string;
	try {
		upstream = tidalImageUrl(uuid, size);
	} catch (err: any) {
		error(400, err.message || 'Invalid image params');
	}

	try {
		const res = await fetch(upstream);
		if (!res.ok) {
			error(res.status, `TIDAL image fetch failed: ${res.status}`);
		}
		const buffer = await res.arrayBuffer();
		const contentType = res.headers.get('content-type') || 'image/jpeg';

		// Covers are immutable; cache aggressively (1 day client, no revalidate)
		setHeaders({
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=86400, immutable'
		});

		return new Response(buffer);
	} catch (err: any) {
		// `error()` from @sveltejs/kit throws a HttpError — let it bubble.
		if (err?.status) throw err;
		console.error('[tidal/image]', err);
		error(502, `Image fetch failed: ${err.message ?? 'unknown'}`);
	}
};
