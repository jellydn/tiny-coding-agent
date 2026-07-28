import type { Message } from "../providers/types.js";
import { createAgentClient } from "./agent-client.js";
import { CodebaseExplorer } from "./codebase-explorer.js";
import { DEFAULT_STATE_FILE } from "./state.js";
import { StateManager } from "./state-manager.js";

export interface ExploreAgentOptions {
	stateFilePath?: string;
	depth?: "shallow" | "deep";
	verbose?: boolean;
}

export interface ExploreAgentResult {
	success: boolean;
	error?: string;
	findings?: string;
	recommendations?: string;
	metrics?: Record<string, number | string>;
}

const EXPLORE_SYSTEM_PROMPT = `You are a code analysis expert. Your task is to explore and analyze a codebase, providing insights, findings, recommendations, and metrics.

For each analysis, you should:
1. Examine the project structure and organization
2. Identify key files and their purposes
3. Detect patterns, frameworks, and technologies used
4. Analyze dependencies and their relationships
5. Look for code quality indicators
6. Identify potential issues or improvements

Output your analysis as a structured report with these sections:

# Codebase Analysis Report

## Overview
[Brief summary of the codebase purpose and structure]

## Key Findings
- [Finding 1]
- [Finding 2]
- [Finding 3]

## Architecture & Patterns
- [Pattern 1]
- [Pattern 2]

## Dependencies
- [Key dependencies and their purposes]

## Recommendations
- [Recommendation 1]
- [Recommendation 2]
- [Recommendation 3]

## Code Metrics
- Total files: [count]
- Total lines of code: [approximate count]
- Main languages: [list]
- Key directories: [list]

## Potential Issues
- [Issue 1]
- [Issue 2]

## Additional Observations
[Any other notable observations]`;

function createExploreMessages(taskDescription: string, codebaseContext: string): Message[] {
	return [
		{ role: "system", content: EXPLORE_SYSTEM_PROMPT },
		{
			role: "user",
			content: `## Task Description
${taskDescription}

## Codebase Context
${codebaseContext}

Perform a comprehensive analysis of the codebase and generate a detailed report with findings, recommendations, and metrics.`,
		},
	];
}

export async function exploreAgent(
	taskDescription: string,
	options?: ExploreAgentOptions
): Promise<ExploreAgentResult> {
	const stateFilePath = options?.stateFilePath || DEFAULT_STATE_FILE;
	const depth = options?.depth || "shallow";
	const verbose = options?.verbose || false;

	if (verbose) {
		console.log("Starting explore agent...");
		console.log(`Task: ${taskDescription}`);
		console.log(`State file: ${stateFilePath}`);
		console.log(`Depth: ${depth}`);
	}

	const cwd = process.cwd();

	try {
		console.log(`📂 Exploring codebase (${depth} mode)...`);

		const explorer = new CodebaseExplorer();
		const { report: codebaseContext, metrics } =
			depth === "shallow" ? await explorer.exploreShallow(cwd) : await explorer.exploreDeep(cwd);
		console.log("✓ Codebase exploration complete");

		const { client, modelName } = await createAgentClient();

		console.log(`🤖 Generating analysis with ${modelName}...`);
		const messages = createExploreMessages(taskDescription, codebaseContext);

		const response = await client.chat({
			model: modelName,
			messages,
			temperature: 0.3,
			maxTokens: 8192,
		});

		const findings = response.content;
		console.log(`✓ Analysis generated (${findings.length} characters)`);

		const recommendations = extractRecommendations(findings);

		if (options?.stateFilePath) {
			const mgr = new StateManager(stateFilePath, {
				parameters: { depth },
			});
			await mgr.loadOrCreate(taskDescription);
			mgr.updatePhase("explore", "completed");
			mgr.mergeResult("exploration", {
				findings: extractFindingsList(findings),
				recommendations: extractRecommendationsList(recommendations),
				metrics,
			});

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
			findings,
			recommendations,
			metrics,
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error";
		return {
			success: false,
			error: `Exploration failed: ${errorMessage}`,
		};
	}
}

function extractRecommendations(content: string): string {
	const recSection = content.match(/## Recommendations\s*([\s\S]*?)(?=\n## |$)/i);
	if (recSection?.[1]) {
		return recSection[1].trim();
	}
	return "";
}

function extractFindingsList(content: string): string[] {
	const findings: string[] = [];
	const match = content.match(/## Key Findings\s*([\s\S]*?)(?=\n## |$)/i);
	if (match?.[1]) {
		const lines = match[1].split("\n");
		for (const line of lines) {
			const trimmed = line.replace(/^[-*•]\s*/, "").trim();
			if (trimmed && !trimmed.startsWith("##")) {
				findings.push(trimmed);
			}
		}
	}
	return findings;
}

function extractRecommendationsList(content: string): string[] {
	const recommendations: string[] = [];
	const lines = content.split("\n");
	for (const line of lines) {
		const trimmed = line.replace(/^[-*•]\s*/, "").trim();
		if (trimmed) {
			recommendations.push(trimmed);
		}
	}
	return recommendations;
}
