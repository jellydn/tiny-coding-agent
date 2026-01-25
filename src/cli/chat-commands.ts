import type { ThinkingConfig } from "../config/schema.js";

export interface SessionState {
	model: string;
	thinking?: ThinkingConfig;
}

export const COMMANDS = {
	MODEL: "/model",
	THINKING: "/thinking",
	EFFORT: "/effort",
	BYE: "/bye",
} as const;

export interface ParsedCommand {
	isCommand: boolean;
	newState?: Partial<SessionState>;
	matchedCommand?: string;
	error?: string;
	shouldExit?: boolean;
}

const THINKING_ON_VALUES = new Set(["on", "true", "enable"]);
const THINKING_OFF_VALUES = new Set(["off", "false", "disable"]);

function parseThinkingState(value: string): { enabled: boolean } | null {
	if (THINKING_ON_VALUES.has(value)) return { enabled: true };
	if (THINKING_OFF_VALUES.has(value)) return { enabled: false };
	return null;
}

export function fuzzyMatch(input: string, target: string, threshold = 0.7): boolean {
	const a = input.toLowerCase().trim();
	const b = target.toLowerCase().trim();

	if (a === b) return true;
	if (a.startsWith(b) || b.startsWith(a)) return true;

	// Levenshtein distance for short strings only
	const len1 = a.length;
	const len2 = b.length;
	if (len1 === 0 || len2 === 0) return false;
	if (len1 > 20 || len2 > 20) return false;

	const dp: number[][] = Array(len2 + 1)
		.fill(null)
		.map(() => Array(len1 + 1).fill(0));

	for (let i = 0; i <= len2; i++) dp[i]![0] = i;
	for (let j = 0; j <= len1; j++) dp[0]![j] = j;

	for (let i = 1; i <= len2; i++) {
		for (let j = 1; j <= len1; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				dp[i]![j] = dp[i - 1]?.[j - 1]!;
			} else {
				dp[i]![j] = 1 + Math.min(dp[i - 1]?.[j]!, dp[i]?.[j - 1]!, dp[i - 1]?.[j - 1]!);
			}
		}
	}

	const distance = dp[len2]?.[len1]!;
	const longer = Math.max(len1, len2);
	return 1 - distance / longer >= threshold;
}

export function parseChatCommand(input: string): ParsedCommand {
	const parts = input.trim().split(/\s+/);
	const cmd = parts[0]?.toLowerCase() ?? "";

	if (fuzzyMatch(cmd, COMMANDS.MODEL) && parts.length > 1) {
		const model = parts.slice(1).join(" ");
		return { isCommand: true, newState: { model }, matchedCommand: COMMANDS.MODEL };
	}

	if (fuzzyMatch(cmd, COMMANDS.THINKING)) {
		const state = parts[1]?.toLowerCase() ?? "";
		const thinkingState = parseThinkingState(state);
		if (thinkingState) {
			return {
				isCommand: true,
				newState: { thinking: thinkingState },
				matchedCommand: COMMANDS.THINKING,
			};
		}
		return { isCommand: true, error: `Invalid thinking state: ${state}. Use: on/off` };
	}

	if (fuzzyMatch(cmd, COMMANDS.EFFORT) && parts.length > 1) {
		const effortRaw = parts[1]?.toLowerCase();
		const validEfforts = ["low", "medium", "high"] as const;
		const effortLevel = validEfforts.find((e) => e === effortRaw);

		if (effortLevel) {
			return {
				isCommand: true,
				newState: { thinking: { enabled: true, effort: effortLevel } },
				matchedCommand: COMMANDS.EFFORT,
			};
		}
		return { isCommand: true, error: `Invalid effort level: ${parts[1]}. Use: low/medium/high` };
	}

	if (fuzzyMatch(cmd, COMMANDS.BYE)) {
		return {
			isCommand: true,
			shouldExit: true,
			matchedCommand: COMMANDS.BYE,
		};
	}

	return { isCommand: false };
}
