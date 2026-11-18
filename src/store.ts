/**
 * Storage abstraction. The Worker uses D1 (free tier); local scripts and tests
 * use the in-memory store. Both implement the same contract, so the benchmark
 * measures the same code path that runs in production.
 */
import type {
  AuditEntry,
  BenchmarkResult,
  DecisionInput,
  D1DatabaseLike,
  Kpis,
  SyntheticTicket,
  TriageResult,
} from "./types.ts";

export interface StoredTicket {
  ticket: SyntheticTicket;
  result: TriageResult;
  decision?: {
    decision: DecisionInput["decision"];
    actor: string;
    note?: string;
    editedDraft?: string;
    reviewSeconds?: number;
    decidedAt: string;
  };
  sentAt?: string;
}

export interface Store {
  init(): Promise<void>;
  put(ticket: SyntheticTicket, result: TriageResult): Promise<void>;
  get(id: string): Promise<StoredTicket | undefined>;
  list(): Promise<StoredTicket[]>;
  decide(id: string, input: DecisionInput): Promise<boolean>;
  send(id: string): Promise<boolean>;
  audit(entry: AuditEntry): Promise<void>;
  audits(ticketId?: string): Promise<AuditEntry[]>;
  putBenchmark(result: BenchmarkResult): Promise<void>;
  benchmarks(): Promise<BenchmarkResult[]>;
  kpis(): Promise<Kpis>;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function computeKpis(rows: StoredTicket[], audits: AuditEntry[]): Kpis {
  const results = rows.map((row) => row.result);
  const withGroundTruth = rows.filter(
    (row) => row.ticket.groundTruth && Object.keys(row.ticket.groundTruth.fields).length > 0,
  );
  const typeOk = withGroundTruth.filter(
    (row) => row.result.prediction.type === row.ticket.groundTruth.type,
  ).length;
  const urgencyOk = withGroundTruth.filter(
    (row) => row.result.prediction.urgency === row.ticket.groundTruth.urgency,
  ).length;

  let expected = 0;
  let found = 0;
  for (const row of withGroundTruth) {
    for (const [key, value] of Object.entries(row.ticket.groundTruth.fields)) {
      if (!value) continue;
      expected += 1;
      if (row.result.prediction.fields[key as keyof typeof row.result.prediction.fields] === value) {
        found += 1;
      }
    }
  }

  const auto = results.filter((result) => result.routedTo === "auto").length;
  const reviewed = results.filter((result) => result.routedTo === "human").length;
  const auditIds = new Set(audits.map((entry) => entry.ticketId));
  const audited = rows.filter((row) => auditIds.has(row.ticket.id)).length;
  const reviewSeconds = rows
    .map((row) => row.decision?.reviewSeconds)
    .filter((seconds): seconds is number => typeof seconds === "number");
  const adapterUsage: Record<string, number> = {};
  for (const result of results) {
    adapterUsage[result.prediction.model] = (adapterUsage[result.prediction.model] ?? 0) + 1;
  }

  return {
    sampleSize: rows.length,
    accuracyType: withGroundTruth.length ? round(typeOk / withGroundTruth.length) : null,
    accuracyUrgency: withGroundTruth.length ? round(urgencyOk / withGroundTruth.length) : null,
    fieldPrecision: expected ? round(found / expected) : null,
    fieldRecall: expected ? round(found / expected) : null,
    autoRouteRate: rows.length ? round(auto / rows.length) : 0,
    manualReviewRate: rows.length ? round(reviewed / rows.length) : 0,
    auditCoverage: rows.length ? round(audited / rows.length) : 0,
    avgProcessingMs: results.length
      ? round(results.reduce((sum, result) => sum + result.processingMs, 0) / results.length, 2)
      : 0,
    sentCount: rows.filter((row) => row.sentAt).length,
    pendingCount: rows.filter((row) => !row.decision && !row.sentAt).length,
    declaredBaselineHandlingSec: withGroundTruth.length
      ? round(
          withGroundTruth.reduce((sum, row) => sum + row.ticket.groundTruth.baselineHandlingSec, 0) /
            withGroundTruth.length,
          1,
        )
      : null,
    measuredAvgReviewSec: reviewSeconds.length
      ? round(reviewSeconds.reduce((sum, seconds) => sum + seconds, 0) / reviewSeconds.length, 1)
      : null,
    adapterUsage,
  };
}

export class MemoryStore implements Store {
  private rows = new Map<string, StoredTicket>();
  private auditLog: AuditEntry[] = [];
  private runs: BenchmarkResult[] = [];

  async init() {}

  async put(ticket: SyntheticTicket, result: TriageResult) {
    this.rows.set(ticket.id, { ticket, result });
  }

  async get(id: string) {
    return this.rows.get(id);
  }

  async list() {
    return [...this.rows.values()].sort((a, b) => a.ticket.createdAt.localeCompare(b.ticket.createdAt));
  }

  async decide(id: string, input: DecisionInput) {
    const row = this.rows.get(id);
    if (!row) return false;
    row.decision = {
      decision: input.decision,
      actor: input.actor,
      note: input.note,
      editedDraft: input.editedDraft,
      reviewSeconds: input.reviewSeconds,
      decidedAt: new Date().toISOString(),
    };
    return true;
  }

  async send(id: string) {
    const row = this.rows.get(id);
    if (!row || !row.decision || row.decision.decision !== "approve") return false;
    row.sentAt = new Date().toISOString();
    return true;
  }

  async audit(entry: AuditEntry) {
    this.auditLog.push(entry);
  }

  async audits(ticketId?: string) {
    return ticketId
      ? this.auditLog.filter((entry) => entry.ticketId === ticketId)
      : [...this.auditLog];
  }

  async putBenchmark(result: BenchmarkResult) {
    this.runs = [result, ...this.runs.filter((run) => run.id !== result.id)];
  }

  async benchmarks() {
    return this.runs;
  }

  async kpis() {
    return computeKpis(await this.list(), await this.audits());
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  result TEXT NOT NULL,
  decision TEXT,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit_log (ticket_id);
CREATE TABLE IF NOT EXISTS benchmarks (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
`;

export class D1Store implements Store {
  private ready: Promise<void> | null = null;
  private db: D1DatabaseLike;

  constructor(db: D1DatabaseLike) {
    this.db = db;
  }

  async init() {
    if (!this.ready) {
      // D1 `exec` does not reliably accept multiple statements in a single
      // string from a Worker. Run them one at a time so a fresh database works.
      this.ready = (async () => {
        for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
          await this.db.prepare(statement).run();
        }
      })();
    }
    return this.ready;
  }

  async put(ticket: SyntheticTicket, result: TriageResult) {
    await this.init();
    await this.db
      .prepare(
        `INSERT INTO tickets (id, payload, result, decision, sent_at)
         VALUES (?, ?, ?, NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, result = excluded.result`,
      )
      .bind(ticket.id, JSON.stringify(ticket), JSON.stringify(result))
      .run();
  }

  async get(id: string) {
    await this.init();
    const row = await this.db
      .prepare("SELECT payload, result, decision, sent_at FROM tickets WHERE id = ?")
      .bind(id)
      .first<{ payload: string; result: string; decision: string | null; sent_at: string | null }>();
    return row ? deserialize(row) : undefined;
  }

  async list() {
    await this.init();
    const rows = await this.db
      .prepare("SELECT payload, result, decision, sent_at FROM tickets ORDER BY json_extract(payload, '$.createdAt')")
      .all<{ payload: string; result: string; decision: string | null; sent_at: string | null }>();
    return rows.results.map(deserialize);
  }

  async decide(id: string, input: DecisionInput) {
    await this.init();
    const decision = {
      decision: input.decision,
      actor: input.actor,
      note: input.note,
      editedDraft: input.editedDraft,
      reviewSeconds: input.reviewSeconds,
      decidedAt: new Date().toISOString(),
    };
    const result = await this.db
      .prepare("UPDATE tickets SET decision = ? WHERE id = ?")
      .bind(JSON.stringify(decision), id)
      .run();
    return Boolean(result);
  }

  async send(id: string) {
    await this.init();
    const row = await this.get(id);
    if (!row?.decision || row.decision.decision !== "approve") return false;
    await this.db.prepare("UPDATE tickets SET sent_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return true;
  }

  async audit(entry: AuditEntry) {
    await this.init();
    await this.db
      .prepare(
        "INSERT INTO audit_log (ticket_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(entry.ticketId, entry.actor, entry.action, JSON.stringify(entry.detail), entry.createdAt)
      .run();
  }

  async audits(ticketId?: string) {
    await this.init();
    const statement = ticketId
      ? this.db
          .prepare(
            "SELECT ticket_id, actor, action, detail, created_at FROM audit_log WHERE ticket_id = ? ORDER BY id",
          )
          .bind(ticketId)
      : this.db.prepare(
          "SELECT ticket_id, actor, action, detail, created_at FROM audit_log ORDER BY id",
        );
    const rows = await statement.all<{
      ticket_id: string;
      actor: string;
      action: string;
      detail: string;
      created_at: string;
    }>();
    return rows.results.map((row) => ({
      ticketId: row.ticket_id,
      actor: row.actor,
      action: row.action,
      detail: JSON.parse(row.detail) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  async putBenchmark(result: BenchmarkResult) {
    await this.init();
    await this.db
      .prepare(
        `INSERT INTO benchmarks (id, created_at, payload) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      )
      .bind(result.id, result.createdAt, JSON.stringify(result))
      .run();
  }

  async benchmarks() {
    await this.init();
    const rows = await this.db
      .prepare("SELECT payload FROM benchmarks ORDER BY created_at DESC")
      .all<{ payload: string }>();
    return rows.results.map((row) => JSON.parse(row.payload) as BenchmarkResult);
  }

  async kpis() {
    return computeKpis(await this.list(), await this.audits());
  }
}

function deserialize(row: {
  payload: string;
  result: string;
  decision: string | null;
  sent_at: string | null;
}): StoredTicket {
  return {
    ticket: JSON.parse(row.payload) as SyntheticTicket,
    result: JSON.parse(row.result) as TriageResult,
    decision: row.decision ? (JSON.parse(row.decision) as StoredTicket["decision"]) : undefined,
    sentAt: row.sent_at ?? undefined,
  };
}
