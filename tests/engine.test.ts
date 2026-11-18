import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../src/benchmark.ts";
import { comparePrediction, extractFields, triage } from "../src/engine.ts";
import { generateDataset, DATASET_SIZE } from "../src/synthetic.ts";
import { MemoryStore } from "../src/store.ts";

const tickets = generateDataset();

test("dataset is deterministic, synthetic and correctly sized", () => {
  assert.equal(tickets.length, DATASET_SIZE);
  assert.deepEqual(generateDataset(5).map((ticket) => ticket.id), generateDataset(5).map((ticket) => ticket.id));
  assert.ok(tickets.every((ticket) => ticket.synthetic === true));
  assert.ok(tickets.every((ticket) => ticket.groundTruth.baselineHandlingSec > 0));
});

test("field extraction returns only values present in the text", () => {
  const fields = extractFields("", "Ordine ORD-4123, importo 120,50 € entro il 14/12/2026.");
  assert.equal(fields.orderId, "ORD-4123");
  assert.equal(fields.amount, "120,50");
  assert.equal(fields.deadline, "14/12/2026");
});

test("ambiguous tickets go to human review", async () => {
  const ambiguous = tickets.filter((ticket) => ticket.body.includes("Potete richiamarmi") || ticket.body.includes("call me back"));
  assert.ok(ambiguous.length > 0);
  for (const ticket of ambiguous) {
    const result = await triage(ticket);
    assert.equal(result.routedTo, "human");
    assert.ok(result.prediction.confidence < 0.72);
  }
});

test("clear tickets are classified above the threshold", async () => {
  const clear = tickets.filter((ticket) => !ticket.body.includes("Potete richiamarmi") && !ticket.body.includes("call me back"));
  const results = [];
  for (const ticket of clear) results.push({ ticket, result: await triage(ticket) });
  const routed = results.filter(({ result }) => result.routedTo === "auto").length;
  assert.ok(routed / results.length > 0.7, `auto-route rate was ${routed / results.length}`);
});

test("draft cites evidence and never invents an order id", async () => {
  const ticket = tickets.find((item) => item.subject.includes("Richiesta generica"))!;
  const result = await triage(ticket);
  assert.equal(result.draft.locale, ticket.locale);
  assert.ok(result.draft.body.includes("Fonte:"));
  assert.ok(!result.draft.body.includes("ORD-") || Boolean(result.prediction.fields.orderId));
});

test("benchmark measures accuracy, audit coverage and latency", async () => {
  const store = new MemoryStore();
  const result = await runBenchmark(store, tickets.slice(0, 30));
  assert.equal(result.sampleSize, 30);
  assert.ok(result.metrics.accuracyType >= 0 && result.metrics.accuracyType <= 1);
  assert.equal(result.metrics.auditCoverage, 1);
  assert.ok(result.metrics.avgProcessingMs >= 0);
  assert.equal(result.synthetic, true);
  assert.ok(result.note.includes("non una misura di lavoro umano reale"));
});

test("sending requires an explicit approval decision", async () => {
  const store = new MemoryStore();
  const ticket = tickets[0]!;
  const result = await triage(ticket);
  await store.put(ticket, result);
  assert.equal(await store.send(ticket.id), false);
  assert.equal(
    await store.decide(ticket.id, { decision: "approve", actor: "test", reviewSeconds: 42 }),
    true,
  );
  assert.equal(await store.send(ticket.id), true);
  const stored = await store.get(ticket.id);
  assert.ok(stored?.sentAt);
  assert.equal((await store.kpis()).measuredAvgReviewSec, 42);
});

test("comparison uses declared ground truth only", () => {
  const ticket = tickets[0]!;
  const comparison = comparePrediction(ticket, {
    ...ticket.groundTruth,
    confidence: 1,
    evidence: [],
    model: "test",
  });
  assert.equal(comparison.typeOk, true);
  assert.equal(comparison.urgencyOk, true);
});
