import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadPlexConfig, plexUrl } from '$lib/Server/plex';

/**
 * GET /_api/plex/poster?key=<thumb_path>&w=<width>&h=<height>
 *
 * Proxies Plex thumb/art images. The browser asks for a key like
 * `/library/metadata/55913/thumb/1779786138`; we use Plex's photo transcoder
 * (/photo/:/transcode) to resize and stream it back. This keeps the Plex
 * token server-side and lets us serve consistent sizes for the UI grid.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const key = url.searchParams.get('key');
	const width = Math.min(parseInt(url.searchParams.get('w') || '300', 10), 1280);
	const height = Math.min(parseInt(url.searchParams.get('h') || '450', 10), 1920);

	if (!key) {
		error(400, 'Missing required query param: key');
	}
	// Keys must look like Plex paths — reject anything weird
	if (!/^\/library\/metadata\/\d+\/(thumb|art|poster)\/\d+$/.test(key)) {
		error(400, 'Invalid key format');
	}

	const plex = await loadPlexConfig();
	if (!plex) {
		error(503, 'Plex not configured');
	}

	// Use Plex's photo transcoder so we get a consistent size and format.
	const transcodeUrl = plexUrl(plex, '/photo/:/transcode', {
		width: String(width),
		height: String(height),
		minSize: '1',
		upscale: '1',
		url: key
	});

	try {
		const res = await fetch(transcodeUrl);
		if (!res.ok) {
			error(res.status, `Plex poster fetch failed: ${res.status}`);
		}
		const buffer = await res.arrayBuffer();
		const contentType = res.headers.get('content-type') || 'image/jpeg';

		// Cache for an hour client-side; poster images don't change often
		setHeaders({
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=3600'
		});

		return new Response(buffer);
	} catch (err: any) {
		console.error('[plex/poster]', err);
		error(502, `Poster fetch failed: ${err.message ?? 'unknown'}`);
	}
};

