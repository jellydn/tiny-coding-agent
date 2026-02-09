# Tiny Coding Agent Development Tasks
# Requires: just (https://github.com/casey/just)
# Install: cargo install just OR brew install just

# List available recipes
default:
    @just --list

# Run in watch mode
dev:
    bun --watch index.ts

# Generate embedded skills
generate-skills:
    bun run scripts/generate-embedded-skills.ts

# Build the binary
build: generate-skills
    bun build index.ts --compile --outfile=tiny-agent

# Run all tests
test:
    bun test

# Run tests in watch mode
test-watch:
    bun test --watch

# Run specific test file (e.g., just test-file tools/file.test.ts)
test-file FILE:
    bun test {{FILE}}

# Run tests matching pattern (e.g., just test-pattern memory)
test-pattern PATTERN:
    bun test {{PATTERN}}

# Type check
typecheck:
    bun run tsc --noEmit

# Lint code
lint:
    biome check .

# Lint and auto-fix issues
lint-fix:
    biome check --write --unsafe .

# Format code
format:
    biome format . --write

# Check formatting without modifying files
format-check:
    biome format .

# Run all checks (test, typecheck, lint)
pre: test check

# Release patch version (bumps x.y.Z)
release-patch: pre
    bunx bumpp patch --yes

# Release minor version (bumps x.Y.z)
release-minor: pre
    bunx bumpp minor --yes

# Release major version (bumps X.y.z)
release-major: pre
    bunx bumpp major --yes

# Install dependencies
install:
    bun install

# Clean build artifacts
clean:
    rm -f tiny-agent

# Run the built binary
run *ARGS:
    ./tiny-agent {{ARGS}}

# Full development cycle: clean, install, build, test
cycle: clean install build test

# Quick check: lint and type check
check: lint typecheck
