import type { Config } from "../../config/schema.js";
import { getBuiltinSkillsDir } from "../../skills/loader.js";

interface SkillHandlerOptions {
  json?: boolean;
}

export async function handleSkill(
  config: Config,
  args: string[],
  _options: SkillHandlerOptions,
): Promise<void> {
  const subCommand = args[0] || "list";

  if (subCommand === "list") {
    const skillDirectories = config.skillDirectories || [];
    const { discoverSkills } = await import("../../skills/loader.js");
    const builtinDir = getBuiltinSkillsDir();
    const skills = await discoverSkills(skillDirectories, builtinDir);

    if (_options.json) {
      console.log(
        JSON.stringify(
          skills.map((s) => ({
            name: s.name,
            description: s.description,
            location: s.location,
            isBuiltin: s.isBuiltin,
          })),
        ),
      );
    } else {
      console.log("\nSkills");
      console.log("======\n");

      if (skills.length === 0) {
        console.log("No skills found.");
        if (skillDirectories.length > 0) {
          console.log(`  Configured directories: ${skillDirectories.join(", ")}`);
        } else {
          console.log("  No skill directories configured.");
        }
        console.log("\n  To add skills, configure skillDirectories in config.yaml");
        console.log("  or run: tiny-agent skill init <name>\n");
      } else {
        for (const skill of skills) {
          const truncatedDesc =
            skill.description.length > 60
              ? `${skill.description.slice(0, 60)}...`
              : skill.description;
          const builtinIndicator = skill.isBuiltin ? " [builtin]" : "";
          console.log(`  ${skill.name}${builtinIndicator}`);
          console.log(`    ${truncatedDesc}`);
          console.log();
        }
        console.log(`Total: ${skills.length} skill(s)\n`);
      }
    }
  } else if (subCommand === "show") {
    const skillName = args[1];
    if (!skillName) {
      console.error("Error: Skill name required. Usage: tiny-agent skill show <name>");
      process.exit(1);
    }

    const skillDirectories = config.skillDirectories || [];
    const { discoverSkills } = await import("../../skills/loader.js");
    const builtinDir = getBuiltinSkillsDir();
    const skills = await discoverSkills(skillDirectories, builtinDir);
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      console.error(`Error: Skill not found: ${skillName}`);
      const available = skills.map((s) => s.name).join(", ");
      if (available) {
        console.error(`  Available skills: ${available}`);
      }
      process.exit(1);
    }

    try {
      let content: string;
      if (skill.location.startsWith("builtin://")) {
        const { getEmbeddedSkillContent } = await import("../../skills/builtin-registry.js");
        const builtinContent = getEmbeddedSkillContent(skill.name);
        if (!builtinContent) {
          console.error(`Error: Built-in skill content not found: ${skill.name}`);
          process.exit(1);
        }
        content = builtinContent;
      } else {
        const { readFile } = await import("node:fs/promises");
        content = await readFile(skill.location, "utf-8");
      }

      if (_options.json) {
        console.log(
          JSON.stringify({
            name: skill.name,
            description: skill.description,
            body: content,
          }),
        );
      } else {
        console.log(`\nSkill: ${skill.name}`);
        console.log(`======\n`);
        console.log(`Description: ${skill.description}`);
        console.log(`Location: ${skill.location}`);
        console.log("\n---\n");
        console.log(content);
        console.log();
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        console.error(`Error: Skill file not found: ${skill.location}`);
      } else {
        console.error(`Error reading skill: ${error.message}`);
      }
      process.exit(1);
    }
  } else if (subCommand === "init") {
    const skillName = args[1];
    if (!skillName) {
      console.error("Error: Skill name required. Usage: tiny-agent skill init <name>");
      process.exit(1);
    }

    // Validate skill name using the same pattern as parser.ts
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) {
      console.error(
        "Error: Invalid skill name. Must be lowercase alphanumeric with hyphens, no leading/trailing hyphens or consecutive hyphens.",
      );
      process.exit(1);
    }

    const { homedir } = await import("node:os");
    const { mkdir, writeFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const skillDir = join(homedir(), ".tiny-agent", "skills", skillName);
    const skillFile = join(skillDir, "SKILL.md");

    // Check if directory exists by trying to list it
    try {
      await readdir(skillDir);
      console.error(`Error: Skill directory already exists: ${skillDir}`);
      process.exit(1);
    } catch {
      // Directory doesn't exist, which is what we want
    }

    try {
      await mkdir(skillDir, { recursive: true });

      const template = `---
name: ${skillName}
description: A short description of what this skill does

# Skill Instructions

## When to Use
Describe when this skill should be activated...

## Steps
1. First step...
2. Second step...
3. Third step...

## Examples
\`\`\`example
User input example
\`\`\`

## Notes
- Important considerations...
- Common pitfalls to avoid...
`;

      await writeFile(skillFile, template, "utf-8");
      console.log(`Skill created: ${skillFile}`);
      console.log("\nTo use this skill, add the skill directory to your config.yaml:");
      console.log("  skillDirectories:");
      console.log(`    - ${homedir()}/.tiny-agent/skills`);
      console.log("\nOr run: tiny-agent skill list to verify the skill is discovered.\n");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      console.error(`Error creating skill: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown skill command: ${subCommand}`);
    console.error("Available commands: list, show, init");
    process.exit(1);
  }

  process.exit(0);
}
