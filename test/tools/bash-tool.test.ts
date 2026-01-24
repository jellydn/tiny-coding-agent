import { describe, it, expect } from "bun:test";
import { isDestructiveCommand } from "@/tools/bash-tool.js";

describe("isDestructiveCommand()", () => {
  describe("read-only commands (safe)", () => {
    it("should return false for git status", () => {
      expect(isDestructiveCommand("git status")).toBe(false);
    });

    it("should return false for git log", () => {
      expect(isDestructiveCommand("git log")).toBe(false);
    });

    it("should return false for git show", () => {
      expect(isDestructiveCommand("git show HEAD")).toBe(false);
    });

    it("should return false for git diff", () => {
      expect(isDestructiveCommand("git diff")).toBe(false);
      expect(isDestructiveCommand("git diff main")).toBe(false);
    });

    it("should return false for ls", () => {
      expect(isDestructiveCommand("ls")).toBe(false);
      expect(isDestructiveCommand("ls -la")).toBe(false);
      expect(isDestructiveCommand("ls /tmp")).toBe(false);
    });

    it("should return false for dir", () => {
      expect(isDestructiveCommand("dir")).toBe(false);
    });

    it("should return false for cat", () => {
      expect(isDestructiveCommand("cat file.txt")).toBe(false);
    });

    it("should return false for head", () => {
      expect(isDestructiveCommand("head -10 file.txt")).toBe(false);
    });

    it("should return false for tail", () => {
      expect(isDestructiveCommand("tail -f log.txt")).toBe(false);
    });

    it("should return false for grep", () => {
      expect(isDestructiveCommand("grep pattern file.txt")).toBe(false);
    });

    it("should return false for find", () => {
      expect(isDestructiveCommand("find . -name '*.ts'")).toBe(false);
    });

    it("should return false for echo", () => {
      expect(isDestructiveCommand("echo hello")).toBe(false);
    });

    it("should return false for pwd", () => {
      expect(isDestructiveCommand("pwd")).toBe(false);
    });

    it("should return false for which", () => {
      expect(isDestructiveCommand("which node")).toBe(false);
    });

    it("should return false for file", () => {
      expect(isDestructiveCommand("file script.sh")).toBe(false);
    });

    it("should return false for stat", () => {
      expect(isDestructiveCommand("stat file.txt")).toBe(false);
    });

    it("should return false for npm test", () => {
      expect(isDestructiveCommand("npm test")).toBe(false);
    });

    it("should return false for npm run test", () => {
      expect(isDestructiveCommand("npm run test")).toBe(false);
    });

    it("should return false for bun test", () => {
      expect(isDestructiveCommand("bun test")).toBe(false);
    });

    it("should return false for pytest", () => {
      expect(isDestructiveCommand("pytest")).toBe(false);
    });

    it("should return false for git config", () => {
      expect(isDestructiveCommand("git config --list")).toBe(false);
      expect(isDestructiveCommand("git config --global --list")).toBe(false);
      expect(isDestructiveCommand("git config --local --list")).toBe(false);
      expect(isDestructiveCommand("git config user.name")).toBe(false);
    });

    it("should return false for git branch", () => {
      expect(isDestructiveCommand("git branch")).toBe(false);
      expect(isDestructiveCommand("git branch -a")).toBe(false);
      expect(isDestructiveCommand("git branch --show-current")).toBe(false);
    });

    it("should return false for git remote", () => {
      expect(isDestructiveCommand("git remote -v")).toBe(false);
      expect(isDestructiveCommand("git remote get-url origin")).toBe(false);
    });

    it("should return false for git tag", () => {
      expect(isDestructiveCommand("git tag")).toBe(false);
      expect(isDestructiveCommand("git tag -l 'v*'")).toBe(false);
    });

    it("should return false for git stash", () => {
      expect(isDestructiveCommand("git stash list")).toBe(false);
      expect(isDestructiveCommand("git stash show")).toBe(false);
    });

    it("should return false for git reflog", () => {
      expect(isDestructiveCommand("git reflog")).toBe(false);
      expect(isDestructiveCommand("git reflog -10")).toBe(false);
    });

    it("should return false for git describe", () => {
      expect(isDestructiveCommand("git describe")).toBe(false);
      expect(isDestructiveCommand("git describe --tags")).toBe(false);
    });

    it("should return false for redirections to /dev/null", () => {
      expect(isDestructiveCommand("git config --local --list 2>/dev/null")).toBe(false);
      expect(isDestructiveCommand("echo test > /dev/null")).toBe(false);
      expect(isDestructiveCommand("cat file.txt > /dev/null")).toBe(false);
      expect(isDestructiveCommand("cat < /dev/null")).toBe(false);
    });

    it("should return false for commands with leading/trailing whitespace", () => {
      expect(isDestructiveCommand("  git status  ")).toBe(false);
    });
  });

  describe("destructive patterns (dangerous)", () => {
    it("should return true for rm command", () => {
      expect(isDestructiveCommand("rm file.txt")).toBe(true);
      expect(isDestructiveCommand("rm -rf dir")).toBe(true);
      expect(isDestructiveCommand("rm file.txt file2.txt")).toBe(true);
    });

    it("should return true for mv command", () => {
      expect(isDestructiveCommand("mv old.txt new.txt")).toBe(true);
      expect(isDestructiveCommand("mv file dir/")).toBe(true);
    });

    it("should return true for git commit", () => {
      expect(isDestructiveCommand("git commit -m 'message'")).toBe(true);
      expect(isDestructiveCommand("git commit")).toBe(true);
    });

    it("should return true for git push", () => {
      expect(isDestructiveCommand("git push")).toBe(true);
      expect(isDestructiveCommand("git push origin main")).toBe(true);
    });

    it("should return true for git force-delete", () => {
      expect(isDestructiveCommand("git force-delete branch")).toBe(true);
    });

    it("should return true for git branch -D", () => {
      expect(isDestructiveCommand("git branch -D feature")).toBe(true);
    });

    it("should return true for git reset --hard", () => {
      expect(isDestructiveCommand("git reset --hard")).toBe(true);
      expect(isDestructiveCommand("git reset --hard HEAD~1")).toBe(true);
    });

    it("should return true for git clean -fd", () => {
      expect(isDestructiveCommand("git clean -fd")).toBe(true);
      expect(isDestructiveCommand("git clean -fdx")).toBe(true);
    });

    it("should return true for git rebase", () => {
      expect(isDestructiveCommand("git rebase main")).toBe(true);
      expect(isDestructiveCommand("git rebase -i HEAD~5")).toBe(true);
    });

    it("should return true for rmdir", () => {
      expect(isDestructiveCommand("rmdir empty_dir")).toBe(true);
    });

    it("should handle commands with extra spaces", () => {
      expect(isDestructiveCommand("  rm file.txt  ")).toBe(true);
    });
  });

  describe("other commands (safe - no match in either list)", () => {
    it("should return false for unknown safe commands", () => {
      expect(isDestructiveCommand("node script.js")).toBe(false);
      expect(isDestructiveCommand("python app.py")).toBe(false);
      expect(isDestructiveCommand("cargo build")).toBe(false);
      expect(isDestructiveCommand("go run main.go")).toBe(false);
    });

    it("should return false for git commands not in dangerous list", () => {
      expect(isDestructiveCommand("git branch")).toBe(false);
      expect(isDestructiveCommand("git checkout main")).toBe(false);
      expect(isDestructiveCommand("git checkout -")).toBe(false);
      expect(isDestructiveCommand("git stash")).toBe(false);
      expect(isDestructiveCommand("git reset HEAD~1")).toBe(false);
      expect(isDestructiveCommand("git reset --soft HEAD~1")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      expect(isDestructiveCommand("")).toBe(false);
    });

    it("should handle whitespace only", () => {
      expect(isDestructiveCommand("   ")).toBe(false);
    });

    it("should be case sensitive for command matching", () => {
      // Uppercase doesn't match read-only patterns and doesn't match destructive patterns
      expect(isDestructiveCommand("GIT STATUS")).toBe(false);
      // Uppercase RM doesn't match destructive pattern (case-sensitive regex)
      expect(isDestructiveCommand("RM file.txt")).toBe(false);
    });

    it("should handle commands with pipes and redirects", () => {
      // Pipe is not in destructive patterns
      expect(isDestructiveCommand("cat file.txt | grep pattern")).toBe(false);
      // Redirect to file IS in destructive patterns
      expect(isDestructiveCommand("echo test > file.txt")).toBe(true);
      expect(isDestructiveCommand("echo test >> file.txt")).toBe(true);
      // Redirect to /dev/null is safe
      expect(isDestructiveCommand("echo test > /dev/null")).toBe(false);
      expect(isDestructiveCommand("cat file.txt >> /dev/null")).toBe(false);
    });

    it("should detect input redirection as destructive", () => {
      expect(isDestructiveCommand("cat < file.txt")).toBe(true);
      expect(isDestructiveCommand("sort < unsorted.txt > sorted.txt")).toBe(true);
      // Input from /dev/null is safe
      expect(isDestructiveCommand("cat < /dev/null")).toBe(false);
    });
  });

  describe("command pattern matching", () => {
    it("should match read-only commands with arguments", () => {
      expect(isDestructiveCommand("git status --short")).toBe(false);
      expect(isDestructiveCommand("ls -la /tmp")).toBe(false);
      expect(isDestructiveCommand("cat -n file.txt")).toBe(false);
    });

    it("should not match partial read-only command patterns", () => {
      // "gity" is not "git status" and doesn't match destructive patterns
      expect(isDestructiveCommand("gity")).toBe(false);
      // "lsx" is not "ls" and doesn't match destructive patterns
      expect(isDestructiveCommand("lsx")).toBe(false);
    });

    it("should match destructive patterns with various arguments", () => {
      expect(isDestructiveCommand("rm -f file.txt")).toBe(true);
      expect(isDestructiveCommand("rm -rf /tmp/dir")).toBe(true);
      expect(isDestructiveCommand("mv -i old new")).toBe(true);
    });
  });
});
