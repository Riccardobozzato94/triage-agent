/**
 * Shared domain types for the Triage Agent.
 *
 * Everything in this project runs on declared synthetic data. No real customer
 * message is ever ingested by the default configuration.
 */

export type Locale = "it" | "en";

export type TicketType =
  | "ordine"
  | "fatturazione"
  | "assistenza"
  | "reclamo"
  | "richiesta_informazioni"
  | "cambio_dati";

export type Urgency = "bassa" | "media" | "alta";

export type TicketStatus =
  | "pending"
  | "auto_approved"
  | "manual_review"
  | "approved"
  | "rejected"
  | "sent";

export interface ExtractedFields {
  orderId?: string;
  amount?: string;
  deadline?: string;
  product?: string;
  client?: string;
}

export interface GroundTruth {
  type: TicketType;
  urgency: Urgency;
  client: string;
  fields: ExtractedFields;
  /** Declared synthetic baseline: manual handling seconds for this ticket. */
  baselineHandlingSec: number;
}

export interface SyntheticTicket {
  id: string;
  createdAt: string;
  locale: Locale;
  subject: string;
  body: string;
  from: string;
  synthetic: true;
  groundTruth: GroundTruth;
}

export interface Prediction {
  type: TicketType;
  urgency: Urgency;
  client?: string;
  fields: ExtractedFields;
  confidence: number;
  /** Short quotes from the input that justify the decision. */
  evidence: string[];
  /** Which engine produced the result. */
  model: string;
  /** Set when a configured AI adapter failed and the deterministic engine took over. */
  fallbackReason?: string;
  /** Raw adapter output, kept in the audit trail for debugging. */
  raw?: unknown;
}

export interface Draft {
  subject: string;
  body: string;
  sources: string[];
  locale: Locale;
}

export interface TriageResult {
  ticketId: string;
  routedTo: "auto" | "human";
  reason: string;
  prediction: Prediction;
  draft: Draft;
  /** Wall-clock processing time, measured in the engine. */
  processingMs: number;
  createdAt: string;
}

export interface AuditEntry {
  ticketId: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export type Decision = "approve" | "reject";

export interface DecisionInput {
  decision: Decision;
  actor: string;
  note?: string;
  editedDraft?: string;
  /** Seconds the reviewer spent, recorded manually. Never estimated. */
  reviewSeconds?: number;
}

export interface Kpis {
  sampleSize: number;
  accuracyType: number | null;
  accuracyUrgency: number | null;
  fieldPrecision: number | null;
  fieldRecall: number | null;
  autoRouteRate: number;
  manualReviewRate: number;
  auditCoverage: number;
  avgProcessingMs: number;
  sentCount: number;
  pendingCount: number;
  /** Declared synthetic baseline, shown as assumption, never as a result. */
  declaredBaselineHandlingSec: number | null;
  /** Only present when a reviewer recorded real review seconds. */
  measuredAvgReviewSec: number | null;
  adapterUsage: Record<string, number>;
}

export interface BenchmarkResult {
  id: string;
  createdAt: string;
  dataset: string;
  synthetic: true;
  threshold: number;
  sampleSize: number;
  metrics: {
    accuracyType: number;
    accuracyUrgency: number;
    fieldPrecision: number;
    fieldRecall: number;
    autoRouteRate: number;
    manualReviewRate: number;
    /** Accuracy restricted to tickets the engine auto-routed. */
    accuracyOnAutoRouted: number | null;
    auditCoverage: number;
    avgProcessingMs: number;
    p95ProcessingMs: number;
  };
  confusion: Record<string, Record<string, number>>;
  errors: Array<{ id: string; expected: string; actual: string; confidence: number }>;
  declaredBaselineHandlingSec: number;
  note: string;
}

export interface Env {
  DB?: D1DatabaseLike;
  GEMINI_API_KEY?: string;
  WORKERS_AI_ACCOUNT_ID?: string;
  WORKERS_AI_API_TOKEN?: string;
  AGENT_TOKEN?: string;
  CONFIDENCE_THRESHOLD?: string;
  STORE?: "memory" | "d1";
}

/** Minimal D1 surface used here, so the project can compile without Workers types. */
export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>;
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
    all<T = unknown>(): Promise<{ results: T[] }>;
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<unknown>;
  };
  exec(query: string): Promise<unknown>;
}
