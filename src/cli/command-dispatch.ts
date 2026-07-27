/**
 * Command dispatch table — extracted from main.tsx's if/else chain to make
 * command routing declarative and testable.
 *
 * Two tiers of commands:
 * 1. Pre-config commands (login, logout) — run before `loadConfig()` because
 *    the user may be onboarding with no valid provider yet.
 * 2. Post-config commands (chat, run, config, status, etc.) — require a
 *    loaded config.
 *
 * Each tier is a `Map<string, CommandEntry>` mapping command name → handler.
 * Aliases (e.g. `tasks` → `plan tasks`, `todo` → `plan todo`) are resolved
 * via a `CommandAlias` type entry that rewrites args before dispatch.
 *
 * The `plan` command has a special case: when `args[0]` is `show`, `tasks`,
 * or `todo`, it routes to `handlePlan`; otherwise it routes to `handleAgent`.
 * This is handled by a `CommandRedirect` entry that checks args and picks
 * the real handler.
 */

import type { Config } from "../config/schema.js";
import { handleAgent } from "./handlers/agent.js";
import { handleConfig } from "./handlers/config.js";
import { handleLogin, handleLogout } from "./handlers/login.js";
import { handleMcp } from "./handlers/mcp.js";
import { handleMemory } from "./handlers/memory.js";
import { handlePlan } from "./handlers/plan.js";
import { handleSkill } from "./handlers/skill.js";
import { handleState } from "./handlers/state.js";
import { handleStatus } from "./handlers/status.js";
import { handleTrace } from "./handlers/trace.js";
import type { CliOptions } from "./shared.js";

// ─── Types ──────────────────────────────────────────────────────────────

/** Context available to post-config command handlers. */
export interface DispatchContext {
	config: Config;
	args: string[];
	options: CliOptions;
}

/** A standard command handler that receives config + args + options. */
type CommandHandler = (ctx: DispatchContext) => Promise<void>;

/** A pre-config handler (no config loaded yet — e.g. login/logout). */
type PreConfigHandler = (args: string[], options: CliOptions) => Promise<void>;

/** Entry in the post-config dispatch table. */
export type CommandEntry =
	| { type: "handler"; handler: CommandHandler }
	| { type: "alias"; target: string; args: string[] };

/** Entry in the pre-config dispatch table. */
export type PreConfigEntry = {
	type: "handler";
	handler: PreConfigHandler;
};

// ─── Pre-config table (login, logout) ────────────────────────────────────

const PRE_CONFIG_TABLE: Map<string, PreConfigEntry> = new Map([
	["login", { type: "handler", handler: (args) => handleLogin(args) }],
	["logout", { type: "handler", handler: (args) => handleLogout(args) }],
]);

/**
 * Dispatch a pre-config command (runs before `loadConfig()`).
 * Returns true if the command was handled, false if it's not a pre-config
 * command (caller should proceed to load config and dispatch post-config).
 */
export async function dispatchPreConfig(command: string, args: string[], options: CliOptions): Promise<boolean> {
	const entry = PRE_CONFIG_TABLE.get(command);
	if (!entry) return false;
	await entry.handler(args, options);
	return true;
}

// ─── Post-config table (chat, run, config, etc.) ──────────────────────────

/**
 * Build the post-config command dispatch table.
 *
 * The `plan` command has a special routing rule: when `args[0]` is `show`,
 * `tasks`, or `todo`, it routes to `handlePlan`; otherwise it routes to
 * `handleAgent`. This is implemented inline in the handler rather than as
 * an alias because both paths need the full DispatchContext.
 */
function buildPostConfigTable(): Map<string, CommandEntry> {
	const table = new Map<string, CommandEntry>([
		[
			"chat",
			{
				type: "handler",
				handler: (ctx) => handleInteractiveChatRef(ctx),
			},
		],
		[
			"run",
			{
				type: "handler",
				handler: (ctx) => handleRunRef(ctx),
			},
		],
		["config", { type: "handler", handler: (ctx) => handleConfig(ctx.config, ctx.args) }],
		["status", { type: "handler", handler: (ctx) => handleStatus(ctx.config, ctx.options) }],
		["memory", { type: "handler", handler: (ctx) => handleMemory(ctx.config, ctx.args, ctx.options) }],
		["skill", { type: "handler", handler: (ctx) => handleSkill(ctx.config, ctx.args, ctx.options) }],
		["mcp", { type: "handler", handler: (ctx) => handleMcp(ctx.args) }],
		["state", { type: "handler", handler: (ctx) => handleState(ctx.config, ctx.args, ctx.options) }],
		["trace", { type: "handler", handler: (ctx) => handleTrace(ctx.config, ctx.args, ctx.options) }],
		["plan", { type: "handler", handler: (ctx) => handlePlanRoute(ctx) }],
		["build", { type: "handler", handler: (ctx) => handleAgent("build", ctx.args, ctx.options) }],
		["explore", { type: "handler", handler: (ctx) => handleAgent("explore", ctx.args, ctx.options) }],
		["run-plan-build", { type: "handler", handler: (ctx) => handleAgent("run-plan-build", ctx.args, ctx.options) }],
		["run-all", { type: "handler", handler: (ctx) => handleAgent("run-all", ctx.args, ctx.options) }],
		// Aliases — rewrite args then dispatch to the target command
		["tasks", { type: "alias", target: "plan", args: ["tasks"] }],
		["todo", { type: "alias", target: "plan", args: ["todo"] }],
	]);

	return table;
}

// ─── Special routing: plan ────────────────────────────────────────────────

/** Plan subcommands that route to handlePlan instead of handleAgent. */
const PLAN_PLAN_SUBCOMMANDS = new Set(["show", "tasks", "todo"]);

/** Route the `plan` command: show/tasks/todo → handlePlan, else → handleAgent. */
async function handlePlanRoute(ctx: DispatchContext): Promise<void> {
	const firstArg = ctx.args[0] ?? "";
	if (PLAN_PLAN_SUBCOMMANDS.has(firstArg)) {
		await handlePlan(ctx.config, ctx.args, ctx.options);
	} else {
		await handleAgent("plan", ctx.args, ctx.options);
	}
}

// ─── Refs to main.tsx-only handlers ────────────────────────────────────────
//
// handleRun and handleInteractiveChat live in main.tsx (they depend on Ink
// rendering and stdout streaming that are tightly coupled to the CLI entry
// point). Rather than moving them, we accept injected refs so the dispatch
// table can route to them without a circular import.
//
// main.tsx sets these refs before calling dispatchCommand().

type RunHandler = (config: Config, args: string[], options: CliOptions) => Promise<void>;
type ChatHandler = (config: Config, args: string[], options: CliOptions) => Promise<void>;

let _handleRunRef: RunHandler | null = null;
let _handleChatRef: ChatHandler | null = null;

/** Register the main.tsx-local handlers (call once at startup). */
export function registerMainHandlers(run: RunHandler, chat: ChatHandler): void {
	_handleRunRef = run;
	_handleChatRef = chat;
}

async function handleRunRef(ctx: DispatchContext): Promise<void> {
	if (!_handleRunRef) throw new Error("handleRun not registered — call registerMainHandlers() first");
	await _handleRunRef(ctx.config, ctx.args, ctx.options);
}

async function handleInteractiveChatRef(ctx: DispatchContext): Promise<void> {
	if (!_handleChatRef) throw new Error("handleInteractiveChat not registered — call registerMainHandlers() first");
	await _handleChatRef(ctx.config, ctx.args, ctx.options);
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

/** Commands listed in the "unknown command" error message.
 *  Includes usage hints (e.g. `run <prompt>`) for commands that take args. */
export const KNOWN_COMMANDS = [
	"chat",
	"run <prompt>",
	"trace <prompt>",
	"login",
	"logout",
	"config",
	"status",
	"memory",
	"skill",
	"mcp",
	"plan",
	"build",
	"explore",
	"run-plan-build",
	"run-all",
	"state",
	"plan show",
	"tasks",
	"todo",
] as const;

/** Options listed in the "unknown command" error message. */
const KNOWN_OPTIONS = "--model <model>, --provider <provider>, --verbose, --save, --state-file, --help";

/**
 * Dispatch a post-config command.
 *
 * Resolves aliases, routes to the appropriate handler, and prints an error
 * for unknown commands. The caller is responsible for loading the config
 * and constructing the DispatchContext.
 */
export async function dispatchCommand(command: string, ctx: DispatchContext): Promise<void> {
	const table = buildPostConfigTable();
	const entry = table.get(command);

	if (!entry) {
		console.error(`Unknown command: ${command}`);
		console.error(`Available commands: ${KNOWN_COMMANDS.join(", ")}`);
		console.error(`Options: ${KNOWN_OPTIONS}`);
		process.exit(2);
	}

	if (entry.type === "alias") {
		const targetEntry = table.get(entry.target);
		if (targetEntry?.type === "handler") {
			await targetEntry.handler({ ...ctx, args: entry.args });
			return;
		}
		// If the alias target is itself an alias or missing, fall through to error
		console.error(`Internal error: alias target "${entry.target}" is not a handler`);
		process.exit(2);
	}

	await entry.handler(ctx);
}

// ─── Pure helpers for testing ──────────────────────────────────────────────

/** Return true if `command` is a pre-config command (login/logout). */
export function isPreConfigCommand(command: string): boolean {
	return PRE_CONFIG_TABLE.has(command);
}

/** Return true if `command` is a known post-config command or alias. */
export function isPostConfigCommand(command: string): boolean {
	return buildPostConfigTable().has(command);
}

/** Resolve an alias to its target command + args. Returns null if not an alias. */
export function resolveAlias(command: string, _args: string[]): { command: string; args: string[] } | null {
	const table = buildPostConfigTable();
	const entry = table.get(command);
	if (entry?.type === "alias") {
		return { command: entry.target, args: entry.args };
	}
	return null;
}

/** Determine which plan route to take: "plan" (handlePlan) or "agent" (handleAgent). */
export function planRoute(firstArg: string | undefined): "plan" | "agent" {
	return PLAN_PLAN_SUBCOMMANDS.has(firstArg ?? "") ? "plan" : "agent";
}
