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

export function fuzzyMatch(input: string, target: string, threshold = 0.7): boolean {
  const normalize = (s: string) => s.toLowerCase().trim();
  const a = normalize(input);
  const b = normalize(target);

  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;

  const longer = a.length > b.length ? a : b;
  if (longer.length === 0) return true;

  const editDistance = (str1: string, str2: string): number => {
    const len1 = str1.length;
    const len2 = str2.length;
    const dp: number[][] = Array.from(
      { length: len2 + 1 },
      () => Array(len1 + 1).fill(0) as number[],
    );

    for (let i = 0; i <= len2; i++) {
      dp[i]![0] = i;
    }
    for (let j = 0; j <= len1; j++) {
      dp[0]![j] = j;
    }

    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2[i - 1] === str1[j - 1]) {
          dp[i]![j] = dp[i - 1]![j - 1]!;
        } else {
          dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
        }
      }
    }

    return dp[len2]![len1]!;
  };

  const distance = editDistance(a, b);
  const similarity = 1 - distance / longer.length;
  return similarity >= threshold;
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
    if (state === "on" || state === "true" || state === "enable") {
      return {
        isCommand: true,
        newState: { thinking: { enabled: true } },
        matchedCommand: COMMANDS.THINKING,
      };
    }
    if (state === "off" || state === "false" || state === "disable") {
      return {
        isCommand: true,
        newState: { thinking: { enabled: false } },
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
