# ADR-006: Plugin System

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** huynhdung

## Context

Users need to extend the agent with custom tools without modifying core code.

## Decision

### Plugin Location

- Default: `~/.tiny-agent/plugins/`
- Configurable via `pluginsDir` in config

### Plugin Types

**1. Local File Plugin**

```
~/.tiny-agent/plugins/my-tool.ts
~/.tiny-agent/plugins/my-tool.js
```

**2. Directory Plugin**

```
~/.tiny-agent/plugins/my-tools/
├── index.ts
├── tool-a.ts
└── tool-b.ts
```

**3. NPM Package Plugin** (configured in config)

```yaml
plugins:
  - package: "@my-org/agent-tools"
    config:
      apiKey: ${MY_API_KEY}
```

### Plugin Loading

1. Scan plugins directory on startup
2. Dynamic import each plugin
3. Validate exported tools match `Tool` interface
4. Register valid tools with prefix: `plugin__{filename}__{toolname}`

### Security (v1 - No Sandboxing)

- Plugins run with full Node.js permissions
- User responsibility to trust installed plugins
- Sandboxing deferred to future version

### Future: Plugin Sandboxing

- Consider `vm2` or similar for isolation
- Restrict filesystem access
- Limit network access
- Timeout execution

## Consequences

**Positive:**

- Simple file-based plugin installation
- No special packaging required
- NPM integration for sharing plugins

**Negative:**

- No security isolation in v1 (trust-based)
- Dynamic imports can be slow
- Plugin errors can crash agent
