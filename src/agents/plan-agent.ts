import { prompt } from "../cli/prompt.js";
import { buildRegistry, runHooks } from "../hooks/manager.js";
import type { HookConfig } from "../hooks/types.js";
import type { Message } from "../providers/types.js";
import { createAgentClient } from "./agent-client.js";
import { CodebaseExplorer } from "./codebase-explorer.js";
import { exampleOutput } from "./plan-grammar.js";
import { DEFAULT_STATE_FILE } from "./state.js";
import { StateManager } from "./state-manager.js";

export interface PlanAgentOptions {
	stateFilePath?: string;
	generatePrd?: boolean;
	verbose?: boolean;
	hooks?: HookConfig[];
}

export interface PlanResult {
	success: boolean;
	error?: string;
	plan?: string;
	prd?: string;
}

const PLAN_SYSTEM_PROMPT = `You are an expert software architect. Your task is to analyze a coding task and create a detailed implementation plan.

For each task, you should:
1. Understand the codebase structure by exploring relevant files
2. Break down the task into logical phases
3. For each phase, define:
   - A clear title and description
   - Specific steps to complete
   - Dependencies on other phases
   - Success criteria to verify completion
4. Identify potential risks or considerations

Output your plan as structured markdown in the canonical PlanGrammar format. Canonical example:

${exampleOutput()}

When exploring the codebase:
- Use glob to find relevant files (e.g., **/*.ts, **/*.json)
- Use grep to find specific patterns (e.g., function definitions, imports)
- Read file contents to understand the structure

IMPORTANT: If this plan involves major architectural decisions (new patterns, significant refactoring, dependency changes), explicitly note this for user confirmation.`;

const PRD_SYSTEM_PROMPT = `You are a senior product manager. Based on the implementation plan, create a comprehensive Product Requirements Document (PRD).

Output in YAML format with the following structure:

project: [Project Name]
description: [Brief description]
userStories:
  - id: [Story ID, e.g., US-001]
    title: [Story Title]
    description: As a [user], I want [action] so that [benefit].
    acceptanceCriteria:
      - [Criterion 1]
      - [Criterion 2]
    priority: [1-9]
    passes: false
    notes: [Any notes]

Include only user-facing stories that deliver concrete value. Group related stories into milestones if appropriate.`;

/** Explore the codebase using the shared CodebaseExplorer module.
 *  Replaces the stale inline exploreCodebase() that had its own ToolRegistry
 *  and duplicated the exploration logic already extracted into CodebaseExplorer. */
async function exploreCodebase(): Promise<string> {
	const explorer = new CodebaseExplorer();
	const { report } = await explorer.exploreDeep(".");
	return report;
}

function createPlanMessages(taskDescription: string, codebaseContext: string, generatePrd: boolean): Message[] {
	const systemPrompt = generatePrd ? PRD_SYSTEM_PROMPT : PLAN_SYSTEM_PROMPT;
	const userContent = `## Task Description
${taskDescription}

## Codebase Context
${codebaseContext}

${generatePrd ? "Generate a comprehensive PRD based on the implementation plan." : "Create a detailed implementation plan for this task."}`;

	return [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userContent },
	];
}

export async function planAgent(taskDescription: string, options?: PlanAgentOptions): Promise<PlanResult> {
	const stateFilePath = options?.stateFilePath || DEFAULT_STATE_FILE;
	const generatePrd = options?.generatePrd || false;
	const verbose = options?.verbose || false;

	if (verbose) {
		console.log("Starting plan agent...");
		console.log(`Task: ${taskDescription}`);
		console.log(`State file: ${stateFilePath}`);
		console.log(`Generate PRD: ${generatePrd}`);
	}

	try {
		console.log("📂 Exploring codebase context...");
		const codebaseContext = await exploreCodebase();
		console.log("✓ Codebase exploration complete");

		const { client, modelName } = await createAgentClient();

		console.log(`🤖 Generating plan with ${modelName}...`);
		const messages = createPlanMessages(taskDescription, codebaseContext, generatePrd);

		const response = await client.chat({
			model: modelName,
			messages,
			temperature: 0.3,
			maxTokens: 8192,
		});

		let plan = response.content;
		console.log(`✓ Plan generated (${plan.length} characters)`);

		// --- Hook: post-plan-generate ---
		// Run lifecycle hooks (e.g. plannotator) that may modify or reject the plan.
		if (options?.hooks && options.hooks.length > 0) {
			const registry = buildRegistry(options.hooks);
			const hookResult = await runHooks(registry, "post-plan-generate", {
				event: "post-plan-generate",
				content: plan,
				taskDescription,
				stateFile: stateFilePath,
			});

			if (hookResult.modifiedContent) {
				plan = hookResult.modifiedContent;
				console.log(`✓ Plan modified by hook (${plan.length} characters)`);
			}

			if (hookResult.feedback) {
				console.log(`\n📋 Hook feedback:\n${hookResult.feedback}\n`);
			}

			if (hookResult.approved === false) {
				console.log("\n✗ Plan rejected by reviewer. Aborting.");
				return {
					success: false,
					error: "Plan rejected by hook reviewer",
				};
			}
		}

		let prd: string | undefined;
		if (generatePrd) {
			prd = plan;
		}

		if (options?.stateFilePath) {
			const mgr = new StateManager(stateFilePath, {
				parameters: { generatePrd: String(generatePrd) },
			});
			await mgr.loadOrCreate(taskDescription);
			mgr.updatePhase("plan", "completed");
			mgr.setPlan(plan);

			try {
				await mgr.saveOrThrow();
			} catch (err) {
				return {
					success: false,
					error: (err as Error).message,
				};
			}

			if (verbose) {
				console.log(`State file updated: ${stateFilePath}`);
			}
		}

		return {
			success: true,
			plan,
			prd,
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error";
		return {
			success: false,
			error: `Plan generation failed: ${errorMessage}`,
		};
	}
}

export async function confirmMajorDecision(decision: string): Promise<boolean> {
	const answer = await prompt(
		`⚠️  Major architectural decision detected:\n\n${decision}\n\nDo you want to proceed? (y/n): `
	);
	return answer.toLowerCase().startsWith("y");
}
