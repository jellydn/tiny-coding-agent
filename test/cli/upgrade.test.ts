import { describe, expect, it } from "bun:test";
import { parseGitHubRelease } from "../../src/cli/handlers/upgrade.js";
import { parseArgs } from "../../src/cli/shared.js";

// Helper function for semantic version comparison
function compareVersions(v1: string, v2: string): number {
	const parts1 = v1.split(".").map(Number);
	const parts2 = v2.split(".").map(Number);

	for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
		const p1 = parts1[i] ?? 0;
		const p2 = parts2[i] ?? 0;
		if (p1 > p2) return 1;
		if (p1 < p2) return -1;
	}
	return 0;
}

// Helper function for platform binary name detection
function getPlatformBinaryName(platform: string, arch: string): string | null {
	if (platform === "linux" && arch === "x64") return "tiny-agent-linux-x64";
	if (platform === "linux" && arch === "arm64") return "tiny-agent-linux-arm64";
	if (platform === "darwin" && arch === "x64") return "tiny-agent-darwin-x64";
	if (platform === "darwin" && arch === "arm64") return "tiny-agent-darwin-arm64";
	return null;
}

describe("upgrade flag parsing", () => {
	it("should parse --upgrade flag", () => {
		const result = parseArgs(["--upgrade"]);
		expect(result.options.upgrade).toBe(true);
	});

	it("should combine --upgrade with other flags", () => {
		const result = parseArgs(["--upgrade", "--verbose"]);
		expect(result.options.upgrade).toBe(true);
		expect(result.options.verbose).toBe(true);
	});

	it("should not set upgrade when not provided", () => {
		const result = parseArgs(["run", "test"]);
		expect(result.options.upgrade).toBeUndefined();
	});

	it("should parse --upgrade before command", () => {
		const result = parseArgs(["--upgrade"]);
		expect(result.options.upgrade).toBe(true);
		expect(result.command).toBe("chat"); // default command
	});
});

describe("upgrade utility functions", () => {
	describe("parseGitHubRelease", () => {
		const validRelease = {
			tag_name: "v1.2.3",
			name: "Release 1.2.3",
			assets: [
				{ name: "tiny-agent-linux-x64", browser_download_url: "https://example.com/linux-x64" },
				{ name: "tiny-agent-darwin-arm64", browser_download_url: "https://example.com/darwin-arm64" },
			],
		};

		it("accepts a well-formed release payload", () => {
			const parsed = parseGitHubRelease(validRelease);
			expect(parsed.tag_name).toBe("v1.2.3");
			expect(parsed.assets.length).toBe(2);
		});

		it("rejects null payload", () => {
			expect(() => parseGitHubRelease(null)).toThrow(/Invalid response/);
		});

		it("rejects non-object payload", () => {
			expect(() => parseGitHubRelease("not an object")).toThrow(/Invalid response/);
			expect(() => parseGitHubRelease(42)).toThrow(/Invalid response/);
		});

		it("rejects payload missing tag_name", () => {
			const { tag_name: _omit, ...rest } = validRelease;
			expect(() => parseGitHubRelease(rest)).toThrow(/Invalid response/);
		});

		it("rejects payload with non-string tag_name", () => {
			expect(() => parseGitHubRelease({ ...validRelease, tag_name: 123 })).toThrow(/Invalid response/);
		});

		it("rejects payload missing assets", () => {
			const { assets: _omit, ...rest } = validRelease;
			expect(() => parseGitHubRelease(rest)).toThrow(/Invalid response/);
		});

		it("rejects payload with non-array assets", () => {
			expect(() => parseGitHubRelease({ ...validRelease, assets: "nope" })).toThrow(/Invalid response/);
		});

		it("rejects asset missing name", () => {
			const bad = { ...validRelease, assets: [{ browser_download_url: "x" }] };
			expect(() => parseGitHubRelease(bad)).toThrow(/Invalid asset shape/);
		});

		it("rejects asset missing browser_download_url", () => {
			const bad = { ...validRelease, assets: [{ name: "tiny-agent-linux-x64" }] };
			expect(() => parseGitHubRelease(bad)).toThrow(/Invalid asset shape/);
		});

		it("rejects asset with non-string name", () => {
			const bad = { ...validRelease, assets: [{ name: 123, browser_download_url: "x" }] };
			expect(() => parseGitHubRelease(bad)).toThrow(/Invalid asset shape/);
		});
	});

	describe("version comparison", () => {
		it("should correctly compare equal versions", () => {
			expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
			expect(compareVersions("2.1.3", "2.1.3")).toBe(0);
		});

		it("should correctly compare newer versions", () => {
			expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
			expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
			expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
			expect(compareVersions("1.9.0", "1.10.0")).toBe(-1); // Important: handles double-digit versions
		});

		it("should correctly compare older versions", () => {
			expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
			expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
			expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
		});
	});

	describe("platform detection", () => {
		it("should detect supported platforms", () => {
			expect(getPlatformBinaryName("linux", "x64")).toBe("tiny-agent-linux-x64");
			expect(getPlatformBinaryName("linux", "arm64")).toBe("tiny-agent-linux-arm64");
			expect(getPlatformBinaryName("darwin", "x64")).toBe("tiny-agent-darwin-x64");
			expect(getPlatformBinaryName("darwin", "arm64")).toBe("tiny-agent-darwin-arm64");
		});

		it("should return null for unsupported platforms", () => {
			expect(getPlatformBinaryName("win32", "x64")).toBeNull();
			expect(getPlatformBinaryName("freebsd", "x64")).toBeNull();
		});
	});
});
