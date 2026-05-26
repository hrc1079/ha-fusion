<script lang="ts">
	import { dashboard, motion } from '$lib/Stores';

	/**
	 * Background overlay.
	 *
	 * Resolves a background URL from the current view first, then the
	 * dashboard-level setting, then null (theme falls through).
	 *
	 *   # dashboard.yaml (top level)
	 *   background: "https://example.com/family.jpg"
	 *
	 *   # per-view override
	 *   views:
	 *     - name: Music
	 *       background: "https://example.com/music.jpg"
	 *
	 * Behavior:
	 *  - Renders an absolutely-positioned <div> covering the viewport
	 *    behind everything (`z-index: -1`). The theme's body background
	 *    remains as a fallback when no custom background is set.
	 *  - Cross-fades when the resolved URL changes, using `$motion`.
	 *  - Two stacked layers so we can fade between them.
	 */

	export let view: { background?: string } | undefined = undefined;

	$: dashboardBg = typeof $dashboard?.background === 'string' ? $dashboard.background : undefined;
	$: viewBg = typeof view?.background === 'string' ? view.background : undefined;
	$: resolvedUrl = viewBg || dashboardBg;

	// Two layer slots — A and B. We alternate which one holds the active URL
	// so the other can fade out underneath.
	let layerA: string | undefined;
	let layerB: string | undefined;
	let visibleLayer: 'A' | 'B' = 'A';

	let lastUrl: string | undefined;
	$: handleChange(resolvedUrl);

	function handleChange(url: string | undefined) {
		if (url === lastUrl) return;
		lastUrl = url;

		if (visibleLayer === 'A') {
			layerB = url;
			visibleLayer = 'B';
		} else {
			layerA = url;
			visibleLayer = 'A';
		}
	}
</script>

{#if layerA || layerB}
	<div
		class="bg-layer"
		class:visible={visibleLayer === 'A'}
		style:background-image={layerA ? `url(${JSON.stringify(layerA)})` : 'none'}
		style:transition="opacity {$motion * 2}ms ease"
	></div>
	<div
		class="bg-layer"
		class:visible={visibleLayer === 'B'}
		style:background-image={layerB ? `url(${JSON.stringify(layerB)})` : 'none'}
		style:transition="opacity {$motion * 2}ms ease"
	></div>
{/if}

<style>
	.bg-layer {
		position: fixed;
		inset: 0;
		z-index: -1;
		background-size: cover;
		background-repeat: no-repeat;
		background-position: center center;
		background-attachment: fixed;
		opacity: 0;
		pointer-events: none;
	}
	.bg-layer.visible {
		opacity: 1;
	}
</style>
