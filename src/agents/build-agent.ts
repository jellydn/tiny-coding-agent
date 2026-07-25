import { loadConfig } from "../config/loader.js";
import { createProvider, parseModelString } from "../providers/factory.js";
import type { Message } from "../providers/types.js";
import { bashTool } from "../tools/bash-tool.js";
import { fileTools } from "../tools/file-tools.js";
import { ToolRegistry } from "../tools/registry.js";
import { type Step as GrammarStep, type Plan, parse as parsePlanGrammar } from "./plan-grammar.js";
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

interface ToolCall {
	name: string;
	args: Record<string, unknown>;
}

type ExecutionOutcome = { success: boolean; output?: string; error?: string };

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

/**
 * Map a build-time intent (BuildAction) into a registry-shaped ToolCall.
 *
 * Returns `null` for actions whose `path` is missing — build-agent treats those
 * as errors at execution time. Confirmation is handled by the registry, not
 * here; the registry routes dangerous ops through the CLI's confirmation
 * handler with the right danger level (write/edit/delete/bash-destructive).
 */
function buildActionToToolCall(action: BuildAction): ToolCall | null {
	switch (action.type) {
		case "create": {
			if (!action.path) return null;
			return {
				name: "write_file",
				args: { path: action.path, content: action.content ?? "" },
			};
		}
		case "modify": {
			if (!action.path) return null;
			if (action.oldContent && action.content) {
				return {
					name: "edit_file",
					args: {
						path: action.path,
						old_str: action.oldContent,
						new_str: action.content,
					},
				};
			}
			if (action.content) {
				return {
					name: "write_file",
					args: { path: action.path, content: action.content },
				};
			}
			return null;
		}
		case "delete": {
			if (!action.path) return null;
			return { name: "delete_file", args: { path: action.path } };
		}
		case "execute": {
			return { name: "bash", args: { command: action.description } };
		}
	}
}

/**
 * Tiny readline-based prompt for retry/skip/abort decisions after a failed action.
 *
 * This is intentionally NOT a parallel confirmation funnel — it's a recovery
 * decision only. Dangerous-op confirmation lives entirely in ToolRegistry via
 * confirmation.ts. Maintained in build-agent because the recovery path is
 * unique to build-time execution flow.
 */
async function promptRecoveryDecision(prompt: string, options: string[]): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		rl.question(`${prompt}\nOptions: ${options.join(", ")}: `, (answer) => {
			rl.close();
			const normalized = answer.toLowerCase().trim();
			const matched = options.find((option) => option.toLowerCase() === normalized);
			resolve(matched ?? options[0] ?? "y");
		});
	});
}

async function handleExecutionError(
	error: string,
	stepNumber: number,
	stateFilePath: string,
	state: StateFile
): Promise<ExecutionDecision> {
	console.error(`\n❌ Error in step ${stepNumber}: ${error}`);

	const decision = await promptRecoveryDecision(`\nWhat would you like to do?`, ["retry", "skip", "abort"]);

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

/**
 * Convert a Plan returned by `PlanGrammar.parse` into the build-agent's
 * `BuildStep[]` shape.
 *
 * Two shapes, picked automatically:
 * - Phase-form: each Phase -> one BuildStep with multiple actions (one per
 *   Step within the phase). Detected by the presence of a `## Phase ...`
 *   marker in the raw text — the AST shape alone is ambiguous (a real
 *   single-phase plan with sequentially-numbered sub-steps also produces
 *   one phase with steps 1, 2, 3).
 * - Flat-form (no phase headers, steps numbered 1, 2, 3, ... at top
 *   level): each Step -> its own BuildStep.
 *
 * Legacy quirk: build-agent previously parsed sub-bullet `- text` lines
 * under a numbered flat-form step as additional actions. The grammar
 * doesn't include this shape, so we re-scan the raw text for those sub-
 * bullets in flat-form mode to preserve backward compatibility.
 */
function planToBuildSteps(plan: Plan, rawText: string): BuildStep[] {
	if (plan.phases.length === 0) {
		return [];
	}

	const hasPhaseHeaders = /^\s*##\s*(?:Phase\s+)?\d+/m.test(rawText);

	if (!hasPhaseHeaders) {
		const flatPhase = plan.phases[0];
		if (flatPhase) {
			return buildFlatFormSteps(rawText, flatPhase.steps);
		}
	}

	return plan.phases.map((phase) => ({
		stepNumber: phase.number,
		description: phase.title,
		actions: phase.steps.map((step) => ({
			type: "execute" as const,
			description: step.text,
		})),
	}));
}

function buildFlatFormSteps(rawText: string, flatSteps: GrammarStep[]): BuildStep[] {
	const result: BuildStep[] = [];
	const lines = rawText.split("\n");
	let currentBuild: BuildStep | null = null;

	for (const line of lines) {
		const stepMatch = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
		if (stepMatch) {
			const n = parseInt(stepMatch[1] ?? "0", 10);
			const text = (stepMatch[2] ?? "").trim();
			const grammarStep = flatSteps.find((s) => s.number === n && s.text === text);
			currentBuild = {
				stepNumber: n,
				description: grammarStep?.text ?? text,
				actions: [{ type: "execute", description: text }],
			};
			result.push(currentBuild);
			continue;
		}

		const bulletMatch = line.match(/^\s*-\s+(.+?)\s*$/);
		if (bulletMatch && currentBuild) {
			const text = (bulletMatch[1] ?? "").trim();
			if (text && !text.startsWith("**")) {
				currentBuild.actions.push({ type: "execute", description: text });
			}
		}
	}

	return result;
}

export function parsePlanToSteps(planContent: string): BuildStep[] {
	const plan = parsePlanGrammar(planContent);
	return planToBuildSteps(plan, planContent);
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

function unmappableActionError(action: BuildAction): string {
	switch (action.type) {
		case "create":
			return "create action requires a path";
		case "modify":
			if (!action.path) return "modify action requires a path";
			return "modify action requires both oldContent and content, or just content";
		case "delete":
			return "delete action requires a path";
		case "execute":
			return "execute action requires a description (interpreted as the bash command)";
	}
}

function createBuildRegistry(): ToolRegistry {
	const registry = new ToolRegistry();
	registry.registerMany(fileTools);
	registry.register(bashTool);
	return registry;
}

export async function buildAgent(planContent: string, options?: BuildAgentOptions): Promise<BuildAgentResult> {
	const stateFilePath = options?.stateFilePath || ".tiny-state.json";
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

			state.currentTask = {
				stepNumber: step.stepNumber,
				description: step.description,
				startedAt: new Date().toISOString(),
				phase: "build",
			};
			if (!dryRun) {
				await writeStateFile(stateFilePath, state);
			}

			const stepChanges: Array<{
				type: "create" | "modify" | "delete";
				path: string;
				diff?: string;
			}> = [];

			let stepSuccess = true;

			for (const action of step.actions) {
				let executionResult: ExecutionOutcome;

				const call = buildActionToToolCall(action);
				if (!call) {
					const error = unmappableActionError(action);
					executionResult = { success: false, error };
				} else {
					// Confirmation for dangerous ops (create/modify/delete/destructive-bash)
					// is handled inside registry.execute via the CLI's confirmation handler.
					executionResult = await registry.execute(call.name, call.args);
				}

				if (executionResult.success) {
					console.log(`  ✓ ${action.description}`);

					const actionPath = action.path;
					if (actionPath && (action.type === "create" || action.type === "modify" || action.type === "delete")) {
						stepChanges.push({
							type: action.type as "create" | "modify" | "delete",
							path: actionPath,
						});
					}
				} else {
					console.error(`  ✗ ${action.description}: ${executionResult.error}`);
					stepSuccess = false;

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

					if (decision.action === "retry" && call) {
						console.log(`  Retrying step ${step.stepNumber}...`);
						const retryResult = await registry.execute(call.name, call.args);
						if (retryResult.success) {
							console.log(`  ✓ ${action.description} (retry successful)`);
							const actionPath = action.path;
							if (actionPath && (action.type === "create" || action.type === "modify" || action.type === "delete")) {
								stepChanges.push({
									type: action.type as "create" | "modify" | "delete",
									path: actionPath,
								});
							}
							stepSuccess = true;
						} else {
							stepSuccess = false;
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
		state.currentTask = undefined;
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
	const modelString = config.defaultModel;
	const { model: modelName } = parseModelString(modelString);
	const client = createProvider({
		model: modelString,
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
