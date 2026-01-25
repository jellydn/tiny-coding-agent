# PRD: Agent Skills Support (agentskills.io)

## Introduction

Add support for the [agentskills.io](https://agentskills.io) specification to extend tiny-coding-agent capabilities with specialized knowledge and workflows. Skills are lightweight, open-format extensions containing a `SKILL.md` file with metadata and instructions. This complements the existing AGENTS.md support by enabling dynamic, on-demand loading of specialized instructions.

## Goals

- Implement skill discovery from configurable directories (`~/.tiny-agent/skills/`, project `.skills/`)
- Parse SKILL.md frontmatter (name, description) at startup for low context usage
- Enable automatic skill activation when user tasks match skill descriptions
- Support skill tool that loads full SKILL.md instructions into context
- Allow skills to reference bundled files (`scripts/`, `references/`, `assets/`)
- Multiple skills can be triggered if needed based on task requirements

## User Stories

### US-001: Create skills directory structure and types

**Description:** As a developer, I need TypeScript types and constants for the skills system so the codebase has a clear contract.

**Acceptance Criteria:**

- [ ] Create `src/skills/types.ts` with `SkillMetadata`, `SkillFrontmatter`, and `Skill` interfaces
- [ ] `SkillMetadata` contains: name (1-64 chars, lowercase + hyphens), description (1-1024 chars), location (absolute path)
- [ ] `Skill` extends metadata with full body content and optional fields (license, compatibility, metadata, allowed-tools)
- [ ] Create `src/skills/index.ts` with exports
- [ ] Typecheck passes

### US-002: Implement SKILL.md frontmatter parser

**Description:** As the system, I need to parse YAML frontmatter from SKILL.md files to extract skill metadata.

**Acceptance Criteria:**

- [ ] Create `src/skills/parser.ts` with `parseSkillFrontmatter(content: string)` function
- [ ] Extract YAML frontmatter between `---` delimiters
- [ ] Validate required fields: `name` (1-64 chars, lowercase alphanumeric + hyphens), `description` (1-1024 chars)
- [ ] Return `{ frontmatter, body }` or throw descriptive error
- [ ] Unit tests for valid/invalid frontmatter cases
- [ ] Typecheck passes

### US-003: Implement skill discovery

**Description:** As the system, I need to discover skills from configured directories at startup.

**Acceptance Criteria:**

- [ ] Create `src/skills/loader.ts` with `discoverSkills(directories: string[])` function
- [ ] Scan directories for folders containing `SKILL.md`
- [ ] Parse only frontmatter (not body) for each skill
- [ ] Return array of `SkillMetadata` with name, description, and absolute path
- [ ] Handle missing directories gracefully (skip, don't error)
- [ ] Default directories: `~/.tiny-agent/skills/`, `./.skills/`
- [ ] Unit tests for discovery
- [ ] Typecheck passes

### US-004: Generate available_skills XML for system prompt

**Description:** As the system, I need to inject available skills into the agent's system prompt.

**Acceptance Criteria:**

- [ ] Create `src/skills/prompt.ts` with `generateSkillsPrompt(skills: SkillMetadata[])` function
- [ ] Generate XML in format: `<available_skills><skill><name>...</name><description>...</description><location>...</location></skill>...</available_skills>`
- [ ] Keep each skill metadata concise (~50-100 tokens)
- [ ] Unit test for XML generation
- [ ] Typecheck passes

### US-005: Implement skill activation tool

**Description:** As the agent, I need a `skill` tool to load full SKILL.md content when a task matches.

**Acceptance Criteria:**

- [ ] Create `src/tools/skill-tool.ts` with a tool named `skill`
- [ ] Parameters: `name` (required string)
- [ ] Tool reads full SKILL.md file from skill's location
- [ ] Returns formatted skill instructions with `<loaded_skill name="...">` wrapper
- [ ] Include skill base directory in output for relative path references
- [ ] Error if skill not found
- [ ] Unit test for tool execution
- [ ] Typecheck passes

### US-006: Integrate skills into Agent startup

**Description:** As a user, I want skills discovered and available when the agent starts.

**Acceptance Criteria:**

- [ ] Modify `src/core/agent.ts` to accept `skillDirectories` option
- [ ] Discover skills at Agent construction
- [ ] Append `<available_skills>` XML to system prompt
- [ ] Store discovered skills for skill tool access
- [ ] Update CLI to pass skill directories from config
- [ ] Typecheck passes

### US-007: Add skills configuration to config schema

**Description:** As a user, I want to configure skill directories in my config file.

**Acceptance Criteria:**

- [x] Add `skillDirectories` array to `src/config/schema.ts`
- [x] Default to `["~/.tiny-agent/skills/", "./.skills/"]`
- [x] Add `--skills-dir <path>` CLI option to add custom directories
- [x] Update `loadConfig` to handle skill directories
- [x] Typecheck passes

**Status:** ✅ DONE

### US-008: Support skill file references

**Description:** As a skill author, I want to reference bundled files in my skill.

**Acceptance Criteria:**

- [ ] Skill tool output includes base directory path
- [ ] Agent can read files from `scripts/`, `references/`, `assets/` subdirectories
- [ ] Relative paths in SKILL.md body work correctly
- [ ] Document file reference patterns in skill tool output
- [ ] Typecheck passes

### US-009: Add skill management CLI commands

**Description:** As a user, I want CLI commands to manage and inspect skills.

**Acceptance Criteria:**

- [ ] `tiny-agent skill list` - List discovered skills with name, description
- [ ] `tiny-agent skill show <name>` - Display full SKILL.md content
- [ ] `tiny-agent skill init <name>` - Create a new skill template in `~/.tiny-agent/skills/`
- [ ] Output formats work with `--json` flag
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Discover skills from `~/.tiny-agent/skills/` and `./.skills/` directories at startup
- FR-2: Parse SKILL.md YAML frontmatter to extract name (required), description (required), and optional fields
- FR-3: Validate skill names: 1-64 chars, lowercase alphanumeric and hyphens, no leading/trailing/consecutive hyphens
- FR-4: Inject `<available_skills>` XML into system prompt with skill metadata only (~50-100 tokens per skill)
- FR-5: Provide `skill` tool that loads full SKILL.md content on demand
- FR-6: Support multiple skill activations per conversation if task requires
- FR-7: Include skill base directory in output for relative file references
- FR-8: Handle skill discovery errors gracefully (skip invalid skills, log warnings)

## Non-Goals

- No remote skill installation or package management
- No skill versioning or dependency management
- No skill sandboxing or permission system (beyond existing tool confirmation)
- No automatic script execution from skills
- No skill caching or compilation

## Technical Considerations

- Reuse existing YAML parser (`yaml` package already in dependencies)
- Follow existing patterns from `plugin-loader.ts` for file discovery
- Skills complement AGENTS.md - both can be active simultaneously
- Keep skill metadata parsing lightweight for fast startup
- Skills are filesystem-based (like the "filesystem-based agents" approach from agentskills.io)

## Success Metrics

- Skills discovered in under 100ms at startup
- Skill metadata adds <500 tokens to system prompt for 5 skills
- Skill activation loads full content in <50ms
- Zero impact on agent performance when no skills configured

## Design Decisions

- **Skills complement AGENTS.md** - Both are active simultaneously; AGENTS.md provides project context, skills provide specialized workflows
- **Support skill composition** - Multiple skills can be activated together; skills can reference other skills
- **Enforce allowed-tools** - When `allowed-tools` is specified in frontmatter, restrict tool access to only those listed during skill execution
