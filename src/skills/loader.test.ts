import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverSkills } from "./loader.js";

const tempDir = path.join("/tmp", "test-skills", Date.now().toString());

const EMBEDDED_SKILL_COUNT = 1;

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

async function createSkillWithAllowedTools(
  skillDir: string,
  name: string,
  description: string,
  allowedTools: string[],
): Promise<string> {
  const skillPath = path.join(skillDir, name);
  await fs.promises.mkdir(skillPath, { recursive: true });
  const filePath = path.join(skillPath, "SKILL.md");
  await fs.promises.writeFile(
    filePath,
    `---
name: ${name}
description: ${description}
allowed-tools:
${allowedTools.map((t) => `  - ${t}`).join("\n")}
---
# Body content
`,
  );
  return filePath;
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

    expect(skills.length).toBe(1 + EMBEDDED_SKILL_COUNT);
    const skill = skills.find((s) => s.name === "test-skill");
    expect(skill).toBeDefined();
    expect(skill!.description).toBe("A test skill");
    expect(skill!.location).toContain("test-skill/SKILL.md");
  });

  it("should discover multiple skills from directory", async () => {
    await createSkillFile(tempDir, "skill-one", "First skill");
    await createSkillFile(tempDir, "skill-two", "Second skill");

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(2 + EMBEDDED_SKILL_COUNT);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["code-simplifier", "skill-one", "skill-two"]);
  });

  it("should discover skills from nested subdirectories", async () => {
    await createNestedSkill(tempDir, "nested", "nested-skill", "Nested skill");

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(1 + EMBEDDED_SKILL_COUNT);
    const nestedSkill = skills.find((s) => s.name === "nested-skill");
    expect(nestedSkill).toBeDefined();
  });

  it("should skip missing directories gracefully", async () => {
    const skills = await discoverSkills(["/nonexistent/path"]);

    expect(skills.length).toBe(EMBEDDED_SKILL_COUNT);
    const embeddedSkill = skills.find((s) => s.name === "code-simplifier");
    expect(embeddedSkill).toBeDefined();
  });

  it("should skip directories that exist but contain no skills", async () => {
    await fs.promises.mkdir(path.join(tempDir, "empty"), { recursive: true });

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(EMBEDDED_SKILL_COUNT);
  });

  it("should skip invalid SKILL.md files with warning", async () => {
    await createInvalidSkillFile(tempDir);

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const skills = await discoverSkills([tempDir]);
    consoleWarn.mockRestore();

    expect(skills.length).toBe(EMBEDDED_SKILL_COUNT);
  });

  it("should handle multiple directories", async () => {
    const dir1 = path.join(tempDir, "dir1");
    const dir2 = path.join(tempDir, "dir2");
    await fs.promises.mkdir(dir1, { recursive: true });
    await fs.promises.mkdir(dir2, { recursive: true });
    await createSkillFile(dir1, "skill-from-dir1", "From dir1");
    await createSkillFile(dir2, "skill-from-dir2", "From dir2");

    const skills = await discoverSkills([dir1, dir2]);

    expect(skills.length).toBe(2 + EMBEDDED_SKILL_COUNT);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["code-simplifier", "skill-from-dir1", "skill-from-dir2"]);
  });

  it("should return skills with absolute path to SKILL.md", async () => {
    await createSkillFile(tempDir, "my-skill", "My skill description");
    const absoluteDir = path.resolve(tempDir);

    const skills = await discoverSkills([absoluteDir]);

    expect(skills.length).toBe(1 + EMBEDDED_SKILL_COUNT);
    const mySkill = skills.find((s) => s.name === "my-skill");
    expect(mySkill).toBeDefined();
    expect(mySkill!.location).toBe(path.join(absoluteDir, "my-skill", "SKILL.md"));
  });

  it("should return embedded skills when given empty directories array", async () => {
    const skills = await discoverSkills([]);

    expect(skills.length).toBe(EMBEDDED_SKILL_COUNT);
    const embeddedSkill = skills.find((s) => s.name === "code-simplifier");
    expect(embeddedSkill).toBeDefined();
    expect(embeddedSkill!.isBuiltin).toBe(true);
    expect(embeddedSkill!.location).toBe("builtin://code-simplifier");
  });

  it("should handle deeply nested skill files", async () => {
    await createNestedSkill(tempDir, "a/b/c/d", "deep-skill", "Deeply nested skill");

    const skills = await discoverSkills([tempDir]);

    expect(skills.length).toBe(1 + EMBEDDED_SKILL_COUNT);
    const deepSkill = skills.find((s) => s.name === "deep-skill");
    expect(deepSkill).toBeDefined();
  });

  it("should mark skills from builtin directory as builtin", async () => {
    const builtinDir = path.join(tempDir, "builtin");
    await fs.promises.mkdir(builtinDir, { recursive: true });
    await createSkillFile(builtinDir, "builtin-skill", "A builtin skill");

    const skills = await discoverSkills([], builtinDir);

    expect(skills.length).toBe(1);
    const builtinSkill = skills.find((s) => s.name === "builtin-skill");
    expect(builtinSkill).toBeDefined();
    expect(builtinSkill!.isBuiltin).toBe(true);
  });

  it("should discover skills from both builtin and user directories", async () => {
    const builtinDir = path.join(tempDir, "builtin");
    await fs.promises.mkdir(builtinDir, { recursive: true });
    await createSkillFile(builtinDir, "builtin-skill", "A builtin skill");
    await createSkillFile(tempDir, "user-skill", "A user skill");

    const skills = await discoverSkills([tempDir], builtinDir);

    const builtinSkills = skills.filter((s) => s.isBuiltin);
    const userSkills = skills.filter((s) => !s.isBuiltin);
    expect(builtinSkills.length).toBe(1);
    expect(builtinSkills[0]!.name).toBe("builtin-skill");
    expect(userSkills.length).toBe(1);
    expect(userSkills[0]!.name).toBe("user-skill");
  });

  it("should fallback to embedded skills when builtin directory is missing", async () => {
    await createSkillFile(tempDir, "user-skill", "A user skill");

    const skills = await discoverSkills([tempDir], "/nonexistent/builtin");

    expect(skills.length).toBe(1 + EMBEDDED_SKILL_COUNT);
    const userSkill = skills.find((s) => s.name === "user-skill");
    expect(userSkill).toBeDefined();
    const embeddedSkill = skills.find((s) => s.name === "code-simplifier");
    expect(embeddedSkill).toBeDefined();
    expect(embeddedSkill!.isBuiltin).toBe(true);
  });

  it("should fallback to embedded skills when builtin directory has invalid skills", async () => {
    const builtinDir = path.join(tempDir, "builtin");
    await fs.promises.mkdir(builtinDir, { recursive: true });
    await createInvalidSkillFile(builtinDir);

    const skills = await discoverSkills([], builtinDir);

    expect(skills.length).toBe(EMBEDDED_SKILL_COUNT);
    const embeddedSkill = skills.find((s) => s.name === "code-simplifier");
    expect(embeddedSkill).toBeDefined();
    expect(embeddedSkill!.isBuiltin).toBe(true);
  });

  it("should return embedded skills with correct metadata", async () => {
    const skills = await discoverSkills([]);

    const codeSimplifier = skills.find((s) => s.name === "code-simplifier");
    expect(codeSimplifier).toBeDefined();
    expect(codeSimplifier!.description).toBe(
      "Refine code for clarity and maintainability while preserving functionality",
    );
    expect(codeSimplifier!.isBuiltin).toBe(true);
    expect(codeSimplifier!.location).toBe("builtin://code-simplifier");
  });

  it("should parse allowed-tools from frontmatter", async () => {
    await createSkillWithAllowedTools(
      tempDir,
      "restricted-skill",
      "A skill with tool restrictions",
      ["read_file", "list_files"],
    );

    const skills = await discoverSkills([tempDir]);

    const restrictedSkill = skills.find((s) => s.name === "restricted-skill");
    expect(restrictedSkill).toBeDefined();
    expect(restrictedSkill!.allowedTools).toEqual(["read_file", "list_files"]);
  });

  it("should parse allowed-tools as space-separated string", async () => {
    const skillPath = path.join(tempDir, "space-separated-skill");
    await fs.promises.mkdir(skillPath, { recursive: true });
    const filePath = path.join(skillPath, "SKILL.md");
    await fs.promises.writeFile(
      filePath,
      `---
name: space-separated-skill
description: A skill with space-separated tools
allowed-tools:
  - write_file
  - grep
---
# Body content
`,
    );

    const skills = await discoverSkills([tempDir]);

    const skill = skills.find((s) => s.name === "space-separated-skill");
    expect(skill).toBeDefined();
    expect(skill!.allowedTools).toEqual(["write_file", "grep"]);
  });

  it("should set allowedTools to undefined when not specified", async () => {
    await createSkillFile(tempDir, "no-restriction-skill", "A skill without tool restrictions");

    const skills = await discoverSkills([tempDir]);

    const skill = skills.find((s) => s.name === "no-restriction-skill");
    expect(skill).toBeDefined();
    expect(skill!.allowedTools).toBeUndefined();
  });
});
