# PRD: Tiny Coding Agent

## Introduction

A lightweight, extensible coding agent built in TypeScript that helps developers with coding tasks across TypeScript, React, JavaScript, Node.js, Bash, and markdown/JSON. The agent supports multiple LLM providers (including local models), integrates with MCP servers as a client, and offers a plugin system for custom tools and skills.

## Goals

- Provide a CLI-first coding assistant that works with any LLM provider
- Enable MCP client integration to leverage external tool servers
- Support standard coding tools (file ops, bash, grep, glob, web search)
- Allow extensibility through YAML/JSON config and a plugin system
- Keep the codebase small, readable, and hackable

## User Stories

### US-001: Project Setup and Structure

**Description:** As a developer, I want a well-structured TypeScript project so I can start building the agent.

**Acceptance Criteria:**

- [ ] Initialize Node.js project with TypeScript, ESLint, Prettier
- [ ] Set up `src/` folder structure: `core/`, `tools/`, `providers/`, `mcp/`, `cli/`, `config/`
- [ ] Configure `tsconfig.json` for ES modules
- [ ] Add build and dev scripts to `package.json`
- [ ] Typecheck passes

---

### US-002: Configuration System

**Description:** As a user, I want to configure the agent via YAML/JSON so I can customize models, tools, and behavior.

**Acceptance Criteria:**

- [ ] Load config from `~/.tiny-agent/config.yaml` (fallback to `config.json`)
- [ ] Support config for: default model, provider settings, enabled tools, MCP servers
- [ ] Validate config schema on load with helpful error messages
- [ ] Allow environment variable overrides (e.g., `TINY_AGENT_MODEL`)
- [ ] Typecheck passes

**Example config:**

```yaml
defaultModel: gpt-4o
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
  ollama:
    baseUrl: http://localhost:11434
mcpServers:
  - name: filesystem
    command: npx
    args: ["-y", "@anthropic/mcp-server-filesystem", "/home/user"]
tools:
  - read_file
  - write_file
  - bash
  - grep
  - glob
  - web_search
```

---

### US-003: Multi-Provider LLM Client

**Description:** As a user, I want to use any LLM provider so I'm not locked into one vendor.

**Acceptance Criteria:**

- [ ] Implement unified `LLMClient` interface with `chat()` and `stream()` methods
- [ ] Support OpenAI-compatible API (works with OpenAI, Groq, Together, OpenRouter, etc.)
- [ ] Support Anthropic API (Claude models)
- [ ] Support Ollama for local models
- [ ] Auto-detect provider from model name or explicit config
- [ ] Handle streaming responses for real-time output
- [ ] Typecheck passes

---

### US-004: Tool System Architecture

**Description:** As a developer, I want a clean tool interface so I can easily add new tools.

**Acceptance Criteria:**

- [ ] Define `Tool` interface: `name`, `description`, `parameters` (JSON Schema), `execute()`
- [ ] Tools return structured results with `success`, `output`, `error` fields
- [ ] Tool registry to register/discover tools
- [ ] Convert tools to LLM function-calling format (OpenAI/Anthropic compatible)
- [ ] Typecheck passes

---

### US-005: Core Tools - File Operations

**Description:** As a user, I want to read and write files so the agent can modify my code.

**Acceptance Criteria:**

- [ ] `read_file`: Read file content with optional line range
- [ ] `write_file`: Write/overwrite file content
- [ ] `edit_file`: Replace specific text in a file (search/replace)
- [ ] `list_directory`: List files and folders in a directory
- [ ] Handle errors gracefully (file not found, permission denied)
- [ ] Typecheck passes

---

### US-006: Core Tools - Bash Execution

**Description:** As a user, I want to run shell commands so the agent can execute builds, tests, and scripts.

**Acceptance Criteria:**

- [ ] `bash`: Execute shell command and return stdout/stderr
- [ ] Set timeout (default 60s, configurable)
- [ ] Set working directory
- [ ] Capture exit code
- [ ] Stream output for long-running commands
- [ ] Typecheck passes

---

### US-007: Core Tools - Search (Grep & Glob)

**Description:** As a user, I want to search files and content so the agent can navigate my codebase.

**Acceptance Criteria:**

- [ ] `grep`: Search file contents with regex support
- [ ] `glob`: Find files by pattern (e.g., `**/*.ts`)
- [ ] Return results with file paths and line numbers
- [ ] Limit results to prevent token explosion
- [ ] Typecheck passes

---

### US-008: Core Tools - Web Search

**Description:** As a user, I want the agent to search the web for documentation and answers.

**Acceptance Criteria:**

- [ ] `web_search`: Search using a search API (DuckDuckGo, Tavily, or configurable)
- [ ] Return title, URL, snippet for each result
- [ ] Support `max_results` parameter
- [ ] Typecheck passes

---

### US-009: MCP Client Integration

**Description:** As a user, I want to connect to MCP servers so I can extend the agent with external tools.

**Acceptance Criteria:**

- [ ] Implement MCP client following the Model Context Protocol spec
- [ ] Launch MCP servers via stdio (command + args from config)
- [ ] Discover tools from connected MCP servers (`tools/list`)
- [ ] Call MCP tools and return results (`tools/call`)
- [ ] Handle MCP server lifecycle (start, health check, restart on failure)
- [ ] Merge MCP tools with built-in tools in the tool registry
- [ ] Typecheck passes

---

### US-010: Agent Loop

**Description:** As a user, I want the agent to iteratively solve problems using tools until complete.

**Acceptance Criteria:**

- [ ] Implement ReAct-style agent loop: think → act → observe → repeat
- [ ] Send conversation history + available tools to LLM
- [ ] Parse tool calls from LLM response
- [ ] Execute tools and append results to conversation
- [ ] Stop when LLM provides final answer (no tool calls)
- [ ] Limit max iterations (configurable, default 20)
- [ ] Typecheck passes

---

### US-011: CLI Interface

**Description:** As a user, I want a simple CLI to interact with the agent.

**Acceptance Criteria:**

- [ ] Command: `tiny-agent chat` - Start interactive chat session
- [ ] Command: `tiny-agent run "prompt"` - Run single prompt and exit
- [ ] Command: `tiny-agent config` - Show current config
- [ ] Flag: `--model` to override default model
- [ ] Flag: `--provider` to override provider
- [ ] Pretty-print responses with syntax highlighting
- [ ] Show tool calls and results in verbose mode (`-v`)
- [ ] Typecheck passes

---

### US-012: Plugin System for Custom Tools

**Description:** As a developer, I want to add custom tools via plugins so I can extend the agent.

**Acceptance Criteria:**

- [ ] Load plugins from `~/.tiny-agent/plugins/` directory
- [ ] Each plugin is a JS/TS module exporting a `Tool` or array of `Tool`
- [ ] Plugins can be npm packages or local files
- [ ] Support plugin config in main config file
- [ ] Typecheck passes

**Example plugin:**

```typescript
// ~/.tiny-agent/plugins/my-tool.ts
import { Tool } from "tiny-agent";

export default {
  name: "my_custom_tool",
  description: "Does something custom",
  parameters: { type: "object", properties: { input: { type: "string" } } },
  async execute({ input }) {
    return { success: true, output: `Processed: ${input}` };
  },
} satisfies Tool;
```

---

### US-013: Conversation History & Context

**Description:** As a user, I want conversation context maintained so the agent remembers what we discussed.

**Acceptance Criteria:**

- [ ] Maintain message history during a session
- [ ] Support system prompt configuration
- [ ] Optionally save/load conversation to file
- [ ] Token counting and context window management
- [ ] Typecheck passes

---

## Functional Requirements

- FR-1: Load configuration from `~/.tiny-agent/config.yaml` or `config.json`
- FR-2: Support OpenAI, Anthropic, and Ollama as LLM providers
- FR-3: Implement tools: `read_file`, `write_file`, `edit_file`, `list_directory`, `bash`, `grep`, `glob`, `web_search`
- FR-4: Connect to MCP servers via stdio and expose their tools
- FR-5: Run agent loop until task complete or max iterations reached
- FR-6: Provide CLI commands: `chat`, `run`, `config`
- FR-7: Load custom tools from plugins directory
- FR-8: Stream LLM responses to terminal in real-time

## Non-Goals

- No web UI (CLI only for v1)
- No MCP server mode (client only)
- No sub-agent delegation (future feature)
- No skill/subcommand system (future feature)
- No built-in RAG or vector search
- No authentication/multi-user support

## Technical Considerations

- **Language:** TypeScript (ES modules, Node.js 20+)
- **Dependencies:** Keep minimal - avoid heavy frameworks
  - `@anthropic-ai/sdk` for Claude
  - `openai` for OpenAI-compatible APIs
  - `ollama` for local models
  - `@anthropic-ai/mcp` or custom implementation for MCP client
  - `commander` or `yargs` for CLI
  - `yaml` for config parsing
  - `chalk` for terminal colors
- **Testing:** Vitest for unit tests
- **Build:** `tsup` or `esbuild` for fast builds

## Success Metrics

- Agent can complete basic coding tasks (read files, make edits, run tests)
- MCP integration works with standard MCP servers (filesystem, etc.)
- Switching between OpenAI/Anthropic/Ollama requires only config change
- Adding a custom tool takes <50 lines of code
- CLI response time <500ms for simple queries (excluding LLM latency)

## Open Questions (Resolved)

| Question                   | Decision        | Notes                                                    |
| -------------------------- | --------------- | -------------------------------------------------------- |
| SSE-based MCP servers?     | Yes, later      | stdio first, SSE in future version                       |
| Context window management? | Handoffs/pickup | Use handoff command to persist context, pickup to resume |
| Plugin sandboxing?         | Yes, later      | No sandboxing in v1, add later for security              |

## Implementation Order

1. **Phase 1:** Project setup, config system, LLM providers (US-001, US-002, US-003)
2. **Phase 2:** Tool system and core tools (US-004, US-005, US-006, US-007, US-008)
3. **Phase 3:** MCP client integration (US-009)
4. **Phase 4:** Agent loop and CLI (US-010, US-011, US-013)
5. **Phase 5:** Plugin system (US-012)
