import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverSkills } from "./loader.js";

const tempDir = path.join("/tmp", "test-skills", Date.now().toString());

async function createSkillFile(
  skillDir: string,
  name: string,
  description: string,
): Promise<string> {
  const skillPath = path.join(skillDir, name);
  await fs.promises.mkdir(skillPath, { recursive: true });
  const filePath = path.join(skillPath, "SKILL.md");
  await fs.promises.writeFile(
    filePath,
    `---
name: ${name}
description: ${description}
---
# Body content
`,
  );
  return filePath;
}

async function createInvalidSkillFile(skillDir: string): Promise<string> {
  const skillPath = path.join(skillDir, "invalid-skill");
  await fs.promises.mkdir(skillPath, { recursive: true });
  const filePath = path.join(skillPath, "SKILL.md");
  await fs.promises.writeFile(
    filePath,
    `---
invalid: yaml content
---
`,
  );
  return filePath;
}

async function createNestedSkill(
  baseDir: string,
  subdir: string,
  name: string,
  description: string,
): Promise<string> {
  const nestedDir = path.join(baseDir, subdir);
  return createSkillFile(nestedDir, name, description);
}

beforeEach(async () => {
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  await fs.promises.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("discoverSkills", () => {
  it("should discover skills from single directory", async () => {
    await createSkillFile(tempDir, "test-skill", "A test skill");

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(1);
    const skill = skills[0]!;
    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill");
    expect(skill.location).toContain("test-skill/SKILL.md");
  });

  it("should discover multiple skills from directory", async () => {
    await createSkillFile(tempDir, "skill-one", "First skill");
    await createSkillFile(tempDir, "skill-two", "Second skill");

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["skill-one", "skill-two"]);
  });

  it("should discover skills from nested subdirectories", async () => {
    await createNestedSkill(tempDir, "nested", "nested-skill", "Nested skill");

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(1);
    expect(skills[0]!.name).toBe("nested-skill");
  });

  it("should skip missing directories gracefully", async () => {
    const skills = await discoverSkills(["/nonexistent/path"]);

    expect(skills.length).toBe(0);
  });

  it("should skip directories that exist but contain no skills", async () => {
    await fs.promises.mkdir(path.join(tempDir, "empty"), { recursive: true });

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(0);
  });

  it("should skip invalid SKILL.md files with warning", async () => {
    await createInvalidSkillFile(tempDir);

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const skills = await discoverSkills([tempDir]);
    consoleWarn.mockRestore();

    expect(skills.length).toBe(0);
  });

  it("should handle multiple directories", async () => {
    const dir1 = path.join(tempDir, "dir1");
    const dir2 = path.join(tempDir, "dir2");
    await fs.promises.mkdir(dir1, { recursive: true });
    await fs.promises.mkdir(dir2, { recursive: true });
    await createSkillFile(dir1, "skill-from-dir1", "From dir1");
    await createSkillFile(dir2, "skill-from-dir2", "From dir2");

    const skills = await discoverSkills([dir1, dir2]);

    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.name).sort()).toEqual(["skill-from-dir1", "skill-from-dir2"]);
  });

  it("should return skills with absolute path to SKILL.md", async () => {
    await createSkillFile(tempDir, "my-skill", "My skill description");
    const absoluteDir = path.resolve(tempDir);

    const skills = await discoverSkills([absoluteDir]);

    expect(skills.length).toBe(1);
    expect(skills[0]!.location).toBe(path.join(absoluteDir, "my-skill", "SKILL.md"));
  });

  it("should return empty array when given empty directories array", async () => {
    const skills = await discoverSkills([]);

    expect(skills.length).toBe(0);
  });

  it("should handle deeply nested skill files", async () => {
    await createNestedSkill(tempDir, "a/b/c/d", "deep-skill", "Deeply nested skill");

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(1);
    expect(skills[0]!.name).toBe("deep-skill");
  });
});
