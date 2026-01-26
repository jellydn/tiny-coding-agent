import { planAgent } from "../../agents/plan-agent.js";
import type { CliOptions } from "../shared.js";

const DEFAULT_STATE_FILE = ".tiny-state.json";

export async function handleAgent(command: string, args: string[], options: CliOptions): Promise<void> {
	const stateFile = options.stateFile || DEFAULT_STATE_FILE;
	const taskDescription = args.join(" ").trim();

	switch (command) {
		case "plan": {
			if (!taskDescription) {
				console.error("Error: 'plan' command requires a task description");
				console.error("Usage: tiny-agent plan <task-description>");
				process.exit(2);
			}
			console.log(`Plan command received: ${taskDescription}`);
			console.log(`State file: ${stateFile}`);

			const result = await planAgent(taskDescription, {
				stateFilePath: stateFile,
				generatePrd: false,
				verbose: options.verbose,
			});

			if (!result.success) {
				console.error(`Error: ${result.error}`);
				process.exit(1);
			}

			console.log("\n=== Generated Plan ===");
			console.log(result.plan);
			console.log("\nPlan written to state file.");
			break;
		}
		case "build": {
			console.log("Build command received");
			console.log(`State file: ${stateFile}`);
			console.log("Build agent not yet implemented - placeholder");
			break;
		}
		case "explore": {
			const explorationTask = taskDescription || "Explore codebase structure";
			console.log(`Explore command received: ${explorationTask}`);
			console.log(`State file: ${stateFile}`);
			console.log("Explore agent not yet implemented - placeholder");
			break;
		}
		case "run-plan-build": {
			if (!taskDescription) {
				console.error("Error: 'run-plan-build' command requires a task description");
				console.error("Usage: tiny-agent run-plan-build <task-description>");
				process.exit(2);
			}
			console.log(`Run plan-build command received: ${taskDescription}`);
			console.log(`State file: ${stateFile}`);
			console.log("1. Running plan agent...");
			console.log("2. Running build agent...");
			console.log("Workflow not yet implemented - placeholder");
			break;
		}
		case "run-all": {
			if (!taskDescription) {
				console.error("Error: 'run-all' command requires a task description");
				console.error("Usage: tiny-agent run-all <task-description>");
				process.exit(2);
			}
			console.log(`Run all command received: ${taskDescription}`);
			console.log(`State file: ${stateFile}`);
			console.log("1. Running plan agent...");
			console.log("2. Running build agent...");
			console.log("3. Running explore agent...");
			console.log("Workflow not yet implemented - placeholder");
			break;
		}
		default:
			console.error(`Unknown agent command: ${command}`);
			process.exit(2);
	}

	if (options.verbose) {
		console.log(`Options: ${JSON.stringify(options, null, 2)}`);
	}
}
