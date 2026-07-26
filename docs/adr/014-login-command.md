# ADR-014: Login Command — Onboarding Design

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** huynhdung

## Context

New users must connect an LLM provider before `tiny-agent chat` works — the agent loop calls `createProvider()`, which throws `X provider requires apiKey in config` when no key is present. The only onboarding path was to hand-edit `~/.tiny-agent/config.yaml`, which is friction for a first-run experience.

The `login` command (added in commit `a494add`) provides an interactive onboarding flow: a provider picker, masked API key entry, and a `status` subcommand. Three design decisions in that implementation are non-obvious enough to warrant an ADR.

## Decisions

### 1. Top-level CLI command, dispatched before `loadConfig()`

The `login` command is dispatched in `main.tsx` **before** the `loadConfig()` call that every other command depends on:

```typescript
// main.tsx — login runs before loadConfig()
if (command === "login") {
  await handleLogin(args);
  return;
}

const config = loadConfig();
// ... all other commands use `config`
```

**Rationale:** Onboarding is the one case where a valid config does not yet exist. `loadConfig()` interpolates `${ENV_VAR}` references and validates the result — if the user has no provider configured, it either throws or returns a config with no usable provider. Dispatching `login` before that call lets the onboarding flow write the *first* valid config without needing a config to already exist. Every other command (`chat`, `run`, `status`, `config`, `mcp`, ...) runs after `loadConfig()` and assumes a config is available.

### 2. Chat `/login` is status-only — no in-chat key entry

The `/login` chat command (in `useCommandHandler.ts`) **only displays provider connection status** and points the user to the top-level `tiny-agent login` command. It does **not** prompt for an API key inside the Ink chat UI:

```typescript
// useCommandHandler.ts — /login shows status + guidance, does not collect keys
const status = formatProviderStatus(providerConfigs);
onAddMessage(
  MessageRole.ASSISTANT,
  `${status}\n\n` +
    `To connect a provider, exit and run:\n` +
    `  tiny-agent login          Interactive provider picker\n` +
    `  tiny-agent login openai    Connect a specific provider\n` +
    `  tiny-agent login status    Show this status again`
);
```

**Rationale:** The Ink chat UI uses a `TextInput` component that echoes typed characters to the terminal. There is no secure (masked) text input in the Ink UI layer. Implementing masked input inside Ink would require a new component with raw-mode stdin handling that bypasses Ink's rendering pipeline — significant complexity for a single use case. The top-level `login` command already has masked input via `promptHidden()` (raw-mode `*` echoing). Routing key entry to the top-level command keeps secrets out of the Ink render tree and reuses the existing secure input path.

### 3. Literal key storage with an env-var tip (not automatic env-var migration)

The `login` flow writes the API key as a **literal string** into `~/.tiny-agent/config.yaml`:

```yaml
providers:
  openai:
    apiKey: sk-...    # literal key, written by login
```

After a successful login, the command prints a tip advising the user to move the key to an environment variable:

```
Tip: For better security, store the key in an environment variable instead:
  1. Set apiKey: ${OPENAI_API_KEY} in config.yaml
  2. Export OPENAI_API_KEY=your-key in your shell profile.
```

**Rationale:** Automatically migrating the key to an environment variable would require (a) writing to the user's shell profile (`.zshrc` / `.bashrc`), which is intrusive and shell-specific, and (b) replacing the literal key with a `${OPENAI_API_KEY}` reference, which silently changes the user's config semantics. The config loader's `interpolateEnvVars()` already supports `${VAR}` references with a security check (`containsSensitivePattern` + `ALLOWED_PROVIDER_ENV_VARS` allowlist), so the env-var path is fully supported — but it must be opt-in. Storing the literal key first makes the "it just works" path zero-friction; the tip nudges security-conscious users toward the safer pattern without forcing it.

## Consequences

### Positive

- **Zero-friction onboarding:** `tiny-agent login` → pick provider → paste key → `tiny-agent chat` works. No manual YAML editing.
- **Secrets never enter the Ink render tree:** the chat UI cannot leak a key via a render glitch, scrollback, or a screenshot of the chat panel.
- **Onboarding is config-bootstrapping-safe:** `login` runs before `loadConfig()`, so a brand-new user with no config file can connect a provider on their very first command.
- **Env-var path remains first-class:** the config loader already interpolates `${VAR}` references, so users who follow the tip get the same behaviour with better security. No code change needed.
- **The `status` subcommand is useful beyond onboarding:** `tiny-agent login status` (and `/login` in chat) give a quick "which providers am I connected to?" view at any time.

### Negative

- **Two-step for env-var users:** a security-conscious user runs `login`, then manually edits the config to replace the literal key with `${OPENAI_API_KEY}` and exports the env var. A future `--use-env-var` flag could automate the reference swap (without touching the shell profile).
- **Literal key in a file on disk:** the config file at `~/.tiny-agent/config.yaml` contains the raw key until the user follows the tip. This is the standard trade-off for "just works" onboarding. The file is created with default `writeFile` permissions (typically `0644` via umask — **world-readable**), since neither `login`'s `writeConfigFile` nor the loader's `createDefaultConfig` pass a `mode` option. A future hardening should write the config with `0o600` (owner-only) when a literal key is stored.
- **No "test connection" step:** `login` saves the key without verifying it against the provider's API. A wrong or expired key is only discovered on the first `chat` call. A future enhancement could add a lightweight health-check call per provider.
- **`/login` in chat cannot fix a missing key:** a user who discovers they're not connected mid-chat must exit, run `tiny-agent login`, and restart. This is the accepted cost of keeping secrets out of the Ink UI.

### Trade-offs

- **Top-level vs. in-chat key entry:** chose top-level for secure input (raw-mode masking). The cost is the exit-and-restart flow for `/login` users. The benefit is no secrets in the Ink render tree.
- **Literal key vs. env-var-by-default:** chose literal for zero-friction. The cost is a raw key on disk until the user follows the tip. The benefit is "it just works" with no shell-profile modification.
- **Before `loadConfig()` vs. a bootstrap config:** chose dispatch-before-load to avoid a separate "empty config" code path. The cost is that `login` re-implements its own `readConfigFile`/`writeConfigFile` (mirroring `mcp.ts`) rather than using `loadConfig()`/`validateConfig()`. The benefit is onboarding works with no config file at all.

## Alternatives Considered

1. **In-chat masked `TextInput` component.** Rejected — would require a new Ink component with raw-mode stdin handling that bypasses Ink's rendering loop. High complexity for one use case, and the component would be a secrets-handling surface that needs its own security review.
2. **Automatic env-var migration on login.** Rejected — writing to `.zshrc`/`.bashrc` is intrusive and shell-specific. Silently replacing the literal key with `${OPENAI_API_KEY}` changes config semantics without the user's informed consent. The tip approach is opt-in.
3. **`login` as a subcommand of `config` (e.g., `tiny-agent config login`).** Rejected — `config` runs after `loadConfig()`, which assumes a valid config exists. Onboarding is the case where no valid config exists yet. Making `login` top-level and dispatching it before `loadConfig()` is the clean solution.
4. **A `--use-env-var` flag that writes `apiKey: ${OPENAI_API_KEY}` and prints the export command without touching the shell profile.** Deferred — a reasonable future enhancement. The current tip already documents the manual steps; the flag would reduce them to one command.
5. **Store the key in the system keychain (macOS Keychain / Linux secret-service).** Rejected for now — adds a native dependency and platform-specific code paths. The config file with `0600` permissions + env-var tip is the pragmatic baseline. Keychain integration could be revisited if the literal-key-on-disk concern becomes a blocker.

## Implementation

See files:

- `src/cli/handlers/login.ts` — `handleLogin()`, `LOGIN_PROVIDERS`, `promptHidden()` (masked input), `applyProviderToConfig()`, `readConfigFile`/`writeConfigFile` (config I/O), `formatProviderStatus()`.
- `src/cli/main.tsx` — `login` dispatch before `loadConfig()` (line ~616), help text, error message.
- `src/ui/hooks/useCommandHandler.ts` — `/login` chat command (status-only, delegates to top-level `login`).
- `src/ui/components/CommandMenu.tsx` — `/login` entry in the command picker.
- `src/core/agent.ts` — `getProviderConfigs()` getter used by the chat `/login` command.
- `test/cli/handlers/login.test.ts` — 30 unit tests (pure functions + `handleLogin(["status"])` smoke tests).

## Related Decisions

- **ADR-005: Tool System Design** — the `Tool` interface and `dangerous` routing. Not directly related, but the "keep secrets out of the render tree" principle echoes the confirmation system's "show the user what will happen before it happens" philosophy.
- **ADR-010: Ink CLI Integration** — the Ink UI architecture. This ADR's decision to keep key entry out of the chat UI is a constraint imposed by ADR-010's `TextInput`-based architecture (no secure input component).
- **ADR-013: ClinePass Live Model Lookup** — the most recent provider-related ADR. The `login` command's `LOGIN_PROVIDERS` list includes `clinepass` with `envVar: "CLINE_API_KEY"`, consistent with ADR-013's auth scheme.

## Future Considerations

- A `--use-env-var` flag on `tiny-agent login` that writes `apiKey: ${OPENAI_API_KEY}` to the config and prints the `export` command without modifying the shell profile (alternative 4).
- A "test connection" step that makes a lightweight API call (e.g., list models) to verify the key before saving it.
- Enforcing `0600` permissions on `~/.tiny-agent/config.yaml` after writing a literal key.
- System keychain integration for API key storage (alternative 5) — revisit if the literal-key-on-disk concern becomes a blocker.
- A `logout` command (the inverse of `login`) that removes the `apiKey` from a provider's config entry, with a default-model re-prompt if the logged-out provider was the active one.
