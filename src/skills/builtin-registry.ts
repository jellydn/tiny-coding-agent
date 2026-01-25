import { EMBEDDED_SKILL_CONTENT } from "./embedded-content.js";
import { parseSkillFrontmatter } from "./parser.js";
import type { SkillMetadata } from "./types.js";

// Get skill names from the embedded content keys
const EMBEDDED_SKILL_NAMES = Object.keys(EMBEDDED_SKILL_CONTENT);

export function getEmbeddedBuiltinSkills(): SkillMetadata[] {
	const skills: SkillMetadata[] = [];

	for (const name of EMBEDDED_SKILL_NAMES) {
		const content = EMBEDDED_SKILL_CONTENT[name]!; // Non-null assertion - key exists
		const { frontmatter } = parseSkillFrontmatter(content);
		if (!frontmatter) continue;
		skills.push({
			name: frontmatter.name,
			description: frontmatter.description,
			location: `builtin://${name}`,
			isBuiltin: true,
			allowedTools: frontmatter.allowedTools,
		});
	}

	return skills;
}

export function getEmbeddedSkillContent(name: string): string | null {
	// Case-sensitive check against known skill names
	if (!EMBEDDED_SKILL_NAMES.includes(name)) return null;
	return EMBEDDED_SKILL_CONTENT[name] ?? null;
}
