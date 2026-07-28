import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition } from "../providers/types.js";
import { getEmbeddedSkillContent } from "../skills/builtin-registry.js";
import { discoverSkills, generateSkillsPrompt, type SkillMetadata } from "../skills/index.js";
import { parseSkillFrontmatter } from "../skills/parser.js";
import { escapeXml } from "../utils/xml.js";

/**
 * SkillManager — deep module for skill discovery, initialization, loading,
 * and tool restriction. Extracted from Agent (ADR-016 decomposition) to
 * separate the skill management concern from the agent loop.
 *
 * The interface is the test surface: construct a SkillManager with a
 * builtin dir + optional custom directories, call initialize(), then
 * loadSkill(name) or filterTools(allTools) — no LLM client or tool
 * registry needed for testing.
 */
export class SkillManager {
	private _skills: Map<string, SkillMetadata> = new Map();
	private _initialized: boolean = false;
	private _initPromise?: Promise<void>;
	private _activeAllowedTools: string[] | undefined;
	private _systemPrompt: string;

	constructor(systemPrompt: string) {
		this._systemPrompt = systemPrompt;
	}

	/**
	 * Discover and load skills from the given directories. Augments the
	 * system prompt with a skills listing. Returns a promise that resolves
	 * when initialization is complete — safe to call multiple times.
	 */
	initialize(skillDirectories: string[], builtinDir: string): Promise<void> {
		if (this._initPromise) {
			return this._initPromise;
		}

		this._initPromise = (async () => {
			if (this._initialized) return;

			const discoveredSkills = await discoverSkills(skillDirectories, builtinDir);
			for (const skill of discoveredSkills) {
				this._skills.set(skill.name, skill);
			}
			const skillsPrompt = generateSkillsPrompt(discoveredSkills);
			if (skillsPrompt) {
				this._systemPrompt = `${this._systemPrompt}\n\n${skillsPrompt}`;
			}
			this._initialized = true;
		})();

		return this._initPromise;
	}

	/** Wait for skill initialization to complete. */
	async waitForSkills(): Promise<void> {
		if (!this._initPromise) return;
		await this._initPromise;
	}

	/** Get the (possibly augmented) system prompt after skill initialization. */
	get systemPrompt(): string {
		return this._systemPrompt;
	}

	/** Get the skill registry map (name → metadata). */
	getRegistry(): Map<string, SkillMetadata> {
		return this._skills;
	}

	/** Number of discovered skills. */
	get count(): number {
		return this._skills.size;
	}

	/**
	 * Load a skill by name: read its content (from disk or embedded),
	 * parse frontmatter for allowed tools, set the tool restriction,
	 * and return the content + XML-wrapped version.
	 */
	async loadSkill(
		skillName: string
	): Promise<{ content: string; wrappedContent: string; allowedTools?: string[] } | null> {
		const skillMetadata = this._skills.get(skillName);
		if (!skillMetadata) return null;

		try {
			let content: string;
			let baseDir = ".";

			if (skillMetadata.location.startsWith("builtin://")) {
				const embeddedContent = getEmbeddedSkillContent(skillName);
				if (!embeddedContent) {
					throw new Error(`Built-in skill content not found: ${skillName}`);
				}
				content = embeddedContent;
			} else {
				content = await fs.readFile(skillMetadata.location, "utf-8");
				baseDir = path.dirname(skillMetadata.location);
			}

			let allowedTools: string[] | undefined;
			try {
				const parsed = parseSkillFrontmatter(content);
				allowedTools = parsed.frontmatter.allowedTools;
			} catch {
				console.warn(`[WARN] Could not parse frontmatter for skill: ${skillName}`);
			}

			if (allowedTools) {
				this.setRestriction(allowedTools);
			} else {
				this.clearRestriction();
			}

			const escapedContent = escapeXml(content);
			const wrappedContent = `<loaded_skill name="${skillName}" base_dir="${baseDir}">\n${escapedContent}\n</loaded_skill>`;

			return { content, wrappedContent, allowedTools };
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error.code === "ENOENT") {
				throw new Error(`Skill file not found: ${skillMetadata.location}`);
			}
			throw new Error(`Error reading skill: ${error.message}`);
		}
	}

	/** Restrict available tools to the given allowlist. */
	setRestriction(allowedTools: string[] | undefined): void {
		this._activeAllowedTools = allowedTools;
	}

	/** Clear any tool restriction — all tools become available. */
	clearRestriction(): void {
		this._activeAllowedTools = undefined;
	}

	/** Whether a tool restriction is currently active. */
	get hasRestriction(): boolean {
		return !!this._activeAllowedTools?.length;
	}

	/**
	 * Filter a list of tool definitions to only those allowed by the
	 * current skill restriction. If no restriction is active, returns
	 * all tools unchanged.
	 */
	filterTools(allTools: ToolDefinition[]): ToolDefinition[] {
		if (!this._activeAllowedTools?.length) {
			return allTools;
		}
		const allowedSet = new Set(this._activeAllowedTools);
		return allTools.filter((tool) => allowedSet.has(tool.name));
	}
}
