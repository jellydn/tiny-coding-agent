import { buildRegistry, runHooks } from "../hooks/manager.js";
import type { HookConfig } from "../hooks/types.js";
import type { Message } from "../providers/types.js";
import { bashTool } from "../tools/bash-tool.js";
import { fileTools } from "../tools/file-tools.js";
import { ToolRegistry } from "../tools/registry.js";
import { createAgentClient } from "./agent-client.js";
import { type Step as GrammarStep, type Plan, parse as parsePlanGrammar } from "./plan-grammar.js";
import { StateManager } from "./state-manager.js";
import { StepExecutor } from "./step-executor.js";

export interface BuildAgentOptions {
	stateFilePath?: string;
	dryRun?: boolean;
	verbose?: boolean;
	hooks?: HookConfig[];
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
	// Index flat steps by (number, text) so the per-line lookup below is O(1)
	// instead of an O(M) Array.find inside the loop. Keying on the same pair
	// the original predicate used preserves the exact match semantics: a
	// grammar step with the same number but different text will NOT match, so
	// the description correctly falls back to the line text. The `\0` separator
	// is safe because `text` comes from `.trim()` of a non-greedy `.+?` regex
	// match that doesn't span lines — `\0` can't appear in any key.
	const stepByKey = new Map<string, GrammarStep>();
	for (const s of flatSteps) {
		const key = `${s.number}\0${s.text}`;
		if (!stepByKey.has(key)) stepByKey.set(key, s);
	}
	let currentBuild: BuildStep | null = null;

	for (const line of lines) {
		const stepMatch = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
		if (stepMatch) {
			const n = parseInt(stepMatch[1] ?? "0", 10);
			const text = (stepMatch[2] ?? "").trim();
			const grammarStep = stepByKey.get(`${n}\0${text}`);
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

		const steps = parsePlanToSteps(effectivePlanContent);

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
