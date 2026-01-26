import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadConfig } from "../config/loader.js";
import { createProvider } from "../providers/factory.js";
import type { Message } from "../providers/types.js";
import { globTool, ToolRegistry } from "../tools/index.js";
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

Output your plan as structured markdown with the following format:

# Implementation Plan: [Task Title]

## Overview
[Brief summary of what will be built]

## Phase 1: [Phase Title]
**Dependencies:** None (or list phase numbers)
**Success Criteria:**
- [ ] [Criterion 1]
- [ ] [Criterion 2]

### Steps:
1. [Step description]
2. [Step description]

## Phase 2: [Phase Title]
**Dependencies:** Phase 1
**Success Criteria:**
- [ ] [Criterion 1]
- [ ] [Criterion 2]

### Steps:
1. [Step description]
2. [Step description]

## [Additional phases as needed...]

## Technical Considerations
- [Any architectural decisions or considerations]
- [Dependencies or libraries needed]
- [Testing strategy]

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

async function exploreCodebase(_taskDescription: string): Promise<string> {
	const explorationResults: string[] = [];
	const cwd = ".";

	const registry = new ToolRegistry();
	registry.register({
		name: "glob",
		description: globTool.description,
		parameters: globTool.parameters,
		execute: globTool.execute,
	});

	try {
		explorationResults.push("=== Project Structure ===");
		const globResult = await registry.execute("glob", { pattern: "**/*.ts", path: cwd });
		explorationResults.push(globResult.output ?? "");

		explorationResults.push("\n=== Package.json ===");
		try {
			const packageJsonContent = await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8");
			explorationResults.push(packageJsonContent);
		} catch {
			explorationResults.push("package.json not found");
		}

		explorationResults.push("\n=== TS Config ===");
		try {
			const tsconfigContent = await fs.readFile(path.join(process.cwd(), "tsconfig.json"), "utf-8");
			explorationResults.push(tsconfigContent);
		} catch {
			explorationResults.push("tsconfig.json not found");
		}

		explorationResults.push("\n=== Existing Agent Files ===");
		const agentFiles = await registry.execute("glob", { pattern: "src/agents/*.ts", path: cwd });
		explorationResults.push(agentFiles.output ?? "");

		explorationResults.push("\n=== Recent Code Changes ===");
		try {
			const gitLog = await fs.readFile(".git/COMMIT_EDITMSG", "utf-8").catch(() => "No recent commits");
			explorationResults.push(gitLog);
		} catch {
			explorationResults.push("Unable to read git history");
		}
	} catch (err) {
		explorationResults.push(`Exploration error: ${(err as Error).message}`);
	}

	return explorationResults.join("\n");
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
		console.log("Exploring codebase context...");
		const codebaseContext = await exploreCodebase(taskDescription);

		if (verbose) {
			console.log("Codebase exploration complete. Generating plan with LLM...");
		}

		const config = loadConfig();
		const model = config.defaultModel;
		const client = createProvider({
			model,
			provider: undefined,
			providers: config.providers,
		});
		const messages = createPlanMessages(taskDescription, codebaseContext, generatePrd);

		const capabilities = await client.getCapabilities(model);
		const response = await client.chat({
			model: capabilities.modelName,
			messages,
			temperature: 0.3,
			maxTokens: 8192,
		});

		const plan = response.content;

		if (verbose) {
			console.log(`Plan generated (${plan.length} characters)`);
		}

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
	const readline = await import("node:readline");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(
			`⚠️  Major architectural decision detected:\n\n${decision}\n\nDo you want to proceed? (y/n): `,
			(answer) => {
				rl.close();
				resolve(answer.toLowerCase().startsWith("y"));
			}
		);
	});
}
