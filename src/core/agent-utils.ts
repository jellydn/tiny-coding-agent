/**
 * Agent utility functions — pure helpers extracted from agent.ts to break
 * the circular dependency between agent.ts and turn-executor.ts.
 *
 * `isLooping` and `truncateOutput` are used by both Agent.runStream() and
 * TurnExecutor.executeTurn(). Moving them here lets turn-executor.ts import
 * from this file instead of from agent.ts, breaking the cycle.
 */

const MAX_OUTPUT_LENGTH = 500;

// Loop detection thresholds
export const LOOP_DETECTION = {
	MIN_RECENT_CALLS: 3,
	IDENTICAL_REPEAT: 3,
	SAME_TOOL_THRESHOLD: 5,
	DOMINANT_TOOL_THRESHOLD: 8,
	LOOKBACK_WINDOW: 10,
} as const;

export function isLooping(recentToolCalls: string[]): boolean {
	if (recentToolCalls.length < LOOP_DETECTION.MIN_RECENT_CALLS) return false;

	const extractTool = (call: string): string => call.match(/^([^:]+):/)?.[1] ?? "";
	const lastCall = recentToolCalls[recentToolCalls.length - 1] ?? "";
	const lastTool = extractTool(lastCall);

	if (recentToolCalls.slice(-LOOP_DETECTION.IDENTICAL_REPEAT).every((c) => c === lastCall)) return true;

	if (recentToolCalls.length >= LOOP_DETECTION.SAME_TOOL_THRESHOLD) {
		const lastFive = recentToolCalls.slice(-LOOP_DETECTION.SAME_TOOL_THRESHOLD);
		if (lastFive.every((c) => extractTool(c) === lastTool)) return true;
	}

	if (recentToolCalls.length >= LOOP_DETECTION.LOOKBACK_WINDOW) {
		const counts: Record<string, number> = {};
		for (const call of recentToolCalls.slice(-LOOP_DETECTION.LOOKBACK_WINDOW)) {
			const tool = extractTool(call);
			counts[tool] = (counts[tool] ?? 0) + 1;
		}
		if (Math.max(...Object.values(counts), 0) >= LOOP_DETECTION.DOMINANT_TOOL_THRESHOLD) return true;
	}

	return false;
}

export function truncateOutput(output: string | undefined): string | undefined {
	if (!output) return output;
	const lines = output.split("\n");
	if (lines.length > 10) {
		return `${lines.slice(0, 10).join("\n")}\n... (${lines.length - 10} more lines)`;
	}
	if (output.length > MAX_OUTPUT_LENGTH) {
		return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n... (${output.length - MAX_OUTPUT_LENGTH} more chars)`;
	}
	return output;
}
