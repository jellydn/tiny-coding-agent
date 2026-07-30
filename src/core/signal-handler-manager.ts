/**
 * Signal Handler Manager — owns process-wide signal handlers (SIGTERM, SIGINT)
 * that flush registered MemoryStore instances before exit.
 *
 * Extracted from memory.ts to isolate the mutable global state (process signal
 * listeners) from the memory store logic. This makes the signal handling
 * independently replaceable for testing or alternate environments (e.g. when
 * `process` is not available).
 */

import type { MemoryStore } from "./memory.js";

/**
 * Manages process-level signal handlers that flush MemoryStore instances
 * on SIGTERM/SIGINT, ensuring in-memory changes are persisted before exit.
 *
 * The handler is registered lazily on first `register()` call and only
 * registered once globally — subsequent calls merely add the store to the
 * set of stores to flush.
 */
export const signalHandlerManager = {
	/** The set of stores that will be flushed on signal. */
	registeredStores: new Set<MemoryStore>(),
	/** Whether the global process signal handler has been registered. */
	globalHandlerRegistered: false,

	/**
	 * Register a MemoryStore to be flushed on SIGTERM/SIGINT.
	 * The process handler is installed once on first call.
	 */
	register(store: MemoryStore): void {
		this.registeredStores.add(store);
		if (!this.globalHandlerRegistered && typeof process !== "undefined") {
			this.globalHandlerRegistered = true;
			const handler = async () => {
				await Promise.all(Array.from(this.registeredStores).map((s) => s.flush().catch(() => {})));
				process.exit(1);
			};
			process.on("SIGTERM", handler);
			process.on("SIGINT", handler);
		}
	},

	/**
	 * Unregister a MemoryStore so it is no longer flushed on signal.
	 * Does not remove the global handler (other stores may still be registered).
	 */
	unregister(store: MemoryStore): void {
		this.registeredStores.delete(store);
	},
};
