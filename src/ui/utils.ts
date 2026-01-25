export function isTTY(): boolean {
	return process.stdout.isTTY === true && process.stdin.isTTY === true;
}

interface UIContext {
	noColor: boolean;
	jsonMode: boolean;
}

let currentContext: UIContext = { noColor: false, jsonMode: false };

export function setUIContext(ctx: Partial<UIContext>): void {
	currentContext = { ...currentContext, ...ctx };
}

export function setNoColor(value: boolean): void {
	currentContext.noColor = value;
}

export function setJsonMode(value: boolean): void {
	currentContext.jsonMode = value;
}

export function isJsonMode(): boolean {
	return currentContext.jsonMode;
}

export function resetUIContext(): void {
	currentContext = { noColor: false, jsonMode: false };
}

export function shouldUseInk(): boolean {
	return !currentContext.noColor && !currentContext.jsonMode && isTTY();
}

export function formatTimestamp(date: Date = new Date()): string {
	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
