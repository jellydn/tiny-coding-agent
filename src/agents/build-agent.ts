import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadConfig } from "../config/loader.js";
import { createProvider } from "../providers/factory.js";
import type { Message } from "../providers/types.js";
import { findGitignorePatterns, isIgnored } from "../tools/gitignore.js";
import { fileTools, ToolRegistry } from "../tools/index.js";
import { readStateFile, writeStateFile } from "./state.js";
import type { StateFile } from "./types.js";

export interface BuildAgentOptions {
	stateFilePath?: string;
	dryRun?: boolean;
	verbose?: boolean;
}

export interface BuildStep {
	stepNumber: number;
	description: string;
	actions: BuildAction[];
	status?: "pending" | "completed" | "failed" | "skipped";
	changes?: Array<{
		type: "create" | "modify" | "delete";
		path: string;
		diff?: string;
	}>;
	confirmed?: boolean;
}

export interface BuildAction {
	type: "create" | "modify" | "delete" | "execute";
	path?: string;
	content?: string;
	oldContent?: string;
	description: string;
}

export interface BuildAgentResult {
	success: boolean;
	error?: string;
	steps?: BuildStep[];
}

interface ExecutionDecision {
	action: "retry" | "skip" | "abort";
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

async function confirmAction(prompt: string, options: string[]): Promise<string> {
	const readline = await import("node:readline");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(`${prompt}\nOptions: ${options.join(", ")}: `, (answer) => {
			rl.close();
			const normalized = answer.toLowerCase().trim();
			let matchedOption: string = options[0] ?? "y";
			for (const option of options) {
				if (option.toLowerCase() === normalized) {
					matchedOption = option;
					break;
				}
			}
			resolve(matchedOption);
		});
	});
}

async function confirmBuildAction(action: BuildAction, stepNumber: number): Promise<boolean> {
	let prompt = "";
	let requiresConfirmation = false;

	switch (action.type) {
		case "create": {
			prompt = `\n⚠️  Step ${stepNumber}: Create new file\n  Path: ${action.path ?? "unknown"}\n  Description: ${action.description}`;
			requiresConfirmation = true;
			break;
		}
		case "delete": {
			prompt = `\n⚠️  Step ${stepNumber}: Delete file\n  Path: ${action.path ?? "unknown"}\n  Description: ${action.description}`;
			requiresConfirmation = true;
			break;
		}
		case "modify": {
			if (action.oldContent && action.content) {
				const lineDiff = action.content.split("\n").length - action.oldContent.split("\n").length;
				if (Math.abs(lineDiff) > 50) {
					prompt = `\n⚠️  Step ${stepNumber}: Large refactor (${Math.abs(lineDiff)} lines changed)\n  Path: ${action.path ?? "unknown"}\n  Description: ${action.description}`;
					requiresConfirmation = true;
				}
			}
			break;
		}
		case "execute": {
			prompt = `\n⚠️  Step ${stepNumber}: Execute command\n  Command: ${action.description}`;
			requiresConfirmation = true;
			break;
		}
	}

	if (!requiresConfirmation) {
		return true;
	}

	const answer = await confirmAction(prompt, ["y", "n"]);
	return answer.toLowerCase() === "y";
}

async function checkGitignore(filePath: string): Promise<boolean> {
	try {
		const gitignorePatterns = await findGitignorePatterns(filePath);
		if (gitignorePatterns.length === 0) {
			return false;
		}
		return isIgnored(filePath, gitignorePatterns, false);
	} catch {
		return false;
	}
}

async function executeBuildAction(
	action: BuildAction,
	registry: ToolRegistry,
	dryRun: boolean
): Promise<{ success: boolean; output?: string; error?: string }> {
	if (dryRun) {
		return {
			success: true,
			output: `[DRY-RUN] Would execute: ${action.type} - ${action.description}`,
		};
	}
	{
		const actionType = action.type;
		switch (actionType) {
			case "create": {
				const createPath: string = action.path ?? "";
				if (!createPath) {
					return { success: false, error: "Create action requires path" };
				}

				const isPathIgnored = await checkGitignore(createPath);
				if (isPathIgnored) {
					return { success: false, error: `Path ${createPath} is ignored by .gitignore` };
				}

				const dir = path.dirname(createPath);
				await fs.mkdir(dir, { recursive: true });
				await fs.writeFile(createPath, action.content || "", "utf-8");
				return { success: true, output: `Created ${createPath}` };
			}
			case "modify": {
				const modifyPath: string = action.path ?? "";
				if (!modifyPath) {
					return { success: false, error: "Modify action requires path" };
				}

				const readResult = await registry.execute("read_file", { path: modifyPath });
				if (!readResult.success) {
					return { success: false, error: `Failed to read file for modification: ${readResult.error}` };
				}

				if (action.oldContent && action.content) {
					const editResult = await registry.execute("edit_file", {
						path: modifyPath,
						old_str: action.oldContent,
						new_str: action.content,
					});
					return editResult;
				} else if (action.content) {
					const writeResult = await registry.execute("write_file", {
						path: modifyPath,
						content: action.content,
					});
					return writeResult;
				}
				return { success: false, error: "Modify action requires oldContent or content" };
			}
			case "delete": {
				const deletePath: string = action.path ?? "";
				if (!deletePath) {
					return { success: false, error: "Delete action requires path" };
				}

				try {
					await fs.unlink(deletePath);
					return { success: true, output: `Deleted ${deletePath}` };
				} catch (err) {
					return { success: false, error: `Failed to delete ${deletePath}: ${(err as Error).message}` };
				}
			}
			case "execute": {
				const bashToolModule = await import("../tools/bash-tool.js");
				const bashTool = bashToolModule.bashTool;
				const result = await bashTool.execute({ command: action.description });
				return result;
			}
		}
	}

	return { success: false, error: `Unknown action type: ${action.type}` };
}

async function handleExecutionError(
	error: string,
	stepNumber: number,
	stateFilePath: string,
	state: StateFile
): Promise<ExecutionDecision> {
	console.error(`\n❌ Error in step ${stepNumber}: ${error}`);

	const decision = await confirmAction(`\nWhat would you like to do?`, ["retry", "skip", "abort"]);

	const stateError = {
		timestamp: new Date().toISOString(),
		phase: "build" as const,
		message: error,
		details: { step: stepNumber },
	};

	state.errors = [...state.errors, stateError];
	await writeStateFile(stateFilePath, state);

	return { action: decision.toLowerCase() as "retry" | "skip" | "abort" };
}

export function parsePlanToSteps(planContent: string): BuildStep[] {
	const steps: BuildStep[] = [];
	const phaseRegex = /## Phase (\d+)[:\s]+([^\n]+)/g;
	let match: RegExpExecArray | null;

	while ((match = phaseRegex.exec(planContent)) !== null) {
		const stepNumberStr = match[1];
		const descriptionStr = match[2];
		if (!stepNumberStr || !descriptionStr) continue;

		const stepNumber = parseInt(stepNumberStr, 10);
		const description = descriptionStr.trim();

		const stepsRegex = /(?:^|\n)(\d+)\.\s+([^\n]+)/g;
		const actions: BuildAction[] = [];

		let actionMatch: RegExpExecArray | null;
		while ((actionMatch = stepsRegex.exec(planContent)) !== null) {
			const actionNumStr = actionMatch[1];
			const actionDescStr = actionMatch[2];
			if (!actionNumStr || !actionDescStr) continue;

			if (parseInt(actionNumStr, 10) === stepNumber) {
				actions.push({
					type: "execute",
					description: actionDescStr.trim(),
				});
			}
		}

		steps.push({
			stepNumber,
			description,
			actions,
		});
	}

	if (steps.length === 0) {
		const lines = planContent.split("\n");
		let currentStep: BuildStep | null = null;

		for (const line of lines) {
			const stepMatch = line.match(/^(\d+)\.\s+(.+)$/);
			if (stepMatch) {
				const stepNumStr = stepMatch[1];
				const stepDescStr = stepMatch[2];
				if (!stepNumStr || !stepDescStr) continue;

				if (currentStep) {
					steps.push(currentStep);
				}
				currentStep = {
					stepNumber: parseInt(stepNumStr, 10),
					description: stepDescStr,
					actions: [
						{
							type: "execute",
							description: stepDescStr.trim(),
						},
					],
				};
			} else if (currentStep && line.trim().startsWith("-")) {
				currentStep.actions.push({
					type: "execute",
					description: line.trim().substring(1).trim(),
				});
			}
		}

		if (currentStep) {
			steps.push(currentStep);
		}
	}

	return steps;
}

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

export async function buildAgent(planContent: string, options?: BuildAgentOptions): Promise<BuildAgentResult> {
	const stateFilePath = options?.stateFilePath || ".tiny-state.json";
	const dryRun = options?.dryRun || false;
	const verbose = options?.verbose || false;

	if (verbose) {
		console.log("Starting build agent...");
		console.log(`Dry run: ${dryRun}`);
		console.log(`State file: ${stateFilePath}`);
	}

	const registry = new ToolRegistry();
	registry.registerMany(fileTools);

	try {
		const stateResult = await readStateFile(stateFilePath, { ignoreMissing: true });
		let state: StateFile;

		if (stateResult.success) {
			state = stateResult.data!;
		} else {
			state = {
				metadata: {
					agentName: "tiny-agent",
					agentVersion: "1.0.0",
					invocationTimestamp: new Date().toISOString(),
					parameters: {},
				},
				phase: "build",
				taskDescription: "",
				status: "in_progress",
				results: {},
				errors: [],
				artifacts: [],
			};
		}

		state.phase = "build";
		state.status = "in_progress";

		await writeStateFile(stateFilePath, state);

		if (!planContent || planContent.trim().length === 0) {
			const error = "No plan content provided";
			state.errors = [
				...state.errors,
				{
					timestamp: new Date().toISOString(),
					phase: "build",
					message: error,
				},
			];
			state.status = "failed";
			await writeStateFile(stateFilePath, state);

			return {
				success: false,
				error,
			};
		}

		console.log("\n🚀 Starting build execution...");

		const steps = parsePlanToSteps(planContent);

		if (verbose) {
			console.log(`Found ${steps.length} steps to execute`);
		}

		const executedSteps: BuildStep[] = [];

		for (const step of steps) {
			console.log(`\n--- Step ${step.stepNumber}: ${step.description} ---`);

			const stepChanges: Array<{
				type: "create" | "modify" | "delete";
				path: string;
				diff?: string;
			}> = [];

			let stepSuccess = true;
			let _stepError: string | undefined;

			for (const action of step.actions) {
				let confirmed = false;
				let executionResult: { success: boolean; output?: string; error?: string };

				if (dryRun) {
					confirmed = true;
					executionResult = await executeBuildAction(action, registry, true);
				} else {
					confirmed = await confirmBuildAction(action, step.stepNumber);
					if (confirmed) {
						executionResult = await executeBuildAction(action, registry, false);
					} else {
						executionResult = { success: false, error: "User declined confirmation" };
					}
				}

				if (executionResult.success) {
					console.log(`  ✓ ${action.description}`);

					const actionPath = action.path;
					if (actionPath) {
						stepChanges.push({
							type: action.type as "create" | "modify" | "delete",
							path: actionPath,
						});
					}
				} else {
					console.error(`  ✗ ${action.description}: ${executionResult.error}`);
					stepSuccess = false;
					_stepError = executionResult.error;

					const decision = await handleExecutionError(
						executionResult.error || "Unknown error",
						step.stepNumber,
						stateFilePath,
						state
					);

					if (decision.action === "abort") {
						state.status = "failed";
						await writeStateFile(stateFilePath, state);

						return {
							success: false,
							error: `Build aborted at step ${step.stepNumber}`,
							steps: executedSteps,
						};
					}

					if (decision.action === "skip") {
						console.log(`  Skipping step ${step.stepNumber}`);
						executedSteps.push({
							...step,
							status: "skipped",
						});
						break;
					}

					if (decision.action === "retry") {
						console.log(`  Retrying step ${step.stepNumber}...`);
						const retryResult = await executeBuildAction(action, registry, dryRun);
						if (retryResult.success) {
							console.log(`  ✓ ${action.description} (retry successful)`);
							const actionPath = action.path;
							if (actionPath) {
								stepChanges.push({
									type: action.type as "create" | "modify" | "delete",
									path: actionPath,
								});
							}
							stepSuccess = true;
							_stepError = undefined;
						} else {
							stepSuccess = false;
							_stepError = retryResult.error;
						}
					}
				}
			}

			executedSteps.push({
				...step,
				status: stepSuccess ? "completed" : "failed",
				changes: stepChanges.length > 0 ? stepChanges : undefined,
			});

			state.results.build = convertStepsToBuildResult(executedSteps);

			if (!dryRun) {
				await writeStateFile(stateFilePath, state);
			}
		}

		state.status = "completed";
		await writeStateFile(stateFilePath, state);

		console.log("\n✨ Build completed successfully!");

		return {
			success: true,
			steps: executedSteps,
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error";

		try {
			const stateResult = await readStateFile(stateFilePath, { ignoreMissing: true });
			if (stateResult.success) {
				const state = stateResult.data!;
				state.status = "failed";
				state.errors = [
					...state.errors,
					{
						timestamp: new Date().toISOString(),
						phase: "build",
						message: errorMessage,
					},
				];
				await writeStateFile(stateFilePath, state);
			}
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
	const config = loadConfig();
	const model = config.defaultModel;
	const client = createProvider({
		model,
		provider: undefined,
		providers: config.providers,
	});

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
		const capabilities = await client.getCapabilities(model);
		const response = await client.chat({
			model: capabilities.modelName,
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
