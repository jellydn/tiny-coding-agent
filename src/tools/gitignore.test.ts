import { describe, it, expect, beforeEach } from "bun:test";
import {
  parseGitignore,
  isIgnored,
  findGitignorePatterns,
  clearPatternCache,
} from "./gitignore.js";

describe("gitignore", () => {
  beforeEach(() => {
    clearPatternCache();
  });

  describe("parseGitignore()", () => {
    it("should parse basic patterns", () => {
      const content = `
node_modules/
*.log
dist
.env
`;
      const patterns = parseGitignore(content);

      expect(patterns.length).toBe(4);
    });

    it("should handle comments", () => {
      const content = `
# This is a comment
node_modules/ # inline comment
`;
      const patterns = parseGitignore(content);

      expect(patterns.length).toBe(1);
    });

    it("should handle negated patterns", () => {
      const content = `
*.log
!important.log
`;
      const patterns = parseGitignore(content);

      expect(patterns.length).toBe(2);
      expect(patterns[0]?.negate).toBe(false);
      expect(patterns[1]?.negate).toBe(true);
    });

    it("should handle globstar patterns", () => {
      const content = `
**/*.log
build/**/*.js
`;
      const patterns = parseGitignore(content);

      expect(patterns.length).toBe(2);
    });
  });

  describe("isIgnored()", () => {
    function testIgnore(content: string, filePath: string, expected: boolean) {
      const patterns = parseGitignore(content);
      const result = isIgnored(filePath, patterns, false);
      expect(result).toBe(expected);
    }

    it("should match *.log patterns", () => {
      testIgnore("*.log", "error.log", true);
      testIgnore("*.log", "debug.log", true);
      testIgnore("*.log", "test.txt", false);
    });

    it("should match *.log in subdirectories", () => {
      testIgnore("*.log", "src/error.log", true);
      testIgnore("*.log", "path/to/debug.log", true);
    });

    it("should match directory patterns", () => {
      const content = `node_modules/`;
      const patterns = parseGitignore(content);

      expect(isIgnored("node_modules", patterns, true)).toBe(true);
      expect(isIgnored("src/node_modules", patterns, true)).toBe(true);
    });

    it("should match **/*.log patterns in subdirectories", () => {
      const content = `**/*.log`;
      const patterns = parseGitignore(content);

      expect(isIgnored("src/error.log", patterns, false)).toBe(true);
      expect(isIgnored("path/to/file.log", patterns, false)).toBe(true);
      expect(isIgnored("error.log", patterns, false)).toBe(false);
    });

    it("should handle negated patterns", () => {
      const content = `
*.log
!important.log
`;
      const patterns = parseGitignore(content);

      expect(isIgnored("error.log", patterns, false)).toBe(true);
      expect(isIgnored("important.log", patterns, false)).toBe(false);
    });

    it("should match exact file patterns", () => {
      const content = `package.json`;
      const patterns = parseGitignore(content);

      expect(isIgnored("package.json", patterns, false)).toBe(true);
      expect(isIgnored("src/package.json", patterns, false)).toBe(true);
    });

    it("should match build output patterns", () => {
      const content = `
dist/
build/
*.log
*.tmp
`;
      const patterns = parseGitignore(content);

      expect(isIgnored("dist", patterns, true)).toBe(true);
      expect(isIgnored("build", patterns, true)).toBe(true);
      expect(isIgnored("error.log", patterns, false)).toBe(true);
      expect(isIgnored("debug.tmp", patterns, false)).toBe(true);
    });
  });

  describe("findGitignorePatterns()", () => {
    it("should return empty array when no .gitignore exists", async () => {
      const patterns = await findGitignorePatterns("/tmp");
      expect(patterns).toEqual([]);
    });
  });

  describe("real-world .gitignore patterns", () => {
    it("should handle Node.js project patterns", () => {
      const content = `
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.env
.env.*
dist/
build/
coverage/
.nyc_output/
*.log
`;
      const patterns = parseGitignore(content);

      expect(isIgnored("node_modules", patterns, true)).toBe(true);
      expect(isIgnored("src/node_modules", patterns, true)).toBe(true);
      expect(isIgnored("npm-debug.log", patterns, false)).toBe(true);
      expect(isIgnored("yarn-error.log", patterns, false)).toBe(true);
      expect(isIgnored(".env", patterns, false)).toBe(true);
      expect(isIgnored(".env.local", patterns, false)).toBe(true);
      expect(isIgnored("dist", patterns, true)).toBe(true);
      expect(isIgnored("build", patterns, true)).toBe(true);
      expect(isIgnored("error.log", patterns, false)).toBe(true);
      expect(isIgnored("src/error.log", patterns, false)).toBe(true);
      expect(isIgnored("package.json", patterns, false)).toBe(false);
    });

    it("should handle TypeScript project patterns", () => {
      const content = `
# Dependencies
node_modules/

# Build outputs
dist/
build/

# IDE
.idea/
.vscode/
*.swp
*.swo

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# OS
.DS_Store
Thumbs.db
`;
      const patterns = parseGitignore(content);

      expect(isIgnored("node_modules", patterns, true)).toBe(true);
      expect(isIgnored("src/node_modules", patterns, true)).toBe(true);
      expect(isIgnored("dist", patterns, true)).toBe(true);
      expect(isIgnored("build", patterns, true)).toBe(true);
      expect(isIgnored(".env", patterns, false)).toBe(true);
      expect(isIgnored(".env.local", patterns, false)).toBe(true);
      expect(isIgnored(".env.production", patterns, false)).toBe(false);
      expect(isIgnored("error.log", patterns, false)).toBe(true);
      expect(isIgnored("src/error.log", patterns, false)).toBe(true);
      expect(isIgnored(".DS_Store", patterns, false)).toBe(true);
      expect(isIgnored("src/main.ts", patterns, false)).toBe(false);
    });
  });
});
