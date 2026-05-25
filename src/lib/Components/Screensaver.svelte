<script lang="ts">
	import { connection, editMode, motion, dashboard } from '$lib/Stores';
	import { fade } from 'svelte/transition';
	import { expoOut } from 'svelte/easing';
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';

	/**
	 * Screensaver overlay.
	 *
	 * Reads its config from `$dashboard.screensaver` (top-level in dashboard.yaml):
	 *
	 *   screensaver:
	 *     enabled: true            # default false
	 *     timeout: 600             # seconds of idle before activating (default 600)
	 *     mode: clock              # clock | black | template (default clock)
	 *     template: |              # only used when mode === 'template'
	 *       {{ now().strftime('%H:%M') }}
	 *
	 * Behavior:
	 *  - Disabled by default. Must be explicitly enabled.
	 *  - Idle timer resets on pointer / touch / key activity (window-level).
	 *  - Disabled while in edit mode (so the editor is never hidden).
	 *  - Fade in on activation (~600ms), fade out on dismiss (~600ms).
	 *  - Any tap or keypress dismisses.
	 */

	$: screensaver = $dashboard?.screensaver;
	$: enabled = !$editMode && screensaver?.enabled === true;
	$: timeoutSeconds =
		typeof screensaver?.timeout === 'number' && screensaver.timeout > 0 ? screensaver.timeout : 600;
	$: mode = screensaver?.mode ?? 'clock';
	$: template = screensaver?.template;

	let active = false;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let clockNow = new Date();
	let clockInterval: ReturnType<typeof setInterval> | undefined;
	let templateOutput: string | undefined;
	let templateUnsubscribe: (() => void) | undefined;

	/**
	 * Reset the idle timer. Called on any user activity.
	 * If currently active, also dismiss.
	 */
	function resetIdleTimer() {
		if (idleTimer) clearTimeout(idleTimer);

		if (!enabled) {
			active = false;
			return;
		}

		idleTimer = setTimeout(() => {
			active = true;
		}, timeoutSeconds * 1000);
	}

	/**
	 * Dismiss the screensaver and restart the idle timer.
	 */
	function dismiss() {
		active = false;
		resetIdleTimer();
	}

	/**
	 * Window-level activity listeners. Mounted in browser only.
	 */
	function handleActivity() {
		if (active) {
			dismiss();
		} else {
			resetIdleTimer();
		}
	}

	/**
	 * Subscribe to HA's render_template for the configured Jinja string.
	 * Updates `templateOutput` whenever the server pushes a new value.
	 */
	async function subscribeTemplate(tpl: string) {
		if (!$connection) return;
		try {
			templateUnsubscribe = await $connection.subscribeMessage(
				(response: { result?: string }) => {
					if (response?.result !== undefined) {
						templateOutput = String(response.result);
					}
				},
				{ type: 'render_template', template: tpl }
			);
		} catch (err) {
			console.warn('screensaver render_template failed', err);
			templateOutput = '';
		}
	}

	function unsubscribeTemplate() {
		templateUnsubscribe?.();
		templateUnsubscribe = undefined;
		templateOutput = undefined;
	}

	/**
	 * Manage template subscription based on active state + mode.
	 * Only subscribe when active && mode === template, unsubscribe otherwise
	 * to avoid burning a WebSocket subscription while the screensaver isn't visible.
	 */
	$: if (browser) {
		if (active && mode === 'template' && template && !templateUnsubscribe) {
			subscribeTemplate(template);
		} else if (!active && templateUnsubscribe) {
			unsubscribeTemplate();
		}
	}

	/**
	 * Manage clock tick. Only runs while active && mode === clock.
	 */
	$: if (browser) {
		if (active && mode === 'clock') {
			if (!clockInterval) {
				clockNow = new Date();
				clockInterval = setInterval(() => {
					clockNow = new Date();
				}, 1000);
			}
		} else if (clockInterval) {
			clearInterval(clockInterval);
			clockInterval = undefined;
		}
	}

	/**
	 * Restart the idle timer whenever enabled/timeout/mode change.
	 * If enabled becomes false (e.g. user enters edit mode), this also dismisses.
	 */
	$: if (browser) {
		// reactive dependency on enabled and timeoutSeconds
		void enabled;
		void timeoutSeconds;
		resetIdleTimer();
	}

	onMount(() => {
		if (!browser) return;
		// Attach window-level activity listeners
		const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
		events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }));

		resetIdleTimer();

		return () => {
			events.forEach((evt) => window.removeEventListener(evt, handleActivity));
		};
	});

	onDestroy(() => {
		if (idleTimer) clearTimeout(idleTimer);
		if (clockInterval) clearInterval(clockInterval);
		unsubscribeTemplate();
	});

	/**
	 * Clock formatting — locale-aware, hour:minute only, no seconds.
	 */
	$: clockTime = clockNow.toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit'
	});
</script>

{#if active}
	<div
		class="screensaver"
		class:black={mode === 'black'}
		on:click={dismiss}
		on:keydown={dismiss}
		role="button"
		tabindex="0"
		in:fade={{ duration: $motion * 2, easing: expoOut }}
		out:fade={{ duration: $motion * 2, easing: expoOut }}
	>
		{#if mode === 'clock'}
			<div class="clock">{clockTime}</div>
		{:else if mode === 'template'}
			<div class="template">
				{#if templateOutput !== undefined}
					{@html templateOutput}
				{/if}
			</div>
		{/if}
		<!-- mode === 'black' renders nothing inside, just the dim overlay -->
	</div>
{/if}

<style>
	.screensaver {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 9999;
		background: rgba(0, 0, 0, 0.92);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
	}

	.screensaver.black {
		background: black;
	}

	.clock {
		font-family: var(--theme-font-family);
		font-weight: 200;
		font-size: clamp(8rem, 25vw, 22rem);
		letter-spacing: -0.04em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		opacity: 0.92;
	}

	.template {
		font-family: var(--theme-font-family);
		font-size: clamp(2rem, 6vw, 5rem);
		font-weight: 300;
		text-align: center;
		padding: 2rem;
		max-width: 90vw;
		opacity: 0.92;
	}
</style>
