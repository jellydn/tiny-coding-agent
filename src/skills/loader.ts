import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseSkillFrontmatter, type ParsedSkill } from "./parser.js";
import type { SkillMetadata } from "./types.js";

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findSkillFiles(dir: string, found: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await findSkillFiles(fullPath, found);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      found.push(fullPath);
    }
  }

  return found;
}

async function parseFrontmatterOnly(filePath: string): Promise<ParsedSkill | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseSkillFrontmatter(content);
  } catch (err) {
    console.warn(`Warning: Invalid SKILL.md at ${filePath}: ${(err as Error).message}`);
    return null;
  }
}

export async function discoverSkills(directories: string[]): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];

  for (const dir of directories) {
    let dirPath: string;

    try {
      dirPath = path.resolve(dir);
    } catch {
      console.warn(`Warning: Invalid skill directory path: ${dir}`);
      continue;
    }

    let dirExists = false;

    try {
      dirExists = await isDirectory(dirPath);
    } catch {
      console.warn(`Warning: Cannot access skill directory: ${dirPath}`);
      continue;
    }

    if (!dirExists) {
      continue;
    }

    const skillFiles = await findSkillFiles(dirPath);

    for (const filePath of skillFiles) {
      const parsed = await parseFrontmatterOnly(filePath);

      if (!parsed) {
        continue;
      }

      skills.push({
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        location: filePath,
      });
    }
  }

  return skills;
}
