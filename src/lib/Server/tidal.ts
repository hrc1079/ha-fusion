import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import type { Configuration, TidalConfig } from '$lib/Types';

const CONFIG_PATH = './data/configuration.yaml';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const API_BASE = 'https://openapi.tidal.com/v2';
const DEFAULT_COUNTRY = 'US';

/**
 * Read the tidal section of configuration.yaml.
 *
 * Returns null when not configured / disabled / missing required fields.
 * The caller treats null as "TIDAL feature disabled" and responds 503.
 *
 * Mirrors loadPlexConfig() — same callsite shape, same disabled-vs-error
 * semantics, so the row endpoint stays simple.
 */
export async function loadTidalConfig(): Promise<TidalConfig | null> {
	try {
		const raw = await readFile(CONFIG_PATH, 'utf8');
		if (!raw.trim()) return null;
		const parsed = yaml.load(raw) as Configuration | undefined;
		const tidal = parsed?.tidal;
		if (!tidal || tidal.enabled === false) return null;
		if (!tidal.client_id || !tidal.client_secret) return null;
		return tidal;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
		throw err;
	}
}

// ---------------------------------------------------------------------------
// OAuth 2.1 client-credentials token cache
// ---------------------------------------------------------------------------
//
// TIDAL access tokens expire after ~24 hours. We cache the token in module
// scope, keyed by (client_id, client_secret) so a credential change at
// runtime invalidates the cache automatically. Single-process safe; if the
// node container is restarted, the next request just re-fetches.
//
// We refresh proactively once the token is within 60s of expiry to avoid a
// race where a request flies during the window when the token is still
// "valid" by our clock but already rejected by TIDAL.

type CachedToken = {
	credKey: string; // hash of client_id|client_secret to detect rotation
	accessToken: string;
	expiresAt: number; // epoch ms
};

let tokenCache: CachedToken | null = null;
const REFRESH_MARGIN_MS = 60_000;

function credKeyFor(tidal: TidalConfig): string {
	// Not crypto — just a stable key so swapping credentials at runtime
	// (via Settings) invalidates the cached token automatically.
	return `${tidal.client_id}|${tidal.client_secret}`;
}

async function fetchAccessToken(tidal: TidalConfig): Promise<CachedToken> {
	const credKey = credKeyFor(tidal);
	const basic = Buffer.from(`${tidal.client_id}:${tidal.client_secret}`).toString('base64');

	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: 'grant_type=client_credentials'
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`TIDAL auth ${res.status}: ${body.slice(0, 200)}`);
	}

	const data = (await res.json()) as {
		access_token?: string;
		expires_in?: number;
	};

	if (!data.access_token) {
		throw new Error('TIDAL auth response missing access_token');
	}

	// Default to 24h if expires_in is missing, but minus margin to be safe.
	const expiresInMs = (data.expires_in ?? 86400) * 1000;
	return {
		credKey,
		accessToken: data.access_token,
		expiresAt: Date.now() + expiresInMs
	};
}

async function getAccessToken(tidal: TidalConfig): Promise<string> {
	const key = credKeyFor(tidal);
	const now = Date.now();
	if (tokenCache && tokenCache.credKey === key && tokenCache.expiresAt - REFRESH_MARGIN_MS > now) {
		return tokenCache.accessToken;
	}
	tokenCache = await fetchAccessToken(tidal);
	return tokenCache.accessToken;
}

/**
 * Fetch JSON from the TIDAL v2 API. Auto-applies the bearer token,
 * the required Accept header, and the country code. Throws on non-2xx.
 *
 * If the token has just expired between cache check and request, retries
 * once with a forced refresh.
 */
export async function tidalFetchJson(
	tidal: TidalConfig,
	path: string,
	params: Record<string, string> = {}
): Promise<any> {
	const country = tidal.country_code || DEFAULT_COUNTRY;
	const url = new URL(API_BASE + path);
	url.searchParams.set('countryCode', country);
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, v);
	}

	const doFetch = async (token: string) =>
		fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.api+json'
			}
		});

	let token = await getAccessToken(tidal);
	let res = await doFetch(token);

	// One retry on auth failure: the cached token might have been revoked
	// or expired right at the boundary. Bust the cache and try once more.
	if (res.status === 401) {
		tokenCache = null;
		token = await getAccessToken(tidal);
		res = await doFetch(token);
	}

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`TIDAL ${res.status} on ${path}: ${body.slice(0, 200)}`);
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Image URL resolution
// ---------------------------------------------------------------------------
//
// TIDAL catalog images are exposed as a string `id` (a UUID with hyphens)
// inside `imageLinks` / `cover` attributes. The CDN URL is built by replacing
// dashes with slashes and appending a size suffix:
//
//   https://resources.tidal.com/images/<a>/<b>/<c>/<d>/<e>/<size>.jpg
//
// where `<a>-<b>-<c>-<d>-<e>` is the original UUID and `<size>` is one of
// 80x80, 160x160, 320x320, 640x640, 1280x1280 (album/track) or 480x480,
// 750x750, 1080x1080 (artist) etc. We pick a reasonable poster size.

const ALLOWED_SIZES = ['80x80', '160x160', '320x320', '640x640', '1280x1280'];

export function tidalImageUrl(uuid: string, size = '320x320'): string {
	if (!ALLOWED_SIZES.includes(size)) size = '320x320';
	// Reject anything that doesn't look like a TIDAL image UUID — defensive
	// because the value originates from API responses but flows through a
	// query-string proxy.
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
		throw new Error('Invalid TIDAL image UUID');
	}
	const path = uuid.replace(/-/g, '/');
	return `https://resources.tidal.com/images/${path}/${size}.jpg`;
}
