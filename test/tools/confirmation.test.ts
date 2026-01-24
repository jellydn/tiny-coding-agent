import { describe, it, expect, beforeEach } from "bun:test";
import {
  setConfirmationHandler,
  getConfirmationHandler,
  type ConfirmationRequest,
  type ConfirmationResult,
} from "../src/confirmation.js";

describe("confirmation", () => {
  beforeEach(() => {
    // Reset handler before each test
    setConfirmationHandler(undefined);
  });

  describe("setConfirmationHandler()", () => {
    it("should set the confirmation handler", () => {
      const mockHandler = async (): Promise<ConfirmationResult> => true;
      setConfirmationHandler(mockHandler);
      expect(getConfirmationHandler()).toBe(mockHandler);
    });

    it("should clear the handler when undefined is passed", () => {
      const mockHandler = async (): Promise<ConfirmationResult> => true;
      setConfirmationHandler(mockHandler);
      expect(getConfirmationHandler()).toBe(mockHandler);

      setConfirmationHandler(undefined);
      expect(getConfirmationHandler()).toBeUndefined();
    });
  });

  describe("getConfirmationHandler()", () => {
    it("should return undefined when no handler is set", () => {
      expect(getConfirmationHandler()).toBeUndefined();
    });

    it("should return the set handler", () => {
      const mockHandler = async (): Promise<ConfirmationResult> => false;
      setConfirmationHandler(mockHandler);
      expect(getConfirmationHandler()).toBe(mockHandler);
    });
  });

  describe("ConfirmationHandler behavior", () => {
    it("should approve all operations when returning true", async () => {
      const mockHandler = async (request: ConfirmationRequest): Promise<ConfirmationResult> => {
        expect(Array.isArray(request.actions)).toBe(true);
        expect(request.actions.length).toBeGreaterThan(0);
        return true;
      };

      setConfirmationHandler(mockHandler);

      const request: ConfirmationRequest = {
        actions: [
          {
            tool: "write_file",
            description: "Will create or overwrite file",
            args: { path: "test.txt" },
          },
        ],
      };

      const result = await mockHandler(request);
      expect(result).toBe(true);
    });

    it("should deny all operations when returning false", async () => {
      const mockHandler = async (_request: ConfirmationRequest): Promise<ConfirmationResult> => {
        return false;
      };

      setConfirmationHandler(mockHandler);

      const result = await mockHandler({
        actions: [
          {
            tool: "bash",
            description: "Destructive command: rm file.txt",
            args: { command: "rm file.txt" },
          },
        ],
      });

      expect(result).toBe(false);
    });

    it("should return partial for per-command approval", async () => {
      const mockHandler = async (_request: ConfirmationRequest): Promise<ConfirmationResult> => {
        return { type: "partial", selectedIndex: 0 };
      };

      setConfirmationHandler(mockHandler);

      const result = await mockHandler({
        actions: [
          {
            tool: "write_file",
            description: "Will create or overwrite file",
            args: { path: "test.txt" },
          },
          {
            tool: "bash",
            description: "Destructive command: rm file.txt",
            args: { command: "rm file.txt" },
          },
        ],
      });

      expect(result).toEqual({ type: "partial", selectedIndex: 0 });
    });

    it("should handle multiple actions in request", async () => {
      const mockHandler = async (request: ConfirmationRequest): Promise<ConfirmationResult> => {
        expect(request.actions).toHaveLength(3);
        expect(request.actions[0]?.tool).toBe("write_file");
        expect(request.actions[1]?.tool).toBe("edit_file");
        expect(request.actions[2]?.tool).toBe("bash");
        return true;
      };

      setConfirmationHandler(mockHandler);

      const request: ConfirmationRequest = {
        actions: [
          {
            tool: "write_file",
            description: "Will create or overwrite file",
            args: { path: "new.txt" },
          },
          {
            tool: "edit_file",
            description: "Will modify existing file",
            args: { path: "existing.txt", old_str: "foo", new_str: "bar" },
          },
          {
            tool: "bash",
            description: "Destructive command: git commit",
            args: { command: "git commit -m 'msg'" },
          },
        ],
      };

      await mockHandler(request);
    });
  });
});
