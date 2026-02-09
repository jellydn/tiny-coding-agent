# Tiny Coding Agent Development Tasks
# Requires: make (usually pre-installed on Unix systems)

.PHONY: help dev generate-skills build test test-watch typecheck lint lint-fix format format-check pre release-patch release-minor release-major install clean run cycle check

# Default target: show help
help:
	@echo "Available targets:"
	@echo "  make dev              - Run in watch mode"
	@echo "  make generate-skills  - Generate embedded skills"
	@echo "  make build            - Build the binary"
	@echo "  make test             - Run all tests"
	@echo "  make test-watch       - Run tests in watch mode"
	@echo "  make typecheck        - Type check"
	@echo "  make lint             - Lint code"
	@echo "  make lint-fix         - Lint and auto-fix issues"
	@echo "  make format           - Format code"
	@echo "  make format-check     - Check formatting"
	@echo "  make pre              - Run all checks (test, typecheck, lint)"
	@echo "  make release-patch    - Release patch version"
	@echo "  make release-minor    - Release minor version"
	@echo "  make release-major    - Release major version"
	@echo "  make install          - Install dependencies"
	@echo "  make clean            - Clean build artifacts"
	@echo "  make cycle            - Full development cycle"
	@echo "  make check            - Quick check (lint + typecheck)"

# Run in watch mode
dev:
	bun --watch index.ts

# Generate embedded skills
generate-skills:
	bun run scripts/generate-embedded-skills.ts

# Build the binary
build:
	bun run generate:skills && bun build index.ts --compile --outfile=tiny-agent

# Run all tests
test:
	bun test

# Run tests in watch mode
test-watch:
	bun test --watch

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
pre:
	bun run test && bun run typecheck && bun run lint

# Release patch version (bumps x.y.Z)
release-patch:
	bun run test && bun run typecheck && bun run lint && bunx bumpp patch --yes

# Release minor version (bumps x.Y.z)
release-minor:
	bun run test && bun run typecheck && bun run lint && bunx bumpp minor --yes

# Release major version (bumps X.y.z)
release-major:
	bun run test && bun run typecheck && bun run lint && bunx bumpp major --yes

# Install dependencies
install:
	bun install

# Clean build artifacts
clean:
	rm -f tiny-agent

# Full development cycle: clean, install, build, test
cycle: clean install build test

# Quick check: lint and type check
check: lint typecheck
