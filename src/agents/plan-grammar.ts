/**
 * PlanGrammar — single source of truth for the canonical plan format.
 *
 * Why this module exists: plan-agent emits plans as markdown; build-agent and
 * the handlePlan CLI / tasks viewer both parse plans. Without a shared grammar,
 * two readers diverge silently. This module owns: Plan/Phase/Step types,
 * `serialize` (canonical markdown → AST-via-string), `parse` (forgiving
 * markdown → AST), `validate` (semantic checks), and `exampleOutput` (a
 * prompt-grounding fixture).
 *
 * Consumers reference one of three entry points:
 * - `serialize(plan)` — emit canonical markdown.
 * - `parse(text)` — extract a Plan from markdown (LLM-resilient).
 * - `validate(plan)` — semantic checks (sequential phase numbers, dependencies
 *   resolve to earlier phases).
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

const PHASE_RE = /^##\s*(?:Phase\s+)?(\d+)(?:\s*[:.]\s*(.+?))?\s*$/;
const STEP_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;
const CHECKBOX_RE = /^\s*[-*]\s+\[[ xX]\]\s*(.+?)\s*$/;
const FYI_DASH_RE = /^\s*[-*]\s+(.+?)\s*$/;
const TITLE_RE = /^#\s+(?:Implementation\s+Plan:\s*)?(.+?)\s*$/;
const OVERVIEW_HEADER_RE = /^##\s+Overview\s*$/i;
const DEPS_RE = /^\*\*Dependencies:\*\*\s*(.+?)\s*$/i;
const SUCCESS_HEADER_RE = /^\*\*Success\s+Criteria:\*\*\s*$/i;
const STEPS_HEADER_RE = /^###\s+Steps:?\s*$/i;
const TECH_HEADER_RE = /^##\s+Technical\s+Considerations\s*$/i;

/**
 * Serialize a Plan into canonical markdown.
 *
 * The output is the canonical form: a future `parse(serialize(plan))`
 * returns a semantically equivalent Plan (deep-equal modulo the optional
 * fields' presence).
 */
export function serialize(plan: Plan): string {
	const lines: string[] = [];
	lines.push(`# Implementation Plan: ${plan.title}`);
	lines.push("");

	if (plan.overview && plan.overview.trim().length > 0) {
		lines.push("## Overview");
		lines.push(plan.overview.trim());
		lines.push("");
	}

	for (const phase of plan.phases) {
		lines.push(`## Phase ${phase.number}: ${phase.title}`);
		lines.push("");
		lines.push(
			`**Dependencies:** ${phase.dependencies.length === 0 ? "None" : phase.dependencies.map((d) => `Phase ${d}`).join(", ")}`
		);
		lines.push("");

		if (phase.successCriteria.length > 0) {
			lines.push("**Success Criteria:**");
			for (const c of phase.successCriteria) {
				lines.push(`- [ ] ${c}`);
			}
			lines.push("");
		}

		if (phase.steps.length > 0) {
			lines.push("### Steps:");
			for (const step of phase.steps) {
				lines.push(`${step.number}. ${step.text}`);
			}
			lines.push("");
		}
	}

	if (plan.technicalConsiderations && plan.technicalConsiderations.length > 0) {
		lines.push("## Technical Considerations");
		for (const c of plan.technicalConsiderations) {
			lines.push(`- ${c}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

type ParseMode = "none" | "overview" | "phaseDeps" | "phaseSuccess" | "phaseSteps" | "technical";

/**
 * Parse markdown into a Plan. Forgiving by design: LLM output is messy.
 *
 * Supported forms:
 * - Phase-form: `## Phase N: Title` headers with subsequent step lists,
 *   `**Dependencies:**`, `**Success Criteria:**`, `### Steps:`. Title after
 *   the colon is optional (e.g., `## Phase 1` alone is accepted).
 * - Flat-form (fallback): numbered lines at top level (`1. step\n2. step`)
 *   are wrapped into a single synthetic Phase so the AST stays uniform.
 *
 * Captures (when present): title, overview, phase title/deps/criteria/steps,
 * technical considerations. Falls back to `title: "Untitled"` if no `#` header
 * is found.
 */
export function parse(text: string): Plan {
	const lines = text.split("\n");
	let title = "";
	let overview: string | undefined;
	const phases: Phase[] = [];
	const technicalConsiderations: string[] = [];

	let currentPhase: Phase | null = null;
	let mode: ParseMode = "none";
	let overviewBuffer: string[] = [];

	const finalizeCurrentPhase = (): void => {
		if (currentPhase) {
			phases.push(currentPhase);
			currentPhase = null;
		}
	};

	const finalizeOverview = (): void => {
		if (overviewBuffer.length > 0) {
			// Filter out trailing empty strings (paragraph separators at end of section).
			while (overviewBuffer.length > 0 && overviewBuffer[overviewBuffer.length - 1] === "") {
				overviewBuffer.pop();
			}
			if (overviewBuffer.length > 0) {
				overview = overviewBuffer.join("\n");
			}
			overviewBuffer = [];
		}
	};

	for (const raw of lines) {
		const line = raw.replace(/\s+$/, "");

		// Pre-check: if we're in overview mode and this line is a `##` header,
		// finalize the overview buffer before any section header handler runs.
		if (mode === "overview" && /^##\s/.test(line.trim())) {
			finalizeOverview();
			mode = "none";
		}

		const titleMatch = line.match(TITLE_RE);
		if (titleMatch && title === "") {
			title = (titleMatch[1] ?? "").trim();
			mode = "overview";
			continue;
		}

		const phaseHeader = line.match(PHASE_RE);
		if (phaseHeader) {
			finalizeCurrentPhase();
			currentPhase = {
				number: parseInt(phaseHeader[1] ?? "0", 10),
				title: (phaseHeader[2] ?? "").trim(),
				dependencies: [],
				successCriteria: [],
				steps: [],
			};
			mode = "phaseDeps";
			continue;
		}

		if (OVERVIEW_HEADER_RE.test(line)) {
			finalizeCurrentPhase();
			finalizeOverview();
			mode = "overview";
			continue;
		}

		if (TECH_HEADER_RE.test(line)) {
			finalizeCurrentPhase();
			finalizeOverview();
			mode = "technical";
			continue;
		}

		if (currentPhase) {
			const depsMatch = line.match(DEPS_RE);
			if (depsMatch && (mode === "phaseDeps" || mode === "phaseSuccess" || mode === "phaseSteps")) {
				const depText = (depsMatch[1] ?? "").trim();
				if (depText && !/^none$/i.test(depText)) {
					const numbers: number[] = [];
					const re = /\b(?:Phase\s+)?(\d+)\b/g;
					let m: RegExpExecArray | null;
					while ((m = re.exec(depText)) !== null) {
						const n = parseInt(m[1] ?? "0", 10);
						if (!Number.isNaN(n) && n > 0 && !numbers.includes(n)) {
							numbers.push(n);
						}
					}
					currentPhase.dependencies = numbers;
				}
				mode = "phaseSuccess";
				continue;
			}

			if (SUCCESS_HEADER_RE.test(line) && (mode === "phaseDeps" || mode === "phaseSuccess")) {
				mode = "phaseSuccess";
				continue;
			}

			const checkboxMatch = line.match(CHECKBOX_RE);
			if (checkboxMatch && currentPhase && (mode === "phaseDeps" || mode === "phaseSuccess")) {
				currentPhase.successCriteria.push((checkboxMatch[1] ?? "").trim());
				mode = "phaseSuccess";
				continue;
			}

			const stepsHeader = line.match(STEPS_HEADER_RE);
			if (stepsHeader && (mode === "phaseSuccess" || mode === "phaseDeps")) {
				mode = "phaseSteps";
				continue;
			}

			const stepMatch = line.match(STEP_RE);
			if (stepMatch && (mode === "phaseSteps" || mode === "phaseSuccess" || mode === "phaseDeps")) {
				currentPhase.steps.push({
					number: parseInt(stepMatch[1] ?? "0", 10),
					text: (stepMatch[2] ?? "").trim(),
				});
				mode = "phaseSteps";
				continue;
			}

			// Bold-style `- text` lines (success criteria without checkbox) within Success-Criteria section.
			const dashMatch = line.match(FYI_DASH_RE);
			if (dashMatch && (mode === "phaseDeps" || mode === "phaseSuccess")) {
				const text = (dashMatch[1] ?? "").trim();
				if (text && !text.startsWith("**")) {
					if (currentPhase) {
						currentPhase.successCriteria.push(text);
					}
					mode = "phaseSuccess";
				}
				continue;
			}
		}

		if (mode === "overview") {
			const trimmed = line.trim();
			if (trimmed === "") {
				// Paragraph separator: push empty marker so join yields "\n\n" between paragraphs.
				if (overviewBuffer.length > 0 && overviewBuffer[overviewBuffer.length - 1] !== "") {
					overviewBuffer.push("");
				}
				continue;
			}
			overviewBuffer.push(trimmed);
			continue;
		}

		if (mode === "technical") {
			const dashMatch = line.match(FYI_DASH_RE);
			if (dashMatch) {
				const text = (dashMatch[1] ?? "").trim();
				if (text && !text.startsWith("**")) {
					technicalConsiderations.push(text);
				}
			}
		}
		// mode === "none": ignore stray content.
	}

	finalizeCurrentPhase();
	if (overview === undefined && overviewBuffer.length > 0) {
		finalizeOverview();
	}

	// Flat-form fallback: numeric-only plans at top level.
	if (phases.length === 0) {
		const flatSteps: Step[] = [];
		for (const raw of lines) {
			const m = raw.match(STEP_RE);
			if (m) {
				flatSteps.push({
					number: parseInt(m[1] ?? "0", 10),
					text: (m[2] ?? "").trim(),
				});
			}
		}
		if (flatSteps.length > 0) {
			phases.push({
				number: 1,
				title: title || "Steps",
				dependencies: [],
				successCriteria: [],
				steps: flatSteps,
			});
		}
	}

	return {
		title: title || "Untitled",
		overview,
		phases,
		technicalConsiderations: technicalConsiderations.length > 0 ? technicalConsiderations : undefined,
	};
}

/**
 * Validate a Plan's semantic structure.
 *
 * Checks:
 * - Title is non-empty.
 * - Phase numbers are sequential starting at 1.
 * - All phase dependencies refer to earlier phases:
 *   self-dependency and forward-dependency are reported distinctly so a single
 *   bad dependency produces one clear error, not two.
 * - All phase dependencies target a phase that exists within the plan.
 */
export function validate(plan: Plan): ValidationResult {
	const errors: string[] = [];

	if (!plan.title || !plan.title.trim()) {
		errors.push("plan title is empty");
	}
	if (plan.phases.length === 0) {
		errors.push("plan has zero phases");
	}
	for (let i = 0; i < plan.phases.length; i++) {
		const phase = plan.phases[i];
		if (!phase) continue;
		const expected = i + 1;
		if (phase.number !== expected) {
			errors.push(`phase ${phase.number ?? "?"} is out of order; expected ${expected}`);
		}
		if (!phase.title || !phase.title.trim()) {
			errors.push(`phase ${phase.number} has empty title`);
		}
		for (const dep of phase.dependencies) {
			if (dep < 1) {
				errors.push(`phase ${phase.number} depends on non-positive phase ${dep}`);
				continue;
			}
			if (dep > plan.phases.length) {
				errors.push(`phase ${phase.number} depends on missing phase ${dep}`);
				continue;
			}
			if (dep === phase.number) {
				errors.push(`phase ${phase.number} has self-dependency`);
				continue;
			}
			if (dep > phase.number) {
				errors.push(`phase ${phase.number} has forward dependency on phase ${dep}`);
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Canonical example plan, used as prompt-grounding by plan-agent.
 *
 * plan-agent embeds this in PLAN_SYSTEM_PROMPT so the LLM sees a concrete
 * instance of the format it should emit before answering.
 */
export function exampleOutput(): string {
	return serialize({
		title: "Sample Feature",
		overview: "Implement the feature end-to-end with tests.",
		phases: [
			{
				number: 1,
				title: "Scaffolding",
				dependencies: [],
				successCriteria: ["Repository layout is in place", "Base types are exported"],
				steps: [
					{ number: 1, text: "Create directory layout" },
					{ number: 2, text: "Add base type definitions" },
				],
			},
			{
				number: 2,
				title: "Implementation",
				dependencies: [1],
				successCriteria: ["Core logic works against sample inputs"],
				steps: [
					{ number: 1, text: "Implement parser" },
					{ number: 2, text: "Wire into the public API" },
				],
			},
		],
		technicalConsiderations: ["Use Bun's test runner for verification"],
	});
}
