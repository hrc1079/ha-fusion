import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import type { Configuration, PlexConfig } from '$lib/Types';

const CONFIG_PATH = './data/configuration.yaml';

/**
 * Read the plex section of configuration.yaml.
 * Returns null when not configured (or missing). The caller should treat null
 * as "Plex feature disabled" and respond with 503 or empty.
 */
export async function loadPlexConfig(): Promise<PlexConfig | null> {
	try {
		const raw = await readFile(CONFIG_PATH, 'utf8');
		if (!raw.trim()) return null;
		const parsed = yaml.load(raw) as Configuration | undefined;
		const plex = parsed?.plex;
		if (!plex || plex.enabled === false) return null;
		if (!plex.url || !plex.server_token) return null;
		return plex;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
		throw err;
	}
}

/**
 * Build the Plex Media Server URL with token query param.
 */
export function plexUrl(
	plex: PlexConfig,
	path: string,
	params: Record<string, string> = {}
): string {
	const url = new URL(path, plex.url);
	url.searchParams.set('X-Plex-Token', plex.server_token ?? '');
	for (const [k, v] of Object.entries(params)) {
		url.searchParams.set(k, v);
	}
	return url.toString();
}

/**
 * Fetch JSON from the Plex Media Server. Throws on non-2xx.
 */
export async function plexFetchJson(
	plex: PlexConfig,
	path: string,
	params: Record<string, string> = {}
): Promise<any> {
	const url = plexUrl(plex, path, params);
	const res = await fetch(url, {
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Plex ${res.status} on ${path}: ${body.slice(0, 200)}`);
	}
	return res.json();
}
