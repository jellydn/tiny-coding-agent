import { buildRegistry, runHooks } from "../hooks/manager.js";
import type { HookConfig } from "../hooks/types.js";
import type { Message } from "../providers/types.js";
import { bashTool } from "../tools/bash-tool.js";
import { fileTools } from "../tools/file-tools.js";
import { ToolRegistry } from "../tools/registry.js";
import { createAgentClient } from "./agent-client.js";
import type { BuildAction, BuildStep } from "./plan-converter.js";
import { parsePlanToSteps as parseSteps } from "./plan-converter.js";
import { DEFAULT_STATE_FILE } from "./state.js";
import { StateManager } from "./state-manager.js";
import { StepExecutor } from "./step-executor.js";

// Re-export types and functions from plan-converter.ts for backward compatibility.
export type { BuildAction, BuildStep } from "./plan-converter.js";
export { parsePlanToSteps } from "./plan-converter.js";

export interface BuildAgentOptions {
	stateFilePath?: string;
	dryRun?: boolean;
	verbose?: boolean;
	hooks?: HookConfig[];
}

export interface BuildAgentResult {
	success: boolean;
	error?: string;
	steps?: BuildStep[];
}

const BUILD_SYSTEM_PROMPT = `You are a build executor. Your task is to parse a plan and execute the steps to implement the solution.

For each step in the plan:
1. Parse the step description to understand what needs to be done
2. Identify the specific file operations needed (create, modify, delete)
3. Determine if the operation requires user confirmation
4. Execute the operations in sequence
5. Update the state file after each step

IMPORTANT: Always ask for user confirmation before:
- Creating new files
- Deleting existing files
- Making changes that affect more than 50 lines
- Adding or modifying dependencies (package.json changes)

When executing:
- Use the write_file tool to create new files
- Use the edit_file tool to modify existing files
- Use the bash tool to run commands when needed
- Update the state file after each successful operation

If an error occurs:
1. Log the error to the state file
2. Ask the user if they want to retry, skip the step, or abort

For dry-run mode:
- Show what would be done without actually doing it
- Do not modify any files
- Do not update the state file`;

// Re-export mapBuildAction and MappedBuildAction from step-executor.ts for
// backward compatibility. The canonical home is now step-executor.ts
// (extracted to break the build-agent.ts ↔ step-executor.ts runtime cycle).
export { type MappedBuildAction, mapBuildAction, type ToolCall } from "./step-executor.js";

function convertStepsToBuildResult(steps: BuildStep[]) {
	return {
		steps: steps.map((s) => ({
			stepNumber: s.stepNumber,
			description: s.description,
			status: s.status || "pending",
			changes: s.changes,
		})),
	};
}

function createBuildRegistry(): ToolRegistry {
	const registry = new ToolRegistry();
	registry.registerMany(fileTools);
	registry.register(bashTool);
	return registry;
}

export async function buildAgent(planContent: string, options?: BuildAgentOptions): Promise<BuildAgentResult> {
	const stateFilePath = options?.stateFilePath || DEFAULT_STATE_FILE;
	const dryRun = options?.dryRun ?? false;
	const verbose = options?.verbose ?? false;

	if (verbose) {
		console.log("Starting build agent...");
		console.log(`Dry run: ${dryRun}`);
		console.log(`State file: ${stateFilePath}`);
	}

	const registry = createBuildRegistry();
	registry.setDryRun(dryRun);

	try {
		const mgr = new StateManager(stateFilePath);
		const _state = await mgr.loadOrCreate();
		mgr.updatePhase("build", "in_progress");
		await mgr.save();

		if (!planContent || planContent.trim().length === 0) {
			const error = "No plan content provided";
			await mgr.saveWithError("build", error);

			return {
				success: false,
				error,
			};
		}

		console.log("\n🚀 Starting build execution...");

		// --- Hook: pre-build-execute ---
		// Run lifecycle hooks (e.g. plannotator) that may modify or reject the plan
		// before execution begins. The plan content may be replaced if the hook
		// returns modified content.
		let effectivePlanContent = planContent;
		if (options?.hooks && options.hooks.length > 0) {
			const registry = buildRegistry(options.hooks);
			const hookResult = await runHooks(registry, "pre-build-execute", {
				event: "pre-build-execute",
				content: planContent,
				stateFile: stateFilePath,
			});

			if (hookResult.modifiedContent) {
				effectivePlanContent = hookResult.modifiedContent;
				console.log(`✓ Plan modified by hook (${effectivePlanContent.length} characters)`);
			}

			if (hookResult.feedback) {
				console.log(`\n📋 Hook feedback:\n${hookResult.feedback}\n`);
			}

			if (hookResult.approved === false) {
				console.log("\n✗ Build rejected by reviewer. Aborting.");
				return {
					success: false,
					error: "Build rejected by hook reviewer",
				};
			}
		}

		const steps = parseSteps(effectivePlanContent);

		if (verbose) {
			console.log(`Found ${steps.length} steps to execute`);
		}
		const stepExecutor = new StepExecutor(registry);
		const executedSteps: BuildStep[] = [];

		for (const step of steps) {
			console.log(`\n--- Step ${step.stepNumber}: ${step.description} ---`);

			mgr.setCurrentTask({
				stepNumber: step.stepNumber,
				description: step.description,
				phase: "build",
			});
			if (!dryRun) {
				await mgr.save();
			}

			const stepResult = await stepExecutor.executeStep(step);

			// Log step errors to state file (the executor handles the prompt + retry)
			if (stepResult.error) {
				mgr.addError("build", stepResult.error, { step: step.stepNumber });
			}

			if (stepResult.shouldAbort) {
				mgr.updatePhase("build", "failed");
				await mgr.save();

				return {
					success: false,
					error: `Build aborted at step ${step.stepNumber}`,
					steps: executedSteps,
				};
			}

			executedSteps.push({
				...step,
				status: stepResult.status,
				changes: stepResult.changes.length > 0 ? stepResult.changes : undefined,
			});

			mgr.mergeResult("build", convertStepsToBuildResult(executedSteps));

			if (!dryRun) {
				await mgr.save();
			}
		}

		mgr.updatePhase("build", "completed");
		mgr.clearCurrentTask();
		await mgr.save();

		console.log("\n✨ Build completed successfully!");

		return {
			success: true,
			steps: executedSteps,
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error";

		try {
			const mgr = new StateManager(stateFilePath);
			await mgr.loadOrCreate();
			await mgr.saveWithError("build", errorMessage);
		} catch {
			// Ignore state update errors
		}

		return {
			success: false,
			error: `Build failed: ${errorMessage}`,
		};
	}
}

export async function generateBuildActionsFromPlan(
	planContent: string,
	taskDescription: string,
	verbose?: boolean
): Promise<BuildAction[]> {
	const { client, modelName } = await createAgentClient();

	const prompt = `Based on the following implementation plan and task description, generate the specific file operations needed to build the solution.

## Task Description
${taskDescription}

## Implementation Plan
${planContent}

For each step in the plan, identify the specific file operations (create, modify, delete) needed. Return a JSON array of actions with this format:
[
  {
    "type": "create" | "modify" | "delete" | "execute",
    "path": "file path (required for create/modify/delete)",
    "content": "file content (required for create/modify)",
    "oldContent": "original content to replace (required for modify)",
    "description": "description of what this action does"
  }
]

Only include actions that are explicitly mentioned in the plan. If a step requires user confirmation (file creation, deletion, large refactors, dependency changes), mark it with a comment.`;

	const messages: Message[] = [
		{ role: "system", content: BUILD_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	try {
		const response = await client.chat({
			model: modelName,
			messages,
			temperature: 0.2,
			maxTokens: 8192,
		});

		const content = response.content;

		if (verbose) {
			console.log(`Build actions generated (${content.length} characters)`);
		}

		try {
			const jsonMatch = content.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const parsedActions = JSON.parse(jsonMatch[0]) as unknown;
				if (Array.isArray(parsedActions)) {
					return parsedActions as BuildAction[];
				}
			}
		} catch {
			if (verbose) {
				console.log("Could not parse actions as JSON, returning empty list");
			}
		}

		return [];
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error";
		if (verbose) {
			console.error(`Failed to generate build actions: ${errorMessage}`);
		}
		return [];
	}
}
