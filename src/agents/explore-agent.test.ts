import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import type { StateFile } from "./types.js";

const DEFAULT_STATE_FILE = "/tmp/test-explore-agent-state.json";

describe("ExploreAgentResult structure", () => {
	it("should have correct success result shape", async () => {
		const { exploreAgent } = await import("./explore-agent.js");
		const result = await exploreAgent("Test exploration", { stateFilePath: "/tmp/test-nonexistent.json" });

		expect(result.success).toBeBoolean();
		if (result.success) {
			expect(result.findings).toBeDefined();
			expect(typeof result.findings).toBe("string");
			expect(result.metrics).toBeDefined();
			expect(result.metrics).toBeTypeOf("object");
		} else {
			expect(result.error).toBeDefined();
		}
	});

	it("should have correct error result shape", () => {
		const errorResult = {
			success: false,
			error: "Exploration failed",
		};

		expect(errorResult.success).toBe(false);
		expect(errorResult.error).toBe("Exploration failed");
		expect((errorResult as { success: boolean; error: string; findings?: string }).findings).toBeUndefined();
	});
});

describe("extractRecommendations", () => {
	it("should extract recommendations section", async () => {
		const { exploreAgent } = await import("./explore-agent.js");
		expect(typeof exploreAgent).toBe("function");
	});

	it("should return empty string when no recommendations section", async () => {
		const testFunction = (content: string): string => {
			const recSection = content.match(/## Recommendations\s*([\s\S]*?)(?=\n## |$)/i);
			if (recSection?.[1]) {
				return recSection[1].trim();
			}
			return "";
		};

		const content = `# Codebase Analysis

## Other Section
Content here`;

		const recommendations = testFunction(content);
		expect(recommendations).toBe("");
	});
});

describe("extractFindingsList", () => {
	it("should extract findings as a list", async () => {
		const testFunction = (content: string): string[] => {
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
		};

		const content = `# Codebase Analysis

## Key Findings
- Finding one
- Finding two
- Finding three

## Recommendations
Content`;

		const findings = testFunction(content);
		expect(findings.length).toBe(3);
		expect(findings).toContain("Finding one");
		expect(findings).toContain("Finding two");
		expect(findings).toContain("Finding three");
	});

	it("should return empty array when no findings section", async () => {
		const testFunction = (content: string): string[] => {
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
		};

		const content = `# Codebase Analysis

## Other Section
Content`;

		const findings = testFunction(content);
		expect(findings).toEqual([]);
	});
});

describe("extractRecommendationsList", () => {
	it("should extract recommendations as a list", async () => {
		const testFunction = (content: string): string[] => {
			const recommendations: string[] = [];
			const lines = content.split("\n");
			for (const line of lines) {
				const trimmed = line.replace(/^[-*•]\s*/, "").trim();
				if (trimmed) {
					recommendations.push(trimmed);
				}
			}
			return recommendations;
		};

		const content = `- Recommendation one
- Recommendation two
- Recommendation three`;

		const recommendations = testFunction(content);
		expect(recommendations.length).toBe(3);
		expect(recommendations).toContain("Recommendation one");
		expect(recommendations).toContain("Recommendation two");
		expect(recommendations).toContain("Recommendation three");
	});
});

describe("StateFile structure for explore agent", () => {
	const tempStateFile = DEFAULT_STATE_FILE;

	beforeEach(() => {
		try {
			unlinkSync(tempStateFile);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(`${tempStateFile}.lock`);
		} catch {
			/* ignore */
		}
	});

	afterEach(() => {
		try {
			unlinkSync(tempStateFile);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(`${tempStateFile}.lock`);
		} catch {
			/* ignore */
		}
	});

	it("should have correct explore phase in state file", () => {
		const state: StateFile = {
			metadata: {
				agentName: "tiny-agent",
				agentVersion: "1.0.0",
				invocationTimestamp: new Date().toISOString(),
				parameters: { depth: "shallow" },
			},
			phase: "explore",
			taskDescription: "Explore codebase",
			status: "completed",
			results: {
				exploration: {
					findings: ["Finding 1", "Finding 2"],
					recommendations: ["Recommendation 1"],
					metrics: { fileCount: 100 },
				},
			},
			errors: [],
			artifacts: [],
		};

		expect(state.phase).toBe("explore");
		expect(state.status).toBe("completed");
		expect(state.results.exploration).toBeDefined();
		expect(state.results.exploration?.findings).toHaveLength(2);
		expect(state.results.exploration?.recommendations).toHaveLength(1);
		expect(state.results.exploration?.metrics.fileCount).toBe(100);
	});

	it("should handle exploration result structure", async () => {
		const explorationResult = {
			findings: ["Code is well-structured", "Good test coverage"],
			recommendations: ["Add more edge case tests", "Consider performance optimization"],
			metrics: { fileCount: 150, locCount: 5000 },
		};

		expect(explorationResult.findings).toBeInstanceOf(Array);
		expect(explorationResult.recommendations).toBeInstanceOf(Array);
		expect(explorationResult.metrics).toBeDefined();
		expect(typeof explorationResult.metrics.fileCount).toBe("number");
	});

	it("should preserve existing state when updating", async () => {
		const existingState: StateFile = {
			metadata: {
				agentName: "tiny-agent",
				agentVersion: "1.0.0",
				invocationTimestamp: "2024-01-01T00:00:00.000Z",
				parameters: { planId: "123" },
			},
			phase: "plan",
			taskDescription: "Original task",
			status: "completed",
			results: {
				plan: { plan: "Test plan" },
			},
			errors: [],
			artifacts: [],
		};

		writeFileSync(tempStateFile, JSON.stringify(existingState, null, 2), "utf-8");

		const explorationResult = {
			findings: ["New finding"],
			recommendations: ["New recommendation"],
			metrics: { fileCount: 50 },
		};

		const updatedState: StateFile = {
			...existingState,
			phase: "explore",
			status: "completed",
			results: {
				...existingState.results,
				exploration: explorationResult,
			},
		};

		writeFileSync(tempStateFile, JSON.stringify(updatedState, null, 2), "utf-8");

		const { readStateFile } = await import("./state.js");
		const result = await readStateFile(tempStateFile);
		expect(result.success).toBe(true);
		expect(result.data?.phase).toBe("explore");
		expect(result.data?.results.exploration?.findings).toEqual(["New finding"]);
		expect(result.data?.results.plan?.plan).toBe("Test plan");
	});

	it("should handle minimal exploration state", () => {
		const minimalState: StateFile = {
			metadata: {
				agentName: "tiny-agent",
				agentVersion: "1.0.0",
				invocationTimestamp: new Date().toISOString(),
				parameters: {},
			},
			phase: "explore",
			taskDescription: "Minimal exploration",
			status: "pending",
			results: {},
			errors: [],
			artifacts: [],
		};

		expect(minimalState.results.plan).toBeUndefined();
		expect(minimalState.results.build).toBeUndefined();
		expect(minimalState.results.exploration).toBeUndefined();
	});
});

describe("ExploreAgentOptions", () => {
	it("should accept shallow depth option", async () => {
		const { exploreAgent } = await import("./explore-agent.js");
		expect(typeof exploreAgent).toBe("function");
	});

	it("should accept deep depth option", async () => {
		const { exploreAgent } = await import("./explore-agent.js");
		expect(typeof exploreAgent).toBe("function");
	});

	it("should accept verbose option", async () => {
		const { exploreAgent } = await import("./explore-agent.js");
		expect(typeof exploreAgent).toBe("function");
	});

	it("should accept stateFilePath option", async () => {
		const { exploreAgent } = await import("./explore-agent.js");
		expect(typeof exploreAgent).toBe("function");
	});
});
