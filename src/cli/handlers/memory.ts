import type { Config } from "../../config/schema.js";
import { MemoryStore } from "../../core/memory.js";
import { createMemoryStore } from "../shared.js";

export async function handleMemory(
  config: Config,
  args: string[],
  options: { noMemory?: boolean; memoryFile?: string; json?: boolean },
): Promise<void> {
  let memoryStore = createMemoryStore(config, options);
  const subCommand = args[0] || "list";

  if (!memoryStore) {
    const memoryFile = config.memoryFile || `${process.env.HOME}/.tiny-agent/memories.json`;
    memoryStore = new MemoryStore({ filePath: memoryFile });
    console.log(`Using memory file: ${memoryFile}\n`);
  }

  // Wait for async loading to complete before listing
  await memoryStore.init();
  memoryStore.touchAll();
  await memoryStore.flush();

  if (subCommand === "list") {
    const memories = memoryStore.list();
    console.log("\nMemories");
    console.log("========\n");

    if (memories.length === 0) {
      console.log("No memories stored.\n");
    } else {
      for (const memory of memories) {
        const date = new Date(memory.createdAt).toLocaleDateString();
        console.log(`[${memory.category}] ${date}`);
        console.log(`  ${memory.content}`);
        console.log(`  (accessed ${memory.accessCount} times)\n`);
      }
    }

    const totalTokens = memoryStore.countTokens();
    console.log(`Total: ${memories.length} memories, ~${totalTokens} tokens\n`);
  } else if (subCommand === "add") {
    const content = args.slice(1).join(" ");
    if (!content) {
      console.error('Error: Memory content required. Usage: tiny-agent memory add "your memory"');
      process.exit(1);
    }
    const memory = memoryStore.add(content);
    console.log(`Memory added: ${memory.id}\n`);
  } else if (subCommand === "clear") {
    const count = memoryStore.count();
    memoryStore.clear();
    console.log(`Cleared ${count} memories.\n`);
  } else if (subCommand === "stats") {
    const memories = memoryStore.list();
    const totalTokens = memoryStore.countTokens();
    console.log("\nMemory Statistics");
    console.log("=================\n");
    console.log(`  Total memories: ${memories.length}`);
    console.log(`  Estimated tokens: ${totalTokens}`);
    console.log(`  By category:`);

    const categories = ["user", "project", "codebase"];
    for (const cat of categories) {
      const count = memories.filter((m) => m.category === cat).length;
      console.log(`    ${cat}: ${count}`);
    }
    console.log();
  } else {
    console.error(`Unknown memory command: ${subCommand}`);
    console.error("Available commands: list, add <content>, clear, stats");
    process.exit(1);
  }

  process.exit(0);
}
