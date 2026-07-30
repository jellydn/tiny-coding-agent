/**
 * config-template.ts — default configuration template for tiny-coding-agent.
 *
 * Extracted from loader.ts (Round 7 Candidate #3) so the template is
 * testable without file I/O and loader.ts focuses on reading, merging,
 * and env-var resolution.
 */

/**
 * Generate the default YAML config template written to disk on first run.
 * Returns the string content; the caller handles file I/O.
 */
export function generateDefaultYaml(): string {
	return `# Tiny Agent Configuration
# See https://github.com/jellydn/tiny-coding-agent for full docs

# Default model to use
defaultModel: qwen3-coder-next:cloud

# Provider configurations
providers:
  ollama:
    baseUrl: http://localhost:11434
  # openai:
  #   apiKey: \${OPENAI_API_KEY}
  # anthropic:
  #   apiKey: \${ANTHROPIC_API_KEY}
  # opencode:
  #   apiKey: \${OPENCODE_API_KEY}
  # zai:
  #   apiKey: \${ZAI_API_KEY}
  # clinepass:
  #   apiKey: \${CLINE_API_KEY}

# MCP servers for extended capabilities
mcpServers:
  # Context7: Documentation lookups for libraries/frameworks (zero dependencies)
  context7:
    command: npx
    args: ["-y", "@upstash/context7-mcp"]

  # Serena: Semantic code operations (optional, requires uv)
  # Install: curl -LsSf https://astral.sh/uv/install.sh | sh
  # serena:
  #   command: uvx
  #   args:
  #     - "--from"
  #     - "git+https://github.com/oraios/serena"
  #     - "serena-mcp-server"
  #     - "--context"
  #     - "ide"
  #     - "--project"
  #     - "."
  #     - "--open-web-dashboard"
  #     - "false"

# Skill directories for custom skills
skillDirectories:
  - ~/.tiny-agent/skills/
  - .skills/

# Disable specific MCP tools by pattern (glob-style matching)
# disabledMcpPatterns:
#   - "mcp_serena_*memories*"    # Disable Serena memory tools
#   - "mcp_serena_*onboarding*"  # Disable Serena onboarding tools
`;
}
