import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter, type ParsedSkill } from "./parser.js";
import type { SkillMetadata } from "./types.js";
import { getEmbeddedBuiltinSkills } from "./builtin-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getBuiltinSkillsDir(): string {
  return path.resolve(__dirname, "builtin");
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findSkillFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findSkillFiles(fullPath)));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(fullPath);
      }
    }

    return files;
  } catch {
    return [];
  }
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

export async function discoverSkills(
  directories: string[],
  builtinDir?: string,
): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];
  const seenLocations = new Set<string>();

  // Load built-in skills if directory exists
  if (builtinDir) {
    const builtinDirPath = path.resolve(builtinDir);
    if (await isDirectory(builtinDirPath)) {
      const builtinSkillFiles = await findSkillFiles(builtinDirPath);
      for (const filePath of builtinSkillFiles) {
        const parsed = await parseFrontmatterOnly(filePath);
        if (parsed) {
          skills.push({
            name: parsed.frontmatter.name,
            description: parsed.frontmatter.description,
            location: filePath,
            isBuiltin: true,
            allowedTools: parsed.frontmatter.allowedTools,
          });
          seenLocations.add(filePath);
        }
      }
    }

    // Fallback to embedded skills if no builtin skills found
    if (!skills.some((s) => s.isBuiltin)) {
      skills.push(...getEmbeddedBuiltinSkills());
    }
  } else {
    skills.push(...getEmbeddedBuiltinSkills());
  }

  // Load skills from configured directories
  for (const dir of directories) {
    let dirPath: string;
    try {
      dirPath = path.resolve(dir);
    } catch {
      console.warn(`Warning: Invalid skill directory path: ${dir}`);
      continue;
    }

    if (!(await isDirectory(dirPath))) continue;

    const skillFiles = await findSkillFiles(dirPath);
    for (const filePath of skillFiles) {
      if (seenLocations.has(filePath)) continue;

      const parsed = await parseFrontmatterOnly(filePath);
      if (parsed) {
        skills.push({
          name: parsed.frontmatter.name,
          description: parsed.frontmatter.description,
          location: filePath,
          allowedTools: parsed.frontmatter.allowedTools,
        });
      }
    }
  }

  return skills;
}
