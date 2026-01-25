import type { StatusLineStatus } from "./contexts/StatusLineContext.js";

export interface StatusLineState {
	status?: StatusLineStatus;
	model?: string;
	tokensUsed?: number;
	tokensMax?: number;
	tool?: string;
	mcpServerCount?: number;
}

type StatusLineListener = (state: StatusLineState) => void;

class StatusLineManager {
	private state: StatusLineState = {};
	private listeners: Set<StatusLineListener> = new Set();
	private _showStatusLine = true;

	getState(): Readonly<StatusLineState> {
		return this.state;
	}

	get showStatusLine(): boolean {
		return this._showStatusLine;
	}

	subscribe(listener: StatusLineListener): () => void {
		this.listeners.add(listener);
		// Immediately notify with current state so late subscribers get initial values
		listener(this.getState());
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener(this.getState());
		}
	}

	setShowStatusLine(show: boolean): void {
		this._showStatusLine = show;
		this.notify();
	}

	setStatus(status?: StatusLineStatus): void {
		this.state.status = status;
		this.notify();
	}

	setModel(model?: string): void {
		this.state.model = model;
		this.notify();
	}

	setContext(used?: number, max?: number): void {
		this.state.tokensUsed = used;
		this.state.tokensMax = max;
		this.notify();
	}

	setTool(tool?: string): void {
		this.state.tool = tool;
		this.notify();
	}

	clearTool(): void {
		this.setTool(undefined);
	}

	setMcpServerCount(count?: number): void {
		this.state.mcpServerCount = count;
		this.notify();
	}

	reset(): void {
		this.state = {};
		this.notify();
	}
}

export const statusLineManager = new StatusLineManager();

export function getStatusLineState(): StatusLineState {
	return statusLineManager.getState();
}

export function subscribeToStatusLine(listener: StatusLineListener): () => void {
	return statusLineManager.subscribe(listener);
}
