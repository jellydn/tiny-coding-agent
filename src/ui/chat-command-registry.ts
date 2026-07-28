/**
 * Chat command registry — the single source of truth for slash-command
 * metadata in the chat UI. Extracted from useCommandHandler's switch and
 * CommandMenu's hardcoded STATIC_COMMANDS so both consume the same data.
 *
 * This module holds **metadata only** (name, description, takesArgs,
 * helpText). The actual handler functions live in useCommandHandler.ts as
 * useCallback hooks — the registry is a pure data module with no React
 * dependency, so it can be imported by both the hook (for dispatch) and the
 * CommandMenu component (for the autocomplete list).
 *
 * Adding a new chat command:
 * 1. Add an entry to CHAT_COMMANDS (this file)
 * 2. Add a handler case in useCommandHandler.ts's dispatch map
 * No need to edit CommandMenu.tsx — it auto-generates from CHAT_COMMANDS.
 */

export interface ChatCommandMeta {
	/** Slash command name, e.g. "/help". */
	name: string;
	/** Short description shown in the command picker and /help output. */
	description: string;
	/** Whether this command accepts arguments (e.g. "/skill react"). */
	takesArgs?: boolean;
}

/**
 * All chat commands, ordered by display priority for the command picker.
 * Keep this in sync with the dispatch map in useCommandHandler.ts.
 */
export const CHAT_COMMANDS: readonly ChatCommandMeta[] = [
	{ name: "/help", description: "Show available commands" },
	{ name: "/clear", description: "Clear conversation" },
	{ name: "/model", description: "Switch model" },
	{ name: "/agent", description: "Switch agent" },
	{ name: "/login", description: "Show provider connection status" },
	{ name: "/logout", description: "Show provider logout status" },
	{ name: "/tools", description: "View tool executions" },
	{ name: "/mcp", description: "Show MCP server status" },
	{ name: "/memory", description: "List memories" },
	{ name: "/skill", description: "List skills", takesArgs: true },
	{ name: "/plan", description: "Show current plan" },
	{ name: "/tasks", description: "List all tasks with status" },
	{ name: "/todo", description: "Show pending tasks" },
	{ name: "/review", description: "Review current plan with hooks" },
	{ name: "/exit", description: "Exit the session" },
];

/**
 * Commands that route to the same handler (plan/tasks/todo all go to
 * handlePlanCommand with different args).
 */
export const COMMAND_ALIASES: ReadonlyMap<string, string> = new Map([
	["/tasks", "/plan"],
	["/todo", "/plan"],
]);

/** Get a command's metadata by name. Returns undefined if not found. */
export function getCommandMeta(name: string): ChatCommandMeta | undefined {
	return CHAT_COMMANDS.find((cmd) => cmd.name === name);
}

/** Resolve an alias to its canonical command name. Returns the input if no alias. */
export function resolveCommandAlias(name: string): string {
	return COMMAND_ALIASES.get(name) ?? name;
}

/** Generate the /help text from the registry. */
export function generateHelpText(): string {
	const lines = CHAT_COMMANDS.map((cmd) => `  ${cmd.name.padEnd(9)} - ${cmd.description}`);
	return `Available commands:\n${lines.join("\n")}`;
}

/** Get the list of command names for the CommandMenu autocomplete. */
export function getCommandList(): Array<{ name: string; description: string }> {
	return CHAT_COMMANDS.map((cmd) => ({ name: cmd.name, description: cmd.description }));
}
