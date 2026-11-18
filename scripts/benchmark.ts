/**
 * Run the benchmark and write a real, reproducible result to results/.
 * Usage: node projects/triage-agent/scripts/benchmark.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "../src/benchmark.ts";
import { generateDataset, SYNTHETIC_DECLARATION } from "../src/synthetic.ts";
import { MemoryStore } from "../src/store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const count = Number(process.argv[2] ?? 120);
const threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.72);

const store = new MemoryStore();
const tickets = generateDataset(count);
const result = await runBenchmark(store, tickets, {}, threshold);

const output = {
  ...result,
  declaration: SYNTHETIC_DECLARATION,
  generatedBy: "projects/triage-agent/scripts/benchmark.ts",
  reproducibleWith: `node projects/triage-agent/scripts/benchmark.ts ${count}`,
};

mkdirSync(join(root, "results"), { recursive: true });
writeFileSync(join(root, "results", "benchmark.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(JSON.stringify(result.metrics, null, 2));
console.log(`Sample: ${result.sampleSize} synthetic tickets`);
console.log(`Declared baseline: ${result.declaredBaselineHandlingSec} s/ticket (assumption, not measurement)`);
