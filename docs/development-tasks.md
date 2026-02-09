# Development Task Runners

This project includes both a **Makefile** and a **Justfile** for convenient development workflows. Both provide the same functionality - choose whichever you prefer!

## Quick Comparison

| Feature | Make | Just |
|---------|------|------|
| Availability | Pre-installed on most Unix systems | Needs installation (`cargo install just` or `brew install just`) |
| Syntax | Traditional Makefile syntax | Modern, cleaner syntax |
| Help | `make help` | `just` (default lists all recipes) |

## Installation

### Make
Usually pre-installed on macOS and Linux. No installation needed.

### Just
```bash
# Using cargo
cargo install just

# Using Homebrew (macOS)
brew install just

# More options: https://github.com/casey/just#installation
```

## Available Commands

All commands work with both `make` and `just`:

### Development
- `make dev` / `just dev` - Run in watch mode
- `make build` / `just build` - Build the binary
- `make generate-skills` / `just generate-skills` - Generate embedded skills

### Testing
- `make test` / `just test` - Run all tests
- `make test-watch` / `just test-watch` - Run tests in watch mode

**Just only:**
- `just test-file <file>` - Run specific test file (e.g., `just test-file tools/file.test.ts`)
- `just test-pattern <pattern>` - Run tests matching pattern (e.g., `just test-pattern memory`)

### Code Quality
- `make typecheck` / `just typecheck` - Type check
- `make lint` / `just lint` - Lint code
- `make lint-fix` / `just lint-fix` - Lint and auto-fix issues
- `make format` / `just format` - Format code
- `make format-check` / `just format-check` - Check formatting without modifying
- `make check` / `just check` - Quick check (lint + typecheck)
- `make pre` / `just pre` - Run all checks (test, typecheck, lint)

### Release
- `make release-patch` / `just release-patch` - Release patch version (x.y.Z)
- `make release-minor` / `just release-minor` - Release minor version (x.Y.z)
- `make release-major` / `just release-major` - Release major version (X.y.z)

### Utilities
- `make install` / `just install` - Install dependencies
- `make clean` / `just clean` - Clean build artifacts
- `make cycle` / `just cycle` - Full development cycle (clean, install, build, test)

**Just only:**
- `just run [args]` - Run the built binary with optional arguments

## Examples

```bash
# Using Make
make dev                    # Start development mode
make build                  # Build the project
make test                   # Run tests
make check                  # Quick quality check

# Using Just
just dev                    # Start development mode
just build                  # Build the project
just test                   # Run tests
just test-file test/utils/xml.test.ts  # Run specific test
just check                  # Quick quality check
just run --help            # Run built binary with args

# Common workflows
make clean && make build && make test    # Clean rebuild and test
just cycle                              # Same thing with just
just test-file test/utils/xml.test.ts   # Run specific test file
```

## Why Both?

- **Makefile**: Maximum compatibility - works everywhere without installation
- **Justfile**: Better developer experience with cleaner syntax and more features

Choose the one that fits your workflow!
