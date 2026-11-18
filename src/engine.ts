/**
 * Deterministic triage engine with optional AI adapters.
 *
 * The deterministic path is the default and needs no key. AI adapters are
 * best-effort enhancements: if they fail or are not configured, the engine
 * falls back and records the reason in the prediction and audit trail.
 */
import { CLIENTS, PRODUCTS } from "./synthetic.ts";
import type {
  Draft,
  Env,
  ExtractedFields,
  Locale,
  Prediction,
  SyntheticTicket,
  TicketType,
  TriageResult,
  Urgency,
} from "./types.ts";

export const DEFAULT_THRESHOLD = 0.72;
export const ENGINE_VERSION = "deterministic-v1";

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const TYPE_PATTERNS: Record<TicketType, Array<[string, number]>> = {
  ordine: [
    ["conferma ordine", 3],
    ["confirm order", 3],
    ["confermate disponibilita", 2],
    ["available by", 2],
    ["data di consegna", 2],
    ["delivery date", 2],
    ["effettuato l'ordine", 2],
    ["placed order", 2],
    ["ordine", 1],
    ["order", 1],
  ],
  fatturazione: [
    ["fattura", 4],
    ["invoice", 4],
    ["rettifica", 3],
    ["importo non torna", 3],
    ["amount does not match", 3],
    ["documento aggiornato", 2],
    ["updated document", 2],
  ],
  assistenza: [
    ["non funziona", 4],
    ["not working", 4],
    ["assistenza tecnica", 3],
    ["technical support", 3],
    ["errore al primo avvio", 3],
    ["cannot finish", 3],
    ["problema con", 2],
    ["issue with", 2],
  ],
  reclamo: [
    ["reclamo", 5],
    ["complaint", 5],
    ["deluso", 3],
    ["disappointed", 3],
    ["danneggiato", 3],
    ["damaged", 3],
    ["spiegazione", 2],
    ["ritardo", 2],
    ["late", 1],
  ],
  richiesta_informazioni: [
    ["informazioni", 3],
    ["information", 3],
    ["disponibilita", 2],
    ["availability", 2],
    ["manuale", 3],
    ["manual", 3],
    ["colore", 2],
    ["colour", 2],
  ],
  cambio_dati: [
    ["aggiornare l'indirizzo", 4],
    ["update the billing address", 4],
    ["cambio dati", 4],
    ["change of company details", 4],
    ["modifica email", 3],
    ["change the contact email", 3],
    ["ragione sociale", 3],
  ],
};

const URGENCY_HIGH = [
  "urgente",
  "urgent",
  "priorita alta",
  "high priority",
  "entro oggi",
  "due today",
  "bloccato",
  "blocked",
];
const URGENCY_LOW = ["nessuna fretta", "no rush", "quando possibile", "whenever possible"];

function hasPattern(text: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

function scoreType(text: string): { type: TicketType; score: number; evidence: string[]; second: number } {
  const scores: Array<{ type: TicketType; score: number; evidence: string[] }> = [];

  for (const [type, patterns] of Object.entries(TYPE_PATTERNS) as Array<[TicketType, Array<[string, number]>]>) {
    let score = 0;
    const evidence: string[] = [];
    for (const [pattern, weight] of patterns) {
      if (hasPattern(text, pattern)) {
        score += weight;
        if (evidence.length < 3) evidence.push(pattern);
      }
    }
    scores.push({ type, score, evidence });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]!;
  return { type: best.type, score: best.score, evidence: best.evidence, second: scores[1]?.score ?? 0 };
}

export function extractFields(text: string, original: string): ExtractedFields {
  const fields: ExtractedFields = {};

  const order = original.match(/\bORD-\d{4,6}\b/i);
  if (order) fields.orderId = order[0].toUpperCase();

  const amount = original.match(/(?:€\s*)?(\d{1,4}[.,]\d{2})\s*(?:€)?/);
  if (amount) fields.amount = amount[1]!.replace(".", ",").padStart(0, "0");

  const deadline = original.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  if (deadline) fields.deadline = deadline[1]!;

  const product = PRODUCTS.find((item) => text.includes(normalize(item)));
  if (product) fields.product = product;

  const client = CLIENTS.find((item) => text.includes(normalize(item)));
  if (client) fields.client = client;

  return fields;
}

function scoreUrgency(text: string): Urgency {
  if (URGENCY_HIGH.some((pattern) => hasPattern(text, pattern))) return "alta";
  if (URGENCY_LOW.some((pattern) => hasPattern(text, pattern))) return "bassa";
  return "media";
}

function buildConfidence(score: number, second: number, fields: ExtractedFields): number {
  if (score === 0) return 0.05;
  const signal = 0.48 + score * 0.09 + (score - second) * 0.06;
  const fieldBoost = fields.orderId ? 0.05 : 0;
  return Math.min(0.99, Math.round((signal + fieldBoost) * 100) / 100);
}

interface AdapterSuggestion {
  type?: TicketType;
  urgency?: Urgency;
  fields?: Partial<ExtractedFields>;
  model: string;
  raw?: unknown;
}

const TYPES_SET = new Set<TicketType>([
  "ordine",
  "fatturazione",
  "assistenza",
  "reclamo",
  "richiesta_informazioni",
  "cambio_dati",
]);
const URGENCIES_SET = new Set<Urgency>(["bassa", "media", "alta"]);

function parseSuggestion(text: string, model: string): AdapterSuggestion | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const suggestion: AdapterSuggestion = { model, raw: parsed };
    if (typeof parsed.type === "string" && TYPES_SET.has(parsed.type as TicketType)) {
      suggestion.type = parsed.type as TicketType;
    }
    if (typeof parsed.urgency === "string" && URGENCIES_SET.has(parsed.urgency as Urgency)) {
      suggestion.urgency = parsed.urgency as Urgency;
    }
    if (parsed.fields && typeof parsed.fields === "object") {
      const fields = parsed.fields as Record<string, unknown>;
      suggestion.fields = {};
      for (const key of ["orderId", "amount", "deadline", "product", "client"] as const) {
        if (typeof fields[key] === "string" && fields[key]!.length < 120) {
          suggestion.fields[key] = fields[key] as string;
        }
      }
    }
    return suggestion;
  } catch {
    return null;
  }
}

const PROMPT = `Classifica la richiesta. Rispondi SOLO con JSON valido:
{"type":"ordine|fatturazione|assistenza|reclamo|richiesta_informazioni|cambio_dati","urgency":"bassa|media|alta","fields":{"orderId":"","amount":"","deadline":"","product":"","client":""}}
Se un campo non è presente, omettilo. Non inventare valori.

TESTO:
`;

async function callGemini(ticket: SyntheticTicket, env: Env): Promise<AdapterSuggestion | null> {
  if (!env.GEMINI_API_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${PROMPT}${ticket.subject}\n${ticket.body}` }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return parseSuggestion(text, "gemini-2.5-flash");
}

async function callWorkersAi(ticket: SyntheticTicket, env: Env): Promise<AdapterSuggestion | null> {
  if (!env.WORKERS_AI_ACCOUNT_ID || !env.WORKERS_AI_API_TOKEN) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.WORKERS_AI_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WORKERS_AI_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: `${PROMPT}${ticket.subject}\n${ticket.body}` }],
      temperature: 0,
      max_tokens: 300,
    }),
  });
  if (!response.ok) throw new Error(`Workers AI HTTP ${response.status}`);
  const data = (await response.json()) as { result?: { response?: string } };
  return parseSuggestion(data.result?.response ?? "", "workers-ai-llama-3.1-8b");
}

function buildDraft(ticket: SyntheticTicket, prediction: Prediction, evidence: string[]): Draft {
  const sourceLine = evidence.length ? evidence.join(", ") : (ticket.locale === "it" ? "testo della richiesta" : "request text");
  const fields = prediction.fields;

  if (ticket.locale === "en") {
    const lines = [
      `Hello,`,
      ``,
      `thanks for your message. We have classified it as ${prediction.type.replace(/_/g, " ")} with ${prediction.urgency} priority.`,
      fields.orderId ? `Order: ${fields.orderId}.` : "",
      fields.product ? `Product: ${fields.product}.` : "",
      fields.amount ? `Amount: ${fields.amount}.` : "",
      fields.deadline ? `Reference date: ${fields.deadline}.` : "",
      ``,
      `A colleague will review the details before any reply is sent. If we need more information, we will write to you.`,
      ``,
      `Source: ${sourceLine}.`,
      ``,
      `Riccardo`,
    ];
    return {
      subject: `Re: ${ticket.subject}`,
      body: lines.filter((line, index) => line !== "" || lines[index + 1] !== "").join("\n"),
      sources: evidence,
      locale: "en",
    };
  }

  const lines = [
    `Buongiorno,`,
    ``,
    `grazie per la richiesta. L'abbiamo classificata come ${prediction.type.replace(/_/g, " ")} con priorità ${prediction.urgency}.`,
    fields.orderId ? `Ordine: ${fields.orderId}.` : "",
    fields.product ? `Prodotto: ${fields.product}.` : "",
    fields.amount ? `Importo: ${fields.amount}.` : "",
    fields.deadline ? `Data di riferimento: ${fields.deadline}.` : "",
    ``,
    `Una persona verificherà i dati prima dell'invio. Se serve un'informazione aggiuntiva, ti scriveremo.`,
    ``,
    `Fonte: ${sourceLine}.`,
    ``,
    `Riccardo`,
  ];
  return {
    subject: `Re: ${ticket.subject}`,
    body: lines.filter((line, index) => line !== "" || lines[index + 1] !== "").join("\n"),
    sources: evidence,
    locale: "it",
  };
}

export function requiresHuman(prediction: Prediction, threshold: number): { needed: boolean; reason: string } {
  if (prediction.confidence < threshold) {
    return { needed: true, reason: `confidence ${prediction.confidence} below threshold ${threshold}` };
  }
  if (prediction.type === "reclamo" && prediction.urgency === "alta") {
    return { needed: true, reason: "high-priority complaint: policy requires human approval" };
  }
  if (
    !prediction.fields.orderId &&
    ["ordine", "fatturazione", "assistenza", "reclamo"].includes(prediction.type)
  ) {
    return { needed: true, reason: "no order id extracted" };
  }
  return { needed: false, reason: "confidence above threshold and no policy block" };
}

/** Classify, extract, draft, and route one ticket. */
export async function triage(
  ticket: SyntheticTicket,
  env: Env = {},
  threshold = DEFAULT_THRESHOLD,
): Promise<TriageResult> {
  const started = performance.now();
  const text = normalize(`${ticket.subject} ${ticket.body}`);
  const deterministicFields = extractFields(text, `${ticket.subject} ${ticket.body}`);
  const scored = scoreType(text);
  const urgency = scoreUrgency(text);
  const confidence = buildConfidence(scored.score, scored.second, deterministicFields);

  const prediction: Prediction = {
    type: scored.type,
    urgency,
    client: deterministicFields.client,
    fields: deterministicFields,
    confidence,
    evidence: scored.evidence,
    model: ENGINE_VERSION,
  };

  const adapters = [callGemini, callWorkersAi];
  for (const adapter of adapters) {
    try {
      const suggestion = await adapter(ticket, env);
      if (!suggestion) continue;
      prediction.type = suggestion.type ?? prediction.type;
      prediction.urgency = suggestion.urgency ?? prediction.urgency;
      prediction.fields = { ...deterministicFields, ...(suggestion.fields ?? {}) };
      prediction.model = suggestion.model;
      prediction.raw = suggestion.raw;
      prediction.evidence = [...new Set([...prediction.evidence, "AI adapter"])];
      break;
    } catch (error) {
      prediction.fallbackReason = error instanceof Error ? error.message : String(error);
    }
  }

  const gate = requiresHuman(prediction, threshold);
  const draft = buildDraft(ticket, prediction, prediction.evidence);

  return {
    ticketId: ticket.id,
    routedTo: gate.needed ? "human" : "auto",
    reason: gate.reason,
    prediction,
    draft,
    processingMs: Math.round((performance.now() - started) * 100) / 100,
    createdAt: new Date().toISOString(),
  };
}

/** Correctness helpers used by the benchmark. */
export function comparePrediction(ticket: SyntheticTicket, prediction: Prediction) {
  return {
    typeOk: prediction.type === ticket.groundTruth.type,
    urgencyOk: prediction.urgency === ticket.groundTruth.urgency,
    fields: (["orderId", "amount", "deadline", "product", "client"] as const).map((key) => ({
      key,
      expected: ticket.groundTruth.fields[key],
      actual: prediction.fields[key],
    })),
  };
}
