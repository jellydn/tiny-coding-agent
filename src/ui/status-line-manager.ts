import type { StatusLineStatus } from "./contexts/StatusLineContext.js";

export interface StatusLineState {
  status?: StatusLineStatus;
  model?: string;
  tokensUsed?: number;
  tokensMax?: number;
  tool?: string;
  toolStartTime?: number;
}

type StatusLineListener = (state: StatusLineState) => void;

class StatusLineManager {
  private state: StatusLineState = {};
  private listeners: Set<StatusLineListener> = new Set();

  getState(): StatusLineState {
    return { ...this.state };
  }

  subscribe(listener: StatusLineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
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
    if (tool) {
      this.state.tool = tool;
      this.state.toolStartTime = Date.now();
    } else {
      this.state.tool = undefined;
      this.state.toolStartTime = undefined;
    }
    this.notify();
  }

  clearTool(): void {
    this.state.tool = undefined;
    this.state.toolStartTime = undefined;
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
