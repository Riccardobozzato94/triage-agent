/** Reproducible benchmark over the declared synthetic dataset. */
import { comparePrediction, triage } from "./engine.ts";
import type { Store } from "./store.ts";
import type { BenchmarkResult, Env, SyntheticTicket } from "./types.ts";

export async function runBenchmark(
  store: Store,
  tickets: SyntheticTicket[],
  env: Env = {},
  threshold = 0.72,
): Promise<BenchmarkResult> {
  await store.init();
  const results = [];
  const auditEntries = [];
  const confusion: Record<string, Record<string, number>> = {};
  const errors: BenchmarkResult["errors"] = [];
  let typeOk = 0;
  let urgencyOk = 0;
  let fieldsExpected = 0;
  let fieldsFound = 0;

  for (const ticket of tickets) {
    const result = await triage(ticket, env, threshold);
    results.push(result);
    await store.put(ticket, result);

    const comparison = comparePrediction(ticket, result.prediction);
    if (comparison.typeOk) typeOk += 1;
    if (comparison.urgencyOk) urgencyOk += 1;
    for (const field of comparison.fields) {
      if (!field.expected) continue;
      fieldsExpected += 1;
      if (field.actual === field.expected) fieldsFound += 1;
    }

    confusion[ticket.groundTruth.type] ??= {};
    const actual = result.prediction.type;
    confusion[ticket.groundTruth.type]![actual] = (confusion[ticket.groundTruth.type]![actual] ?? 0) + 1;

    if (!comparison.typeOk || !comparison.urgencyOk || result.routedTo === "human") {
      errors.push({
        id: ticket.id,
        expected: `${ticket.groundTruth.type}/${ticket.groundTruth.urgency}`,
        actual: `${result.prediction.type}/${result.prediction.urgency}`,
        confidence: result.prediction.confidence,
      });
    }

    auditEntries.push({
      ticketId: ticket.id,
      actor: "system",
      action: "ingested",
      detail: { synthetic: true, source: ticket.from },
      createdAt: new Date().toISOString(),
    });
    auditEntries.push({
      ticketId: ticket.id,
      actor: result.prediction.model,
      action: "classified",
      detail: {
        type: result.prediction.type,
        urgency: result.prediction.urgency,
        confidence: result.prediction.confidence,
        routedTo: result.routedTo,
        reason: result.reason,
        fallbackReason: result.prediction.fallbackReason,
      },
      createdAt: result.createdAt,
    });
  }

  for (const entry of auditEntries) await store.audit(entry);

  const times = results.map((result) => result.processingMs).sort((a, b) => a - b);
  const percentileIndex = Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1);
  const audited = new Set((await store.audits()).map((entry) => entry.ticketId)).size;
  const total = tickets.length;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const declaredBaseline = Math.round(
    tickets.reduce((sum, ticket) => sum + ticket.groundTruth.baselineHandlingSec, 0) / total,
  );

  const autoResults = results.filter((item) => item.routedTo === "auto");
  const autoCorrect = autoResults.filter((item) => {
    const ticket = tickets.find((entry) => entry.id === item.ticketId)!;
    return item.prediction.type === ticket.groundTruth.type;
  }).length;

  const result: BenchmarkResult = {
    id: `bench-${Date.now()}`,
    createdAt: new Date().toISOString(),
    dataset: "synthetic-tickets-v1",
    synthetic: true,
    threshold,
    sampleSize: total,
    metrics: {
      accuracyType: round(typeOk / total),
      accuracyUrgency: round(urgencyOk / total),
      fieldPrecision: fieldsExpected ? round(fieldsFound / fieldsExpected) : 0,
      fieldRecall: fieldsExpected ? round(fieldsFound / fieldsExpected) : 0,
      autoRouteRate: round(results.filter((item) => item.routedTo === "auto").length / total),
      manualReviewRate: round(results.filter((item) => item.routedTo === "human").length / total),
      accuracyOnAutoRouted: autoResults.length ? round(autoCorrect / autoResults.length) : null,
      auditCoverage: round(audited / total),
      avgProcessingMs: round(times.reduce((sum, time) => sum + time, 0) / total),
      p95ProcessingMs: times[percentileIndex] ?? 0,
    },
    confusion,
    errors: errors.slice(0, 30),
    declaredBaselineHandlingSec: declaredBaseline,
    note:
      "Risultati misurati su dati sintetici generati da questo repository. " +
      "Il baseline manuale è un'assunzione dichiarata, non una misura di lavoro umano reale. " +
      "Nessun risultato va presentato come caso cliente.",
  };

  await store.putBenchmark(result);
  return result;
}
