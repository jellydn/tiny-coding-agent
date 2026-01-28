import { buildAgent } from "../../agents/build-agent.js";
import { exploreAgent } from "../../agents/explore-agent.js";
import { planAgent } from "../../agents/plan-agent.js";
import { readStateFile } from "../../agents/state.js";
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
			console.log(`Build command received`);
			console.log(`State file: ${stateFile}`);

			const stateResult = await readStateFile(stateFile, { ignoreMissing: true });
			if (!stateResult.success) {
				console.error(`Error: Could not read state file: ${stateResult.error}`);
				console.error("Please run 'tiny-agent plan' first to generate a plan.");
				process.exit(1);
			}

			const plan = stateResult.data?.results?.plan?.plan;
			if (!plan) {
				console.error("Error: No plan found in state file.");
				console.error("Please run 'tiny-agent plan' first to generate a plan.");
				process.exit(1);
			}

			const result = await buildAgent(plan, {
				stateFilePath: stateFile,
				dryRun: false,
				verbose: options.verbose,
			});

			if (!result.success) {
				console.error(`Error: ${result.error}`);
				process.exit(1);
			}

			console.log("\nBuild completed successfully!");
			console.log(`Results written to state file: ${stateFile}`);
			break;
		}
		case "explore": {
			const explorationTask = taskDescription || "Explore codebase structure";
			console.log(`Explore command received: ${explorationTask}`);
			console.log(`State file: ${stateFile}`);

			const result = await exploreAgent(explorationTask, {
				stateFilePath: stateFile,
				depth: "shallow",
				verbose: options.verbose,
			});

			if (!result.success) {
				console.error(`Error: ${result.error}`);
				process.exit(1);
			}

			console.log("\n=== Exploration Findings ===");
			console.log(result.findings);

			if (result.recommendations) {
				console.log("\n=== Recommendations ===");
				console.log(result.recommendations);
			}

			if (result.metrics) {
				console.log("\n=== Metrics ===");
				console.log(JSON.stringify(result.metrics, null, 2));
			}

			console.log("\nExploration results written to state file.");
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

			console.log("Phase 1/2: Running plan agent...");
			const planResult = await planAgent(taskDescription, {
				stateFilePath: stateFile,
				generatePrd: false,
				verbose: options.verbose,
			});

			if (!planResult.success) {
				console.error(`Plan failed: ${planResult.error}`);
				process.exit(1);
			}

			console.log("\nPhase 2/2: Running build agent...");
			const plan = planResult.plan;
			if (!plan) {
				console.error("Error: No plan generated.");
				process.exit(1);
			}

			const buildResult = await buildAgent(plan, {
				stateFilePath: stateFile,
				dryRun: false,
				verbose: options.verbose,
			});

			if (!buildResult.success) {
				console.error(`Build failed: ${buildResult.error}`);
				process.exit(1);
			}

			console.log("\n✨ run-plan-build completed successfully!");
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

			console.log("Phase 1/3: Running plan agent...");
			const planResult = await planAgent(taskDescription, {
				stateFilePath: stateFile,
				generatePrd: false,
				verbose: options.verbose,
			});

			if (!planResult.success) {
				console.error(`Plan failed: ${planResult.error}`);
				process.exit(1);
			}

			console.log("\nPhase 2/3: Running build agent...");
			const plan = planResult.plan;
			if (!plan) {
				console.error("Error: No plan generated.");
				process.exit(1);
			}

			const buildResult = await buildAgent(plan, {
				stateFilePath: stateFile,
				dryRun: false,
				verbose: options.verbose,
			});

			if (!buildResult.success) {
				console.error(`Build failed: ${buildResult.error}`);
				process.exit(1);
			}

			console.log("\nPhase 3/3: Running explore agent...");
			const exploreResult = await exploreAgent(taskDescription, {
				stateFilePath: stateFile,
				depth: "deep",
				verbose: options.verbose,
			});

			if (!exploreResult.success) {
				console.error(`Explore failed: ${exploreResult.error}`);
				process.exit(1);
			}

			console.log("\n✨ run-all completed successfully!");
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
