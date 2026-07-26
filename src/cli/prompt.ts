/**
 * CLI prompt helpers — the single source of truth for readline-based user
 * input. Extracted from login.ts (prompt, promptHidden), build-agent.ts
 * (promptRecoveryDecision), and plan-agent.ts (inline readline).
 *
 * The security-sensitive `promptHidden` (raw-mode `*` echoing with Ctrl+C
 * handling) lives here so it can be tested in isolation.
 */

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
	return new Promise((resolve) => {
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
					stdin.setRawMode(false);
					stdin.pause();
					process.stdout.write("\n");
					process.exit(0);
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
 * options and accepts a case-insensitive match. Falls back to the first
 * option if the answer doesn't match any.
 *
 * This consolidates the `promptRecoveryDecision` pattern from build-agent.ts
 * and the `confirmMajorDecision` pattern from plan-agent.ts.
 */
export async function promptChoice(question: string, options: string[]): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		rl.question(`${question}\nOptions: ${options.join(", ")}: `, (answer) => {
			rl.close();
			const normalized = answer.toLowerCase().trim();
			const matched = options.find((option) => option.toLowerCase() === normalized);
			resolve(matched ?? options[0] ?? "");
		});
	});
}
