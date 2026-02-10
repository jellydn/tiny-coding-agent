import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { CliOptions } from "../shared.js";

const DEFAULT_STATE_FILE = ".tiny-state.json";

export async function handleState(_config: unknown, args: string[], options: CliOptions): Promise<void> {
	const stateFile = options.stateFile || DEFAULT_STATE_FILE;

	if (args[0] === "show") {
		if (existsSync(stateFile)) {
			const content = await readFile(stateFile, "utf-8");
			try {
				const parsed = JSON.parse(content);
				console.log(JSON.stringify(parsed, null, 2));
			} catch {
				console.log(content);
			}
		} else {
			console.error(`State file not found: ${stateFile}`);
			process.exit(1);
		}
	} else if (args[0] === "clear") {
		const defaultState = {
			metadata: {
				agentName: "tiny-agent",
				agentVersion: "0.5.0",
				invocationTimestamp: new Date().toISOString(),
				parameters: {},
			},
			phase: "plan" as const,
			taskDescription: "",
			status: "pending" as const,
			results: {},
			errors: [],
			artifacts: [],
		};
		await writeFile(stateFile, JSON.stringify(defaultState, null, 2), "utf-8");
		console.log(`State file cleared: ${stateFile}`);
	} else {
		console.error("Unknown state command. Use: state show | state clear");
		process.exit(2);
	}
}
