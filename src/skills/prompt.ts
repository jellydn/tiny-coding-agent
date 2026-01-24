import type { SkillMetadata } from "./types.js";

export function generateSkillsPrompt(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "";
  }

  const skillElements = skills
    .map(
      (skill) =>
        `<skill><name>${skill.name}</name><description>${skill.description}</description><location>${skill.location}</location></skill>`,
    )
    .join("");

  return `<available_skills>${skillElements}</available_skills>`;
}
