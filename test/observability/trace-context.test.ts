import { describe, expect, it } from "bun:test";
import {
	currentTraceId,
	generateTraceId,
	getTraceContext,
	runWithContext,
} from "../../src/observability/trace-context.js";

describe("trace-context", () => {
	it("exposes the run's trace id inside the callback", async () => {
		const id = generateTraceId();
		await runWithContext(id, async () => {
			expect(currentTraceId()).toBe(id);
		});
	});

	it("does not leak context outside the run", async () => {
		const id = generateTraceId();
		await runWithContext(id, async () => {
			expect(currentTraceId()).toBe(id);
		});
		expect(currentTraceId()).toBe("no-trace");
	});

	it("keeps concurrent runs isolated", async () => {
		const order: string[] = [];
		const run = async (id: string, delayMs: number): Promise<void> => {
			await runWithContext(id, async () => {
				// yield to the event loop so runs interleave
				await new Promise((r) => setTimeout(r, delayMs));
				expect(currentTraceId()).toBe(id);
				order.push(id);
			});
		};

		await Promise.all([run("trace-A", 20), run("trace-B", 5), run("trace-C", 35)]);

		// All three saw their own id (asserted inside each run) and ran to completion.
		expect(order.sort()).toEqual(["trace-A", "trace-B", "trace-C"]);
	});

	it("each run has an independent span stack", async () => {
		let aStack: unknown[] | undefined;
		let bStack: unknown[] | undefined;
		await runWithContext("trace-A", async () => {
			const ctx = getTraceContext();
			ctx?.spanStack.push("span-a");
			await new Promise((r) => setTimeout(r, 5));
			aStack = getTraceContext()?.spanStack;
		});
		await runWithContext("trace-B", async () => {
			const ctx = getTraceContext();
			ctx?.spanStack.push("span-b1", "span-b2");
			bStack = getTraceContext()?.spanStack;
		});
		expect(aStack).toEqual(["span-a"]);
		expect(bStack).toEqual(["span-b1", "span-b2"]);
	});
});
