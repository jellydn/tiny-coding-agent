/**
 * Monotonic latency timer.
 *
 * Uses `process.hrtime.bigint()` for monotonic measurements so wall-clock
 * adjustments never skew latency values.
 */
export class Timer {
	private start: bigint;

	constructor() {
		this.start = process.hrtime.bigint();
	}

	/** Reset the start point. */
	reset(): void {
		this.start = process.hrtime.bigint();
	}

	/** Elapsed milliseconds since start (monotonic). */
	get ms(): number {
		return Number(process.hrtime.bigint() - this.start) / 1_000_000;
	}

	/** Elapsed nanoseconds since start. */
	get ns(): bigint {
		return process.hrtime.bigint() - this.start;
	}
}

/** Run `fn` and return `{ result, latencyMs }`. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
	const t = new Timer();
	const result = await fn();
	return { result, latencyMs: t.ms };
}
