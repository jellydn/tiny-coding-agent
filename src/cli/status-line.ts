const SAVE_CURSOR = "\x1b[s";
const RESTORE_CURSOR = "\x1b[u";
const CLEAR_LINE = "\x1b[K";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const MOVE_TO_ROW = (row: number) => `\x1b[${row};1H`;

export interface StatusLineOptions {
  enabled?: boolean;
}

export interface StatusDisplay {
  status: "thinking" | "ready" | "error";
  model?: string;
  tokensUsed?: number;
  tokensMax?: number;
  toolName?: string;
  toolElapsed?: number;
}

export class StatusLine {
  private enabled: boolean;
  private lastLine: string = "";
  private attached: boolean = false;

  constructor(options: StatusLineOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  attach(): void {
    if (this.attached || !this.enabled) return;
    this.attached = true;
    process.stdout.write(HIDE_CURSOR);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.clear();
    process.stdout.write(SHOW_CURSOR);
  }

  update(display: StatusDisplay): void {
    if (!this.enabled) return;

    const line = this.format(display);
    if (line === this.lastLine) return;
    this.lastLine = line;

    const rows = process.stdout.rows || 24;
    process.stdout.write(
      SAVE_CURSOR +
        MOVE_TO_ROW(rows) +
        CLEAR_LINE +
        line +
        RESTORE_CURSOR,
    );
  }

  clear(): void {
    if (!this.enabled) return;
    this.lastLine = "";
    const rows = process.stdout.rows || 24;
    process.stdout.write(
      SAVE_CURSOR + MOVE_TO_ROW(rows) + CLEAR_LINE + RESTORE_CURSOR,
    );
  }

  private format(display: StatusDisplay): string {
    const parts: string[] = [];

    const statusIcon = this.formatStatus(display.status);
    parts.push(statusIcon);

    if (display.model) {
      const modelDisplay = this.formatModel(display.model);
      parts.push(modelDisplay);
    }

    if (display.tokensUsed !== undefined && display.tokensMax !== undefined) {
      const tokensDisplay = this.formatTokens(display.tokensUsed, display.tokensMax);
      parts.push(tokensDisplay);
    }

    if (display.toolName) {
      const toolDisplay = this.formatTool(display.toolName, display.toolElapsed);
      parts.push(toolDisplay);
    }

    return parts.join(" ");
  }

  private formatStatus(status: StatusDisplay["status"]): string {
    switch (status) {
      case "thinking":
        return "\x1b[33m⏳ Thinking\x1b[0m";
      case "ready":
        return "\x1b[32m✓ Ready\x1b[0m";
      case "error":
        return "\x1b[31m✗ Error\x1b[0m";
      default:
        return "";
    }
  }

  private formatModel(model: string): string {
    const truncated = model.length > 30 ? model.slice(0, 27) + "..." : model;
    return `Model: ${truncated}`;
  }

  private formatTokens(used: number, max: number): string {
    const usedDisplay = used >= 1000 ? `${(used / 1000).toFixed(1)}k` : String(used);
    const maxDisplay = max >= 1000 ? `${(max / 1000).toFixed(1)}k` : String(max);
    return `Ctx: ${usedDisplay}/${maxDisplay}`;
  }

  private formatTool(name: string, elapsed?: number): string {
    let toolDisplay = `⚙ ${name}`;
    if (elapsed !== undefined && elapsed > 0) {
      toolDisplay += ` ${elapsed.toFixed(1)}s`;
    }
    return toolDisplay;
  }
}

let globalStatusLine: StatusLine | null = null;

export function getStatusLine(options?: StatusLineOptions): StatusLine {
  if (!globalStatusLine) {
    globalStatusLine = new StatusLine(options);
  }
  return globalStatusLine;
}

export function setStatusLine(statusLine: StatusLine): void {
  globalStatusLine = statusLine;
}
