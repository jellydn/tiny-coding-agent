import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import type { SkillMetadata } from "../skills/types.js";
import { parseSkillFrontmatter } from "../skills/parser.js";

export function createSkillTool(
  skillRegistry: Map<string, SkillMetadata>,
  onSkillLoaded?: (allowedTools: string[] | undefined) => void,
): Tool {
  return {
    name: "skill",
    description:
      "Load and read a skill's full content. Skills are reusable agent capabilities defined in SKILL.md files. Use this to get detailed instructions for a specific skill.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name of the skill to load",
        },
      },
      required: ["name"],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const skillName = args.name as string;

      if (!skillName) {
        return { success: false, error: "Skill name is required" };
      }

      const skillMetadata = skillRegistry.get(skillName);
      if (!skillMetadata) {
        const availableSkills = Array.from(skillRegistry.keys()).join(", ");
        return {
          success: false,
          error: `Skill not found: ${skillName}. Available skills: ${availableSkills || "none"}`,
        };
      }

      try {
        const content = await fs.readFile(skillMetadata.location, "utf-8");

        let allowedTools: string[] | undefined;
        try {
          const parsed = parseSkillFrontmatter(content);
          allowedTools = parsed.frontmatter.allowedTools;
        } catch {
          console.warn(`[WARN] Could not parse frontmatter for skill: ${skillName}`);
        }

        if (onSkillLoaded) {
          onSkillLoaded(allowedTools);
        }

        const baseDir = path.dirname(skillMetadata.location);
        const wrappedContent = `<loaded_skill name="${skillName}" base_dir="${baseDir}">\n${content}\n</loaded_skill>`;
        return { success: true, output: wrappedContent };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "ENOENT") {
          return { success: false, error: `Skill file not found: ${skillMetadata.location}` };
        }
        return { success: false, error: `Failed to read skill: ${error.message}` };
      }
    },
  };
}
