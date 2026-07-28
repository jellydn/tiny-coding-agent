/**
 * CLI prompt helpers — the single source of truth for readline-based user
 * input. Extracted from login.ts (prompt, promptHidden), build-agent.ts
 * (promptRecoveryDecision), and plan-agent.ts (inline readline).
 *
 * The security-sensitive `promptHidden` (raw-mode `*` echoing with Ctrl+C
 * handling) lives here so it can be tested in isolation.
 *
 * Prompt DI: tests can override prompt/promptHidden via setPromptDeps()
 * and restore defaults via resetPromptDeps(). Flow functions in
 * login-flow.ts call getPromptFn()/getPromptHiddenFn() instead of the
 * real functions directly, so mock prompts take effect without touching
 * production callers (build-agent, plan-agent) that import prompt()
 * directly.
 */

// ===== Prompt DI singleton =====

export interface PromptDeps {
	prompt: (question: string) => Promise<string>;
	promptHidden: (question: string) => Promise<string>;
}

let _promptFn: (question: string) => Promise<string> = prompt;
let _promptHiddenFn: (question: string) => Promise<string> = promptHidden;

/** Override prompt functions for testing. Call resetPromptDeps() in afterEach. */
export function setPromptDeps(deps: Partial<PromptDeps>): void {
	if (deps.prompt) _promptFn = deps.prompt;
	if (deps.promptHidden) _promptHiddenFn = deps.promptHidden;
}

/** Restore default prompt functions after a test override. */
export function resetPromptDeps(): void {
	_promptFn = prompt;
	_promptHiddenFn = promptHidden;
}

/** Get the current prompt function (real or mock). Used by login-flow.ts. */
export function getPromptFn(): (question: string) => Promise<string> {
	return _promptFn;
}

/** Get the current promptHidden function (real or mock). Used by login-flow.ts. */
export function getPromptHiddenFn(): (question: string) => Promise<string> {
	return _promptHiddenFn;
}

/**
 * Read a line from stdin via readline. Returns the trimmed answer.
 */
export async function prompt(question: string): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Read a line from stdin with masked input (echoes `*` for each character).
 * Falls back to plain readline when stdin is not a TTY (e.g. piped input).
 *
 * Rejects with an error on Ctrl+C instead of calling process.exit(0), so
 * callers can handle the interruption gracefully (e.g. abort the login
 * flow and return to the prompt).
 *
 * Security note: the raw-mode masking only works in a real PTY. When stdin
 * is piped (not a TTY), the input will be visible — this is the fallback
 * path used in tests.
 */
export async function promptHidden(promptText: string): Promise<string> {
	process.stdout.write(promptText);

	const stdin = process.stdin;

	// Non-TTY fallback: use plain readline (input will be visible)
	if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
		const { createInterface } = await import("node:readline");
		const rl = createInterface({ input: stdin, output: process.stdout });
		return new Promise((resolve) => {
			rl.question("", (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		});
	}

	// TTY: read character-by-character with masking
	return new Promise((resolve, reject) => {
		let input = "";
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		const onData = (char: string): void => {
			const code = char.charCodeAt(0);
			switch (char) {
				case "\r":
				case "\n":
					stdin.removeListener("data", onData);
					stdin.setRawMode(false);
					stdin.pause();
					process.stdout.write("\n");
					resolve(input.trim());
					break;
				case "\u0003": // Ctrl+C
					stdin.removeListener("data", onData);
					stdin.setRawMode(false);
					stdin.pause();
					process.stdout.write("\n");
					reject(new Error("Interrupted by user (Ctrl+C)"));
					break;
				case "\u007f": // Delete
				case "\b": // Backspace
					if (input.length > 0) {
						input = input.slice(0, -1);
						process.stdout.write("\b \b");
					}
					break;
				default:
					// Only store printable characters (code >= 32)
					if (code >= 32) {
						input += char;
						process.stdout.write("*");
					}
			}
		};

		stdin.on("data", onData);
	});
}

/**
 * Prompt the user to choose from a list of options. The prompt shows the
 * options and accepts a case-insensitive match. Returns null when the
 * answer doesn't match any option — callers should handle the null case
 * (e.g. re-prompt, default, or abort) rather than silently falling back.
 *
 * This consolidates the `promptRecoveryDecision` pattern from build-agent.ts
 * and the `confirmMajorDecision` pattern from plan-agent.ts.
 */
export async function promptChoice(question: string, options: string[]): Promise<string | null> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		rl.question(`${question}\nOptions: ${options.join(", ")}: `, (answer) => {
			rl.close();
			const normalized = answer.toLowerCase().trim();
			const matched = options.find((option) => option.toLowerCase() === normalized);
			resolve(matched ?? null);
		});
	});
}
