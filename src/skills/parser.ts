import * as yaml from "yaml";
import type { SkillFrontmatter } from "./types.js";

export interface ParsedSkill {
	frontmatter: SkillFrontmatter;
	body: string;
}

export function parseSkillFrontmatter(content: string): ParsedSkill {
	const lines = content.split("\n");
	let frontmatterStart = -1;
	let frontmatterEnd = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line?.trim() === "---") {
			if (frontmatterStart === -1) {
				frontmatterStart = i;
			} else {
				frontmatterEnd = i;
				break;
			}
		}
	}

	if (frontmatterStart === -1 || frontmatterEnd === -1) {
		throw new Error("Invalid SKILL.md: missing frontmatter delimiters (---)");
	}

	const yamlContent = lines.slice(frontmatterStart + 1, frontmatterEnd).join("\n");
	let body = lines.slice(frontmatterEnd + 1).join("\n");
	if (body.startsWith("\n")) {
		body = body.slice(1);
	}

	let parsed: Partial<SkillFrontmatter>;
	try {
		parsed = yaml.parse(yamlContent) as Partial<SkillFrontmatter>;
	} catch (err) {
		throw new Error(`Invalid YAML in frontmatter: ${(err as Error).message}`);
	}

	if (!("name" in parsed) || typeof parsed.name !== "string") {
		throw new Error("Frontmatter must have a 'name' field");
	}

	// Validate skill name (1-64 chars, lowercase alphanumeric with hyphens)
	if (parsed.name.length < 1 || parsed.name.length > 64) {
		throw new Error("Skill name must be 1-64 characters");
	}
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(parsed.name)) {
		throw new Error("Skill name must be lowercase alphanumeric with hyphens, no leading/trailing/consecutive hyphens");
	}

	if (!("description" in parsed) || typeof parsed.description !== "string") {
		throw new Error("Frontmatter must have a 'description' field");
	}

	// Validate description (1-1024 chars, not whitespace only)
	if (parsed.description.length < 1 || parsed.description.length > 1024) {
		throw new Error("Description must be 1-1024 characters");
	}
	if (parsed.description.trim().length === 0) {
		throw new Error("Description must not be empty or whitespace only");
	}

	const frontmatter: SkillFrontmatter = {
		name: parsed.name,
		description: parsed.description,
		license: parsed.license,
		compatibility: parsed.compatibility,
		metadata: parsed.metadata,
		allowedTools: parseAllowedTools(parsed.allowedTools ?? (parsed as Record<string, unknown>)["allowed-tools"]),
	};

	return { frontmatter, body };
}

function parseAllowedTools(value: unknown): string[] | undefined {
	if (!value) return undefined;
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? trimmed.split(/\s+/) : undefined;
	}
	return undefined;
}
