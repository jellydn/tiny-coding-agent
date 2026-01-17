# Release Process

## Version Bumping with Bumpp

This project uses [bumpp](https://github.com/antfu-collective/bumpp) for automated version bumping and releases.

### Quick Release

Run one of these commands to create a release:

```bash
# Patch release (0.1.0 → 0.1.1)
bun run release:patch

# Minor release (0.1.0 → 0.2.0)
bun run release:minor

# Major release (0.1.0 → 1.0.0)
bun run release:major
```

Each release command:

1. Runs full test suite
2. Runs type checking
3. Runs linting
4. Bumps version in package.json
5. Creates git commit with conventional message
6. Creates git tag (v{version})
7. Pushes to remote

### Manual Bump

For more control over the bump process:

```bash
# Preview without committing
bunx bumpp --dry-run patch

# Bump with specific version
bunx bumpp 0.2.0

# Skip confirmation prompts
bunx bumpp patch --yes
```

### Custom Bump

Use bunx bumpp directly for interactive mode:

```bash
bunx bumpp
```

This will show an interactive menu with options:

- Next version (auto-detected based on commits)
- Major/minor/patch
- Pre-release versions (alpha, beta, rc)
- Custom version

## GitHub Release Workflow

When you push a version tag (e.g., `v0.1.1`), the GitHub Actions workflow in `.github/workflows/release.yml` automatically:

1. Runs tests on multiple platforms
2. Builds binaries for:
   - Linux x64
   - Linux ARM64
   - macOS x64
   - macOS ARM64
3. Creates GitHub release with:
   - All platform binaries
   - SHA256 checksums
   - Auto-generated release notes

## Configuration

Bumpp is configured in `bump.config.ts`:

```typescript
import { defineConfig } from "bumpp";

export default defineConfig({
  files: ["package.json"],
  commit: "chore(release): v{newVersion}",
  tag: "v{newVersion}",
  push: true,
  confirm: true,
});
```

## Pre-Release Testing

Before bumping version, run the pre-check script:

```bash
bun run pre
```

This runs all tests, type checking, and linting to ensure code quality.
