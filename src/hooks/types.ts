/**
 * Hook system types — lifecycle hooks for the tiny-coding-agent.
 *
 * Hooks allow external commands (e.g. plannotator) to intercept the agent's
 * lifecycle at defined points, review/modify data, and return feedback.
 * This is the foundation for human-in-the-loop integrations like plannotator.
 *
 * @see src/hooks/manager.ts for the execution engine
 * @see src/hooks/presets.ts for built-in hook presets (plannotator)
 */

/** Lifecycle events where hooks can fire. */
export type HookEvent =
	/** Fires after planAgent() generates a plan, before it's saved to the state file.
	 *  The hook receives the plan text (Markdown) and can return modified text. */
	| "post-plan-generate"
	/** Fires before buildAgent() starts executing steps, after the plan is loaded.
	 *  The hook receives the plan text and can return modified text. */
	| "pre-build-execute"
	/** Fires after exploreAgent() completes, before the report is saved.
	 *  The hook receives the findings text and can return modified text. */
	| "post-explore-complete";

/** Input passed to a hook handler. */
export interface HookInput {
	/** The lifecycle event that triggered the hook. */
	event: HookEvent;
	/** The primary content for the hook to review (e.g. plan text, findings). */
	content: string;
	/** The state file path (if available). */
	stateFile?: string;
	/** The task description (if available). */
	taskDescription?: string;
	/** Additional metadata about the context. */
	meta?: Record<string, unknown>;
}

/** Result returned by a hook handler. */
export interface HookResult {
	/** Whether the hook executed successfully. */
	success: boolean;
	/** Modified content (if the hook changed it). If undefined, the original content is kept. */
	modifiedContent?: string;
	/** Feedback message from the hook (e.g. user annotations, comments). */
	feedback?: string;
	/** Error message if the hook failed. */
	error?: string;
	/** Whether the hook was skipped (e.g. binary not found). */
	skipped?: boolean;
	/** Whether the human approved the content (for review hooks). */
	approved?: boolean;
}

/** Configuration for a single hook. */
export interface HookConfig {
	/** Display name for the hook. */
	name: string;
	/** The lifecycle event this hook listens to. */
	event: HookEvent;
	/** The command to execute (e.g. "plannotator", "npx", "./review.sh"). */
	command: string;
	/** Arguments to pass to the command. */
	args?: string[];
	/** Environment variables to set for the command. */
	env?: Record<string, string>;
	/** Timeout in milliseconds (0 = no timeout). Default: 0 (no timeout). */
	timeoutMs?: number;
	/** Whether this hook is enabled. Default: true. */
	enabled?: boolean;
	/** How to pass content to the command: "stdin" (pipe) or "arg" (append as last arg). Default: "stdin". */
	inputMode?: "stdin" | "arg";
	/** Whether to use the modified content from the hook result. Default: true. */
	applyModifications?: boolean;
}

/** A registered hook preset that can be installed with a single command. */
export interface HookPreset {
	/** Preset identifier (e.g. "plannotator"). */
	id: string;
	/** Display name. */
	name: string;
	/** Description of what the preset does. */
	description: string;
	/** The hook configuration to install. */
	hooks: HookConfig[];
	/** Whether the command binary is available (checked at install time). */
	checkCommand?: string;
	/** Install instructions if the binary is not found. */
	installInstructions?: string;
}

/** Map of event name → list of hooks for that event. */
export type HookRegistry = Record<HookEvent, HookConfig[]>;

/** Empty hook registry (all events have empty arrays). */
export function emptyHookRegistry(): HookRegistry {
	return {
		"post-plan-generate": [],
		"pre-build-execute": [],
		"post-explore-complete": [],
	};
}
