import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createSkillTool } from "../../src/tools/skill-tool.js";

describe("skill-tool with allowed-tools callback", () => {
	const tempDir = "/tmp/test-skill-tool";
	const tempSkillFile = `${tempDir}/test-skill/SKILL.md`;

	beforeEach(async () => {
		try {
			await fs.mkdir(tempDir, { recursive: true });
			await fs.mkdir(path.dirname(tempSkillFile), { recursive: true });
		} catch {
			// ignore
		}
	});

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("should call callback with allowed-tools from frontmatter array", async () => {
		const skillContent = `---
name: test-skill
description: A test skill
allowedTools:
  - read_file
  - write_file
---

# Test Skill
`;

		await fs.writeFile(tempSkillFile, skillContent, "utf-8");

		const skillRegistry = new Map<string, { name: string; description: string; location: string }>();
		skillRegistry.set("test-skill", {
			name: "test-skill",
			description: "A test skill",
			location: tempSkillFile,
		});

		let capturedAllowedTools: string[] | undefined;
		const tool = createSkillTool(skillRegistry, (allowedTools) => {
			capturedAllowedTools = allowedTools;
		});

		const result = await tool.execute({ name: "test-skill" });

		expect(result.success).toBe(true);
		expect(capturedAllowedTools).toEqual(["read_file", "write_file"]);
	});

	it("should call callback with allowed-tools from space-delimited string", async () => {
		const skillContent = `---
name: test-skill
description: A test skill
allowedTools: read_file write_file bash grep
---

# Test Skill
`;

		await fs.writeFile(tempSkillFile, skillContent, "utf-8");

		const skillRegistry = new Map<string, { name: string; description: string; location: string }>();
		skillRegistry.set("test-skill", {
			name: "test-skill",
			description: "A test skill",
			location: tempSkillFile,
		});

		let capturedAllowedTools: string[] | undefined;
		const tool = createSkillTool(skillRegistry, (allowedTools) => {
			capturedAllowedTools = allowedTools;
		});

		const result = await tool.execute({ name: "test-skill" });

		expect(result.success).toBe(true);
		expect(capturedAllowedTools).toEqual(["read_file", "write_file", "bash", "grep"]);
	});

	it("should call callback with undefined when no allowed-tools", async () => {
		const skillContent = `---
name: test-skill
description: A test skill
---

# Test Skill
`;

		await fs.writeFile(tempSkillFile, skillContent, "utf-8");

		const skillRegistry = new Map<string, { name: string; description: string; location: string }>();
		skillRegistry.set("test-skill", {
			name: "test-skill",
			description: "A test skill",
			location: tempSkillFile,
		});

		let capturedAllowedTools: string[] | undefined;
		const tool = createSkillTool(skillRegistry, (allowedTools) => {
			capturedAllowedTools = allowedTools;
		});

		const result = await tool.execute({ name: "test-skill" });

		expect(result.success).toBe(true);
		expect(capturedAllowedTools).toBeUndefined();
	});

	it("should call callback with undefined for invalid frontmatter", async () => {
		const skillContent = `---
name: test-skill
description: A test skill
---

# Test Skill
`;

		await fs.writeFile(tempSkillFile, skillContent, "utf-8");

		const skillRegistry = new Map<string, { name: string; description: string; location: string }>();
		skillRegistry.set("test-skill", {
			name: "test-skill",
			description: "A test skill",
			location: tempSkillFile,
		});

		let capturedAllowedTools: string[] | undefined;
		const tool = createSkillTool(skillRegistry, (allowedTools) => {
			capturedAllowedTools = allowedTools;
		});

		const result = await tool.execute({ name: "test-skill" });

		expect(result.success).toBe(true);
		expect(capturedAllowedTools).toBeUndefined();
	});

	it("should not crash if callback is not provided", async () => {
		const skillContent = `---
name: test-skill
description: A test skill
allowed-tools: read_file
---

# Test Skill
`;

		await fs.writeFile(tempSkillFile, skillContent, "utf-8");

		const skillRegistry = new Map<string, { name: string; description: string; location: string }>();
		skillRegistry.set("test-skill", {
			name: "test-skill",
			description: "A test skill",
			location: tempSkillFile,
		});

		const tool = createSkillTool(skillRegistry);

		const result = await tool.execute({ name: "test-skill" });

		expect(result.success).toBe(true);
	});

	it("should still return skill content when callback is provided", async () => {
		const skillContent = `---
name: test-skill
description: A test skill
allowed-tools: read_file
---

# Test Skill Content
This is the body of the skill.
`;

		await fs.writeFile(tempSkillFile, skillContent, "utf-8");

		const skillRegistry = new Map<string, { name: string; description: string; location: string }>();
		skillRegistry.set("test-skill", {
			name: "test-skill",
			description: "A test skill",
			location: tempSkillFile,
		});

		const tool = createSkillTool(skillRegistry, () => {});

		const result = await tool.execute({ name: "test-skill" });

		expect(result.success).toBe(true);
		expect(result.output).toContain('<loaded_skill name="test-skill"');
		expect(result.output).toContain("# Test Skill Content");
		expect(result.output).toContain("This is the body of the skill.");
	});
});
