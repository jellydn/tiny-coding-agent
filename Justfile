# Tiny Coding Agent - Development Commands
# Run `just` to see available commands

# Default: show available commands
default:
    @just --list

# Build dev version as tiny-dev-agent
build-dev:
    bun run generate:skills
    bun build index.ts --compile --outfile=tiny-dev-agent

# Build production version as tiny-agent
build:
    bun run build

# Run dev version directly (without compiling)
dev *ARGS:
    bun run index.ts {{ARGS}}

# Run dev version in watch mode
watch:
    bun --watch index.ts

# Run compiled dev agent
run-dev *ARGS:
    ./tiny-dev-agent {{ARGS}}

# Run compiled production agent
run *ARGS:
    ./tiny-agent {{ARGS}}

# Run tests
test *ARGS:
    bun test {{ARGS}}

# Run tests in watch mode
test-watch:
    bun test --watch

# Type check
typecheck:
    bun run typecheck

# Lint code
lint:
    bun run lint

# Lint and fix
lint-fix:
    bun run lint:fix

# Format code
format:
    bun run format

# Run all checks (test, typecheck, lint)
check:
    bun run pre

# Clean build artifacts
clean:
    rm -f tiny-agent tiny-dev-agent

# Rebuild dev version and run
rebuild-dev *ARGS: build-dev
    ./tiny-dev-agent {{ARGS}}

# Install to ~/.local/bin (dev version) - uses symlink to avoid macOS code signing issues
install-dev: build-dev
    rm -f ~/.local/bin/tiny-dev-agent
    ln -s "$(pwd)/tiny-dev-agent" ~/.local/bin/tiny-dev-agent

# Install to ~/.local/bin (production) - uses symlink to avoid macOS code signing issues
install: build
    rm -f ~/.local/bin/tiny-agent
    ln -s "$(pwd)/tiny-agent" ~/.local/bin/tiny-agent
