import { escapeXml } from "../utils/xml.js";
import type { SkillMetadata } from "./types.js";

export function generateSkillsPrompt(skills: SkillMetadata[]): string {
	if (skills.length === 0) {
		return "";
	}

	const skillElements = skills
		.map(
			(skill) =>
				`<skill><name>${escapeXml(skill.name)}</name><description>${escapeXml(skill.description)}</description><location>${escapeXml(skill.location)}</location></skill>`
		)
		.join("");

	return `<available_skills>
The following skills are available for use. To load a skill and receive its full instructions, call the 'skill' tool with the skill name.
Example: skill({ name: "code-simplifier" })

Once loaded, the skill will provide detailed instructions that you should follow.

${skillElements}
</available_skills>`;
}
