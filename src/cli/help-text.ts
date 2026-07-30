/**
 * Help text for the CLI.
 * Extracted from main.tsx to separate the help-content concern from the
 * command-routing concern.
 */

export function showHelp(): void {
	console.log(`
    ╔════════════════════════════════════════════════╗
    ║                                                ║
    ║            ◯                                   ║
    ║            │                                   ║
    ║     ┌──────┴──────┐                            ║
    ║     │  <      />  │   TINY CODING AGENT        ║
    ║     │             │                            ║
    ║     │     ___     │                            ║
    ║     └──────┴──────┘                            ║
    ║                                                ║
    ╚════════════════════════════════════════════════╝

A lightweight, extensible coding agent built in TypeScript.

USAGE:
    tiny-agent [command] [args...]     Run a command
    tiny-agent chat                    Interactive chat mode (default)
    tiny-agent run <prompt>            Run a single prompt
    tiny-agent trace <prompt>          Run a prompt and show observability metadata
    tiny-agent trace --mock <prompt>   Run the observability demo with a mock provider (no API key)
    tiny-agent config                  Show current configuration
    tiny-agent config open             Open config file in editor
    tiny-agent status                  Show provider and model capabilities
    tiny-agent login [provider]        Connect an LLM provider (onboarding)
    tiny-agent logout [provider]       Remove a provider's API key
    tiny-agent memory [command]        Manage memories
    tiny-agent skill [command]         Manage skills
    tiny-agent mcp [command]           Manage MCP servers
    tiny-agent hooks [command]         Manage lifecycle hooks (e.g. plannotator)
    tiny-agent review                  Review the current plan using configured hooks
    tiny-agent plan <task>             Generate a plan for a task
    tiny-agent build                   Execute the build plan from state file
    tiny-agent explore [task]          Explore and analyze codebase
    tiny-agent run-plan-build <task>   Run plan then build in sequence
    tiny-agent run-all <task>          Run plan, build, and explore in sequence
    tiny-agent state show              Show current state file
    tiny-agent state clear             Clear/reset state file
    tiny-agent plan show               Show the current plan
    tiny-agent tasks                   List all tasks with status
    tiny-agent todo                    Show current active task

COMMANDS:
    memory list                        List all stored memories
    memory add <content>               Add a new memory
    memory clear                       Clear all memories
    memory stats                       Show memory statistics
    skill list                         List all discovered skills
    skill show <name>                  Show full skill content
    skill init <name>                  Initialize a new skill
    mcp list                           List configured MCP servers
    mcp add <name> <cmd> [args...]     Add a new MCP server
    mcp enable <name>                  Enable an MCP server
    mcp disable <name>                 Disable an MCP server
    hooks list                         List all configured hooks
    hooks presets                      List available hook presets
    hooks install <preset>             Install a preset (e.g. plannotator)
    hooks enable <name>                Enable a hook
    hooks disable <name>               Disable a hook
    hooks remove <name>                Remove a hook
    state show                         Show current state file (JSON)
    state clear                        Clear/reset state file
    plan show                          Show the current plan
    tasks                              List all tasks with status
    todo                               Show current active task

OPTIONS:
    --model <model>                    Override default model
    --provider <provider>              Override provider (openai|anthropic|ollama|openrouter|opencode|zai|clinepass|qwencloud)
    --verbose, -v                      Enable verbose logging
    --save                             Save conversation to file
    --no-memory                        Disable memory (enabled by default)
    --no-track-context                 Disable context tracking (enabled by default)
    --no-status                        Disable status line
    --agents-md <path>                 Path to AGENTS.md file (auto-detected in cwd)
    --skills-dir <path>                Add a skill directory (can be used multiple times)
    --no-color                         Disable colored output (for pipes/non-TTY)
    --json                             Output messages as JSON (for programmatic use)
    --state-file <path>                Path to state file (default: .tiny-state.json)
    --allow-all, -y                    Auto-approve all tool executions
    --upgrade                          Upgrade to the latest version
    --help, -h                         Show this help message

EXAMPLES:
    tiny-agent                         Start interactive chat
    tiny-agent chat                    Start interactive chat explicitly
    tiny-agent run "Fix this bug"      Run a single prompt
    tiny-agent run --model claude-3-5-sonnet "Help me"  Use specific model
    tiny-agent config                  Show current configuration
    tiny-agent config open             Open config in editor
    tiny-agent login                   Connect a provider interactively
    tiny-agent login openai            Connect OpenAI directly
    tiny-agent logout openai           Remove OpenAI's API key
    tiny-agent login status            Show provider connection status
    tiny-agent logout status           Show provider connection status
    tiny-agent hooks install plannotator  Install plannotator plan review
    tiny-agent review                  Review current plan with hooks
    tiny-agent status                  Show provider and model capabilities
    tiny-agent --upgrade               Upgrade to the latest version
    tiny-agent --help                  Show this help message
    tiny-agent --no-memory run "Help me"  Run without memory
    tiny-agent --no-track-context run "Help me"  Run without context tracking
    tiny-agent --agents-md ./AGENTS.md run "Help me"  Run with AGENTS.md
    tiny-agent memory add "I prefer TypeScript"  Add a memory
    tiny-agent memory list             List all memories
    tiny-agent plan "Create a new API endpoint"  Generate a plan
    tiny-agent run-plan-build "Add user authentication"  Plan and build
    tiny-agent state show              Show current state file

CONFIG:
    ~/.tiny-agent/config.yaml          Configuration file
    tiny-agent config open             Open config in editor

For more information, visit: https://github.com/jellydn/tiny-coding-agent
  `);
}
