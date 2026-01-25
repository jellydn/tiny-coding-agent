# Tiny Coding Agent - Security Documentation

## Overview

Tiny Coding Agent is an AI-powered assistant that can execute code, read files, and run shell commands. This document outlines security considerations, risks, and best practices for users and plugin developers.

---

## Agent Capabilities & Risks

### File Operations

- **Read**: Agent can read any file accessible to the current user
- **Write/Edit**: Agent can create and modify files
- **Risk**: Accidental or malicious modification of critical system files

### Command Execution

- **Bash Tool**: Agent executes shell commands with user's permissions
- **Risk**: Command injection, unintended system modifications, credential exposure

### Network Access

- **Web Search**: Agent performs web searches via DuckDuckGo scraping
- **HTTP Requests**: Tools may make arbitrary HTTP requests
- **Risk**: Data exfiltration, accessing malicious resources

---

## Plugin Security

### How Plugins Work

Plugins are loaded dynamically from `~/.tiny-agent/plugins/` using ES module imports:

```typescript
const module = (await import(`file://${filePath}`)) as PluginModule;
```

### Risks

1. **Arbitrary Code Execution**: Plugins run with the agent's full permissions
2. **No Sandbox**: Plugins have unrestricted access to filesystem, network, and subprocesses
3. **No Verification**: Plugin code is not signed or verified before execution

### Best Practices for Plugin Users

1. **Review Plugin Source**: Always read plugin code before installation
2. **Use Trusted Sources**: Only install plugins from authors you trust
3. **Run in Isolated Environment**: Consider using containers or VMs for untrusted plugins
4. **Check Permissions**: Be aware of what permissions the agent has when running plugins

### Best Practices for Plugin Authors

1. **Minimize Permissions**: Request only the capabilities you need
2. **Validate Inputs**: Sanitize all user inputs and LLM-generated content
3. **Avoid Command Injection**: Never concatenate shell commands from untrusted sources
4. **Document Security**: Clearly document any security implications in your plugin README

---

## Environment Variable Filtering

The agent filters sensitive environment variables before passing them to shell commands.

### Current Approach (Blocklist)

The agent uses a pattern-based blocklist to filter secrets:

```typescript
const patterns = [/api/i, /key/i, /secret/i, /token/i, /password/i];
```

### Limitations

- **Incomplete Coverage**: New or unusual secret naming conventions may be missed
- **False Negatives**: Sensitive values with innocuous names may leak
- **False Positives**: Legitimate variables may be filtered unnecessarily

### Recommendations

- **Use Environment Files**: Store secrets in `.env` files that are not loaded into agent sessions
- **Audit Environment**: Review environment variables before starting agent sessions
- **Prefer Allowlists**: For production use, configure an explicit allowlist of allowed variables

---

## Path Traversal Protection

### Current Protections

The agent validates file paths to prevent directory traversal attacks:

- Resolves paths to absolute form
- Checks for path traversal patterns (`..`, symbolic links)
- Validates files exist before operations

### Limitations

- **Edit Tool**: The `edit_file` tool does not validate `old_str` for path traversal patterns
- **Follows Symlinks**: The agent may follow symbolic links to unexpected locations

### Recommendations

- **Be Explicit**: Always use absolute paths in agent requests
- **Review Symlinks**: Be aware of symbolic links in working directories
- **Use Chroot**: For untrusted workloads, consider running the agent in a chroot jail

---

## Web Search Risks

### Current Implementation

The agent scrapes DuckDuckGo HTML results using regex patterns.

### Risks

- **Fragile**: Changes to DuckDuckGo HTML structure will break search
- **No Rate Limiting**: Could be blocked by DuckDuckGo for excessive requests
- **Data Privacy**: Search queries are sent to DuckDuckGo without encryption

### Future Improvements

- **Official APIs**: Migrate to official search APIs (Bing, Google Custom Search, Tavily)
- **Rate Limiting**: Implement proper rate limiting and backoff
- **User Control**: Allow users to opt-out of web search or configure their own API keys

---

## LLM Provider Security

### API Key Handling

API keys are stored in configuration files and loaded into memory.

### Recommendations

1. **Rotate Keys Regularly**: Use short-lived API keys when possible
2. **Use Environment Variables**: Store API keys in environment, not config files
3. **Restrict Key Permissions**: Limit API key scopes to minimum required permissions
4. **Monitor Usage**: Review API usage logs for suspicious activity

### Data Privacy

- **Conversation Content**: Sent to LLM providers for processing
- **Memory Data**: May include sensitive information from previous sessions
- **Code Context**: File contents are shared with LLM providers

### Recommendations

- **Review Prompts**: Be aware that all agent prompts are shared with LLM providers
- **Local Models**: Use local models (Ollama) for sensitive codebases
- **Enterprise Agreements**: Ensure appropriate data processing agreements for code sent to cloud providers

---

## Security Checklist

Before running the agent on sensitive systems:

- [ ] Review and limit agent's file system permissions
- [ ] Audit environment variables for secrets
- [ ] Review all installed plugins
- [ ] Consider using a container or isolated environment
- [ ] Configure API key restrictions with LLM providers
- [ ] Enable verbose logging to monitor agent actions
- [ ] Test agent behavior in non-production environment first

---

## Reporting Security Issues

If you discover a security vulnerability, please email security@tiny-agent.dev with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if known)

Do not open public issues for security vulnerabilities.

---

_Last updated: 2026-01-25_
