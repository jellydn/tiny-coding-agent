/**
 * Shared types for the plan grammar module.
 *
 * These types are consumed by plan-parser, plan-validator, plan-grammar
 * (barrel), and all downstream consumers (plan-agent, plan-converter,
 * CLI plan handler).
 */

export interface Step {
	number: number;
	text: string;
}

export interface Phase {
	number: number;
	title: string;
	/** Phase numbers this phase depends on. Empty array means no dependencies. */
	dependencies: number[];
	successCriteria: string[];
	steps: Step[];
}

export interface Plan {
	title: string;
	overview?: string;
	phases: Phase[];
	technicalConsiderations?: string[];
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}
