/**
 * Confirmation system for dangerous tool operations.
 *
 * Tools can be marked as "dangerous" requiring user confirmation before execution.
 * The CLI layer sets a confirmation handler that prompts the user.
 * Non-interactive contexts (run command, --allow-all flag) skip confirmation.
 */

export type ConfirmationAction = {
  tool: string;
  description: string;
  args: Record<string, unknown>;
};

export type ConfirmationRequest = {
  actions: ConfirmationAction[];
};

export type ConfirmationResult = true | false | { type: "partial"; selectedIndex: number };

export type ConfirmationHandler = (request: ConfirmationRequest) => Promise<ConfirmationResult>;

let _confirmationHandler: ConfirmationHandler | undefined;
let _sessionApprovedAll: boolean = false;
let _sessionDeniedAll: boolean = false;

export function setConfirmationHandler(handler: ConfirmationHandler | undefined): void {
  _confirmationHandler = handler;
  _sessionApprovedAll = false;
  _sessionDeniedAll = false;
}

export function getConfirmationHandler(): ConfirmationHandler | undefined {
  return _confirmationHandler;
}

export function isSessionApprovedAll(): boolean {
  return _sessionApprovedAll;
}

export function isSessionDeniedAll(): boolean {
  return _sessionDeniedAll;
}

export function setSessionApproval(approved: boolean): void {
  _sessionApprovedAll = approved;
  _sessionDeniedAll = !approved;
}

export function clearSessionApproval(): void {
  _sessionApprovedAll = false;
  _sessionDeniedAll = false;
}
