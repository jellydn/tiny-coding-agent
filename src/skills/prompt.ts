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

	return `<available_skills>${skillElements}</available_skills>`;
}
