import { chmod, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVersion } from "../../utils/version.js";

interface GitHubRelease {
	tag_name: string;
	name: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
	}>;
}

function getPlatformBinaryName(): string {
	const platform = process.platform;
	const arch = process.arch;

	if (platform === "linux" && arch === "x64") {
		return "tiny-agent-linux-x64";
	}
	if (platform === "linux" && arch === "arm64") {
		return "tiny-agent-linux-arm64";
	}
	if (platform === "darwin" && arch === "x64") {
		return "tiny-agent-darwin-x64";
	}
	if (platform === "darwin" && arch === "arm64") {
		return "tiny-agent-darwin-arm64";
	}

	throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
	const response = await fetch("https://api.github.com/repos/jellydn/tiny-coding-agent/releases/latest");

	if (!response.ok) {
		if (response.status === 403 || response.status === 429) {
			throw new Error(
				"GitHub API rate limit exceeded. Please try again later or set GITHUB_TOKEN environment variable."
			);
		}
		throw new Error(`Failed to fetch latest release: ${response.statusText}`);
	}

	const data: unknown = await response.json();
	return data as GitHubRelease;
}

async function downloadBinary(url: string, outputPath: string): Promise<void> {
	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Failed to download binary: ${response.statusText}`);
	}

	const buffer = await response.arrayBuffer();
	await writeFile(outputPath, new Uint8Array(buffer));
}

export async function handleUpgrade(): Promise<void> {
	const currentVersion = getVersion();
	console.log(`Current version: ${currentVersion}`);
	console.log("Checking for updates...\n");

	try {
		const latestRelease = await fetchLatestRelease();
		const latestVersion = latestRelease.tag_name.replace(/^v/, "");

		console.log(`Latest version: ${latestVersion}`);

		if (currentVersion === latestVersion) {
			console.log("✓ You are already on the latest version!");
			process.exit(0);
		}

		console.log(`\nNew version available: ${currentVersion} → ${latestVersion}`);
		console.log("Downloading update...");

		const binaryName = getPlatformBinaryName();
		const asset = latestRelease.assets.find((a) => a.name === binaryName);

		if (!asset) {
			throw new Error(`No binary found for ${binaryName}`);
		}

		const tempFile = join(tmpdir(), `tiny-agent-upgrade-${Date.now()}`);
		await downloadBinary(asset.browser_download_url, tempFile);

		await chmod(tempFile, 0o755);

		const currentBinary = process.execPath;
		const backupFile = `${currentBinary}.backup`;

		await rename(currentBinary, backupFile);

		try {
			await rename(tempFile, currentBinary);
			console.log("\n✓ Successfully upgraded to version", latestVersion);
			console.log("Please restart tiny-agent to use the new version.");
			process.exit(0);
		} catch (err) {
			await rename(backupFile, currentBinary);
			throw err;
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`\n✗ Upgrade failed: ${message}`);
		process.exit(1);
	}
}
