export function isTTY(): boolean {
  return process.stdout.isTTY === true && process.stdin.isTTY === true;
}

/**
 * UI context for controlling rendering behavior.
 * Uses mutable module state for CLI singleton pattern.
 * Reset between tests by calling resetUIContext().
 */
interface UIContext {
  noColor: boolean;
  jsonMode: boolean;
}

let currentContext: UIContext = { noColor: false, jsonMode: false };

/**
 * Configure UI rendering behavior.
 * Pass partial options to update specific settings.
 */
export function setUIContext(ctx: Partial<UIContext>): void {
  currentContext = { ...currentContext, ...ctx };
}

/**
 * Convenience setters for individual flags.
 * @deprecated Prefer setUIContext() for new code.
 */
export function setNoColor(value: boolean): void {
  currentContext.noColor = value;
}

export function setJsonMode(value: boolean): void {
  currentContext.jsonMode = value;
}

export function isJsonMode(): boolean {
  return currentContext.jsonMode;
}

/**
 * Reset UI context to defaults.
 * Primarily useful for testing to avoid state leakage.
 */
export function resetUIContext(): void {
  currentContext = { noColor: false, jsonMode: false };
}

export function shouldUseInk(): boolean {
  if (currentContext.noColor || currentContext.jsonMode) {
    return false;
  }
  return isTTY();
}
