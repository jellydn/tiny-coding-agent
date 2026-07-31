/**
 * Plan Parser — forgiving markdown → Plan AST.
 *
 * LLM output is messy. This parser handles:
 * - Phase headers: `## Phase N: Title` (title optional)
 * - Dependencies: `**Dependencies:** Phase 1, Phase 2`
 * - Success criteria: `- [ ] criterion` or `- text`
 * - Steps: `1. step text`
 * - Technical considerations: `## Technical Considerations`
 * - Overview: `## Overview` section
 * - Flat-form fallback: numbered lines at top level → single synthetic phase
 */

import type { Phase, Plan, Step } from "./plan-types.js";

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

const PHASE_RE = /^##\s*(?:Phase\s+)?(\d+)(?:\s*[:.]\s*(.+?))?\s*$/;
const STEP_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;
const CHECKBOX_RE = /^\s*[-*]\s+\[[ xX]\]\s*(.+?)\s*$/;
const FYI_DASH_RE = /^\s*[-*]\s+(.+?)\s*$/;
const TITLE_RE = /^#\s+(?:Implementation\s+Plan:\s*)?(.+?)\s*$/;
const OVERVIEW_HEADER_RE = /^##\s+Overview\s*$/i;
const DEPS_RE = /^\*\*Dependencies:\*\*\s*(.+?)\s*$/i;
const SUCCESS_HEADER_RE = /^\*\*Success\s+Criteria:\*\*\s*$/i;
const STEPS_HEADER_RE = /^###\s+Steps:?$/i;
const TECH_HEADER_RE = /^##\s+Technical\s+Considerations\s*$/i;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ParseSection = "none" | "overview" | "phaseDeps" | "phaseSuccess" | "phaseSteps" | "technical";

type PhaseLineResult = { consumed: true; next: ParseSection } | { consumed: false };

// ---------------------------------------------------------------------------
// Phase line consumer
// ---------------------------------------------------------------------------

/**
 * Try to consume a line as part of the current phase's body. Returns
 * `{ consumed: true, next }` if a pattern matched (the caller should
 * `continue` with `section = result.next`), or `{ consumed: false }` if the
 * line did not belong to any phase-body pattern (the caller then falls
 * through to the overview / technical / none handlers).
 *
 * `next` may equal the current section (e.g. a `- **` line still consumes
 * the line but does not flip section), preserving the original control flow.
 */
function consumePhaseLine(line: string, phase: Phase, currentSection: ParseSection): PhaseLineResult {
	const depsMatch = line.match(DEPS_RE);
	if (
		depsMatch &&
		(currentSection === "phaseDeps" || currentSection === "phaseSuccess" || currentSection === "phaseSteps")
	) {
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
			phase.dependencies = numbers;
		}
		return { consumed: true, next: "phaseSuccess" };
	}

	if (SUCCESS_HEADER_RE.test(line) && (currentSection === "phaseDeps" || currentSection === "phaseSuccess")) {
		return { consumed: true, next: "phaseSuccess" };
	}

	const checkboxMatch = line.match(CHECKBOX_RE);
	if (checkboxMatch && (currentSection === "phaseDeps" || currentSection === "phaseSuccess")) {
		phase.successCriteria.push((checkboxMatch[1] ?? "").trim());
		return { consumed: true, next: "phaseSuccess" };
	}

	const stepsHeader = line.match(STEPS_HEADER_RE);
	if (stepsHeader && (currentSection === "phaseSuccess" || currentSection === "phaseDeps")) {
		return { consumed: true, next: "phaseSteps" };
	}

	const stepMatch = line.match(STEP_RE);
	if (
		stepMatch &&
		(currentSection === "phaseSteps" || currentSection === "phaseSuccess" || currentSection === "phaseDeps")
	) {
		phase.steps.push({
			number: parseInt(stepMatch[1] ?? "0", 10),
			text: (stepMatch[2] ?? "").trim(),
		});
		return { consumed: true, next: "phaseSteps" };
	}

	// Bold-style `- text` lines (success criteria without checkbox) within Success-Criteria section.
	const dashMatch = line.match(FYI_DASH_RE);
	if (dashMatch && (currentSection === "phaseDeps" || currentSection === "phaseSuccess")) {
		const text = (dashMatch[1] ?? "").trim();
		if (text && !text.startsWith("**")) {
			phase.successCriteria.push(text);
			return { consumed: true, next: "phaseSuccess" };
		}
		return { consumed: true, next: currentSection };
	}

	return { consumed: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
	let section: ParseSection = "none";
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
		if (section === "overview" && /^##\s/.test(line.trim())) {
			finalizeOverview();
			section = "none";
		}

		const titleMatch = line.match(TITLE_RE);
		if (titleMatch && title === "") {
			title = (titleMatch[1] ?? "").trim();
			section = "overview";
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
			section = "phaseDeps";
			continue;
		}

		if (OVERVIEW_HEADER_RE.test(line)) {
			finalizeCurrentPhase();
			finalizeOverview();
			section = "overview";
			continue;
		}

		if (TECH_HEADER_RE.test(line)) {
			finalizeCurrentPhase();
			finalizeOverview();
			section = "technical";
			continue;
		}

		if (currentPhase) {
			const result = consumePhaseLine(line, currentPhase, section);
			if (result.consumed) {
				section = result.next;
				continue;
			}
		}

		if (section === "overview") {
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

		if (section === "technical") {
			const dashMatch = line.match(FYI_DASH_RE);
			if (dashMatch) {
				const text = (dashMatch[1] ?? "").trim();
				if (text && !text.startsWith("**")) {
					technicalConsiderations.push(text);
				}
			}
		}
		// section === "none": ignore stray content.
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
