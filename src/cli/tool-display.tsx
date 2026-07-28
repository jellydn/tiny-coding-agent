import { render } from "ink";
import { ToolOutput } from "../ui/components/ToolOutput.js";
import { shouldUseInk } from "../ui/utils.js";

const TOOL_PREVIEW_LINES = Number.parseInt(process.env.TINY_AGENT_TOOL_PREVIEW_LINES ?? "6", 10);

/**
 * ThinkingTagFilter — filters `<thinking>` tags from streaming content.
 * Handles partial tag boundaries across chunk boundaries.
 *
 * Extracted from main.tsx to make the partial-tag edge cases unit-testable
 * without importing the full CLI entry point.
 */
export class ThinkingTagFilter {
	private buffer = "";
	private pendingContent = "";

	filter(chunk: string): string {
		if (this.pendingContent.length > 0) {
			chunk = this.pendingContent + chunk;
			this.pendingContent = "";
		}
		this.buffer += chunk;
		let result = "";
		let lastIndex = 0;

		while (true) {
			const startIdx = this.buffer.indexOf("<thinking>", lastIndex);
			if (startIdx === -1) {
				break;
			}

			const endIdx = this.buffer.indexOf("</thinking>", startIdx + 11);
			if (endIdx === -1) {
				const contentBefore = this.buffer.slice(lastIndex, startIdx);
				if (contentBefore.length > 0) {
					result += `${contentBefore}\n`;
				}
				this.pendingContent = this.buffer.slice(startIdx);
				this.buffer = "";
				return result;
			}

			const contentBefore = this.buffer.slice(lastIndex, startIdx);
			result += contentBefore;
			const afterEnd = this.buffer.slice(endIdx + 11);
			if (contentBefore.length > 0 && afterEnd.length > 0 && !afterEnd.startsWith("<thinking>")) {
				result += "\n";
			}
			lastIndex = endIdx + 11;
		}

		result += this.buffer.slice(lastIndex);
		this.buffer = "";
		return result;
	}

	flush(): string {
		const remaining = this.buffer;
		this.buffer = "";
		this.pendingContent = "";
		return remaining;
	}
}

/** Format tool call arguments as a compact string for display. */
export function formatArgs(args: Record<string, unknown> | undefined): string {
	if (!args || Object.keys(args).length === 0) return "";
	const entries = Object.entries(args)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => {
			const str = typeof v === "string" ? v : JSON.stringify(v);
			if (str.length >= 80) {
				if (k === "content") {
					return `${k}=\n${str.slice(0, 80)}\n... (${str.length - 80} more chars)`;
				}
				return `${k}=${str.slice(0, 80)}...`;
			}
			return `${k}=${str}`;
		});
	return entries.length > 0 ? ` (${entries.join(", ")})` : "";
}

export type ToolExecutionDisplay = {
	name: string;
	status: "running" | "complete" | "error";
	args?: Record<string, unknown>;
	output?: string;
	error?: string;
};

function formatOutputPreview(output: string): string {
	const lines = output.split("\n");
	const preview =
		lines.length > TOOL_PREVIEW_LINES ? `${lines.slice(0, TOOL_PREVIEW_LINES).join("\n")}\n  ...` : output;
	return `  │ ${preview.split("\n").join("\n  │ ")}\n`;
}

function toolExecutionHeader(te: ToolExecutionDisplay, symbol: string): string {
	const argsStr = formatArgs(te.args);
	return `  [${symbol}] ${te.name}${argsStr}\n`;
}

function displayToolExecutionPlain(te: ToolExecutionDisplay): void {
	if (te.status === "running") {
		process.stdout.write(toolExecutionHeader(te, ""));
		return;
	}

	const symbol = te.status === "complete" ? "✓" : "✗";
	process.stdout.write(toolExecutionHeader(te, symbol));

	const outputToShow = te.status === "complete" ? te.output : te.error;
	if (outputToShow) {
		process.stdout.write(formatOutputPreview(outputToShow));
	}
}

function displayToolExecutionInk(te: ToolExecutionDisplay): void {
	if (te.status === "running") {
		return;
	}
	const success = te.status === "complete";
	const { unmount } = render(
		<ToolOutput name={te.name} success={success} output={te.output} error={te.error} args={te.args} />
	);
	unmount();
}

/**
 * Display a tool execution in the terminal — either as plain text or
 * rendered via Ink, depending on the terminal capabilities.
 */
export function displayToolExecution(te: ToolExecutionDisplay, useInk?: boolean): void {
	const ink = useInk ?? shouldUseInk();
	if (ink) {
		displayToolExecutionInk(te);
	} else {
		displayToolExecutionPlain(te);
	}
}

export interface JsonOutput {
	type: "user" | "assistant" | "tool";
	content: string;
	toolName?: string;
}

/** Output a JSON-encoded message for programmatic consumption (--json mode). */
export function outputJson(data: JsonOutput): void {
	console.log(JSON.stringify(data));
}
