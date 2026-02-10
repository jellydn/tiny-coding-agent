export type AgentPhase = "plan" | "build" | "explore";

export type AgentStatus = "pending" | "in_progress" | "completed" | "failed";

export interface StateMetadata {
	agentName: string;
	agentVersion: string;
	invocationTimestamp: string;
	parameters: Record<string, unknown>;
}

export interface PlanResult {
	plan: string;
}

export interface BuildResult {
	steps: Array<{
		stepNumber: number;
		description: string;
		status: "pending" | "completed" | "failed" | "skipped";
		changes?: Array<{
			type: "create" | "modify" | "delete";
			path: string;
			diff?: string;
		}>;
	}>;
}

export interface ExplorationResult {
	findings: string[];
	recommendations: string[];
	metrics: Record<string, number | string>;
}

export interface AgentResult {
	plan?: PlanResult;
	build?: BuildResult;
	exploration?: ExplorationResult;
}

export interface StateError {
	timestamp: string;
	phase: AgentPhase;
	message: string;
	details?: Record<string, unknown>;
}

export interface Artifact {
	name: string;
	path: string;
	type: "file" | "directory";
	createdAt: string;
}

export interface StateFile {
	metadata: StateMetadata;
	phase: AgentPhase;
	taskDescription: string;
	status: AgentStatus;
	results: AgentResult;
	errors: StateError[];
	artifacts: Artifact[];
}
