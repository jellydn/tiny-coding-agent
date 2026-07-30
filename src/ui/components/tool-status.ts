import type { ToolStatus } from "../types/enums.js";

/**
 * Unified tool status type that accepts both the `ToolStatus` enum (used by
 * Message.tsx) and the `ToolCallStatus` string union (used by ToolCall.tsx
 * and ToolsPanel.tsx), plus the string aliases that Message.tsx accepts.
 */
export type UnifiedToolStatus = ToolStatus | ToolCallStatus | "running" | "complete" | "error";

/** The string-union status type used by ToolCall.tsx / ToolsPanel.tsx. */
export type ToolCallStatus = "pending" | "success" | "error";

// --- Status icon/color maps ---

/** All valid status keys for icon/color lookups. */
type StatusMapKey = "running" | "complete" | "error" | "pending" | "success";

const STATUS_ICON_MAP: Record<StatusMapKey, string> = {
	running: "[running]",
	complete: "[✓]",
	error: "[✗]",
	pending: "[pending]",
	success: "[✓]",
};

const STATUS_COLOR_MAP: Record<StatusMapKey, string> = {
	running: "cyan",
	complete: "green",
	error: "red",
	pending: "yellow",
	success: "green",
};

/**
 * Get the status icon for a tool status.
 * Works with both `ToolStatus` enum and `ToolCallStatus` string union.
 */
export function getStatusIcon(status: UnifiedToolStatus | undefined): string {
	if (status === undefined) return "[running]";
	return STATUS_ICON_MAP[status] ?? "[running]";
}

/**
 * Get the status color for a tool status.
 * Works with both `ToolStatus` enum and `ToolCallStatus` string union.
 */
export function getStatusColor(status: UnifiedToolStatus | undefined): string {
	if (status === undefined) return "cyan";
	return STATUS_COLOR_MAP[status] ?? "cyan";
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * e.g. `340ms` or `1.2s`.
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

// --- Git command formatting (from Message.tsx) ---

/**
 * Format a tool name for display, expanding `bash` commands that invoke `git`
 * into a more readable form (e.g. `git diff --staged`).
 */
export function formatGitCommand(name: string, args: Record<string, unknown> | undefined): string {
	if (name !== "bash") return name;

	const command = (args?.command as string) ?? "";
	if (!command) return "bash";

	const gitMatch = command.match(/^\s*git\s+(\S+)(.*)$/);
	if (!gitMatch) {
		return command.trim().startsWith("git ") ? command.trim() : "bash";
	}

	const subcommand = gitMatch[1] ?? "";
	const rest = gitMatch[2]?.trim() ?? "";

	if (subcommand === "diff" && rest.includes("--staged")) return "git diff --staged";
	if (subcommand === "log" && rest.includes("--oneline")) return "git log --oneline";
	if (["show", "commit", "pull", "push", "remote", "tag", "stash", "config", "fetch"].includes(subcommand)) {
		return `git ${subcommand}`;
	}
	if (rest) return `git ${subcommand} ${rest}`;

	return `git ${subcommand}`;
}

// --- Tool marker detection (from Message.tsx) ---

const TOOL_MARKERS = ["[✓]", "[✗]", "[running]"] as const;

/**
 * Check if a text block contains tool status markers (e.g. `[✓]`, `[✗]`).
 * Used by Message.tsx to decide whether to apply syntax highlighting.
 */
export function hasToolMarkers(text: string): boolean {
	return TOOL_MARKERS.some((marker) => text.includes(marker));
}
