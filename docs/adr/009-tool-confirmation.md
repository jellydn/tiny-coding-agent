# ADR 009: Tool Confirmation System

## Status

Accepted (Updated 2025-01)

## Context

The Tiny Coding Agent executes tools automatically without user confirmation. This can lead to unintended destructive operations such as:

- Overwriting or deleting files
- Running git commands that modify the repository
- Reading sensitive files (credentials, .env, SSH keys)
- Executing commands that modify the system

Users need a way to review and approve potentially dangerous operations before execution.

## Decision

Implement a confirmation system that:

1. Allows tools to declare themselves as "dangerous" with a dynamic description
2. Prompts the user for approval before executing dangerous tools
3. Supports batch approval (y/n for all), per-command approval (enter number)
4. Session-level tracking: once user says "y", remaining tools in same turn auto-approve
5. Can be bypassed with a `--allow-all` / `-y` flag for automation/CI

### Technical Design

#### Tool Interface Extension

```typescript
export type ToolDangerLevel =
  | boolean
  | string
  | ((args: Record<string, unknown>) => boolean | string | undefined);

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  dangerous?: ToolDangerLevel; // NEW
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
```

#### Confirmation Handler

- Singleton pattern for the confirmation handler (set in CLI layer)
- Handler receives a list of pending dangerous operations
- Returns `true` (approve all), `false` (deny all), or `{ type: "partial"; selectedIndex }` (per-command approval)
- Session state tracks "approved all" / "denied all" across multiple tool calls in same turn
- Session approval resets at the start of each user message

#### Tool Registry Changes

- `isDangerous(name, args)`: Check if a tool call requires confirmation (supports dynamic evaluation)
- `getDangerLevel(name, args)`: Get the danger description
- `executeBatch(calls)`: Execute tools with confirmation step

#### CLI Integration

- `--allow-all` / `-y` flag: Skip all confirmations
- Interactive mode: Prompt user with operation list
- Non-interactive mode (`run` command): No confirmations
- Content display: Shows full content for large fields (first 300 chars) with truncation notice

### Tool Classifications

**Destructive (High Risk)**

- `write_file`: Creates/overwrites files
- `edit_file`: Modifies existing files
- `bash`: Variable (detected via command analysis)

**Sensitive Files (Medium Risk)**

- `read_file`: Detects and prompts for `.env`, SSH keys, credentials, etc.

**External (Confirmation Required)**

- MCP tools: External server calls

**Safe (No Confirmation)**

- `read_file`: Regular files
- `list_directory`: Local, read-only
- `grep`: Filesystem search
- `glob`: Filesystem search
- `web_search`: External API call
- `bash`: Read-only commands (`git status`, `ls`, `cat`, `npm test`, etc.)

### Smart Bash Detection

The bash tool uses intelligent detection:

- **Read-only whitelist**: `git status`, `ls`, `cat`, `pwd`, `which`, `head`, `tail`, `find`, `echo`, `npm test`, `bun test`, `pytest`, etc. (no confirmation)
- **Destructive patterns**: `rm`, `mv`, `git commit`, `git push`, `git force-delete`, `git branch -D`, `rmdir`, file redirection `>`, `>>`, `<` (confirmation required)

### Gitignore Integration

The `grep` and `glob` tools respect `.gitignore` patterns:

- Parses `.gitignore` from project root and parent directories
- Skips files/directories matching gitignore patterns during recursive search
- Supports: basic patterns (`*.log`), directory patterns (`node_modules/`), globstar (`**/*.tmp`), negated patterns (`!important.log`)

### Sensitive File Detection

The `read_file` tool detects and prompts for sensitive files:

- `.env`, `.env.*` (excluding `.env.example`, `.env.sample`, `.env.template`, `.env.default`)
- `~/.aws/credentials`, `~/.aws/config`
- `~/.ssh/*`
- `~/.npmrc`
- `~/.git-credentials`, `~/.gitconfig`
- `/etc/passwd`, `/etc/shadow`
- `~/.pki/*`, `~/.gnupg/*`

## Consequences

### Positive

- Users have visibility into what operations will be performed
- Reduces risk of accidental file modification or deletion
- Flexible: can approve all at once, deny all, or approve individual commands
- Session tracking improves UX for batch operations
- Non-interactive workflows can bypass with `--allow-all`
- Gitignore support prevents searching/counting ignored files

### Negative

- Adds friction to the workflow (but only for dangerous operations)
- Additional code complexity in tool execution path
- Gitignore parsing adds slight overhead to search operations

### Trade-offs

- **Per-command vs. batch**: Chose to support both for flexibility with session-level tracking
- **Smart bash detection**: Added complexity but significantly improves UX for common read-only commands
- **Gitignore support**: Performance trade-off for better project integration
- **Singleton handler**: Simple but less testable; acceptable for CLI application

## Alternatives Considered

1. **Always confirm**: Too much friction, would frustrate users
2. **Never confirm**: Unsafe, defeats the purpose
3. **Config file**: Overkill for this use case, harder to manage
4. **Plugin system**: Too complex for the requirement
5. **Per-tool config**: YAML config for each tool - too verbose

## Implementation

See files:

- `src/tools/confirmation.ts`: Confirmation types, handler storage, session tracking
- `src/tools/types.ts`: Extended Tool interface
- `src/tools/registry.ts`: `executeBatch()` and danger detection
- `src/tools/gitignore.ts`: Gitignore parsing and pattern matching
- `src/tools/file-tools.ts`: Sensitive file detection for `read_file`
- `src/tools/bash-tool.ts`: Smart command detection
- `src/cli/main.ts`: Confirmation handler, `--allow-all` flag, interactive prompts
