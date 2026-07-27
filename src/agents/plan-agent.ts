import { prompt } from "../cli/prompt.js";
import { loadConfig } from "../config/loader.js";
import { createProvider, parseModelString } from "../providers/factory.js";
import type { Message } from "../providers/types.js";
import { CodebaseExplorer } from "./codebase-explorer.js";
import { exampleOutput } from "./plan-grammar.js";
import { readStateFile, writeStateFile } from "./state.js";
import type { StateFile } from "./types.js";

export interface PlanAgentOptions {
	stateFilePath?: string;
	generatePrd?: boolean;
	verbose?: boolean;
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
	const stateFilePath = options?.stateFilePath || ".tiny-state.json";
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

		const config = loadConfig();
		const modelString = config.defaultModel;
		const { model: modelName } = parseModelString(modelString);

		console.log(`🤖 Generating plan with ${modelName}...`);
		const client = createProvider({
			model: modelString,
			provider: undefined,
			providers: config.providers,
		});
		const messages = createPlanMessages(taskDescription, codebaseContext, generatePrd);

		const response = await client.chat({
			model: modelName,
			messages,
			temperature: 0.3,
			maxTokens: 8192,
		});

		const plan = response.content;
		console.log(`✓ Plan generated (${plan.length} characters)`);

		let prd: string | undefined;
		if (generatePrd) {
			prd = plan;
		}

		if (options?.stateFilePath) {
			const existingState = await readStateFile(stateFilePath, { ignoreMissing: true });

			const state: StateFile = existingState.success
				? {
						...existingState.data!,
						phase: "plan",
						status: "completed",
						results: {
							...existingState.data!.results,
							plan: { plan },
						},
						errors: existingState.data!.errors,
					}
				: {
						metadata: {
							agentName: "tiny-agent",
							agentVersion: "1.0.0",
							invocationTimestamp: new Date().toISOString(),
							parameters: {
								generatePrd: String(generatePrd),
							},
						},
						phase: "plan",
						taskDescription,
						status: "completed",
						results: {
							plan: { plan },
						},
						errors: [],
						artifacts: [],
					};

			const writeResult = await writeStateFile(stateFilePath, state);
			if (!writeResult.success) {
				return {
					success: false,
					error: `Failed to write state file: ${writeResult.error}`,
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
