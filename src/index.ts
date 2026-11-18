/**
 * Triage Agent HTTP surface.
 *
 * The same `fetch` handler runs on Cloudflare Workers (D1) and in the local
 * Node dev server (memory store). No real mailbox is connected: sending is
 * simulated and recorded in the audit trail.
 */
import { runBenchmark } from "./benchmark.ts";
import { triage } from "./engine.ts";
import { generateDataset, SYNTHETIC_DECLARATION } from "./synthetic.ts";
import { D1Store, MemoryStore, type Store } from "./store.ts";
import type { Env, SyntheticTicket } from "./types.ts";

const memory = new MemoryStore();

function storeFor(env: Env): Store {
  if (!env.STORE && env.DB) return new D1Store(env.DB);
  return memory;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function sanitize(value: string, max: number): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function authorized(request: Request, env: Env): boolean {
  if (!env.AGENT_TOKEN) return true;
  const header = request.headers.get("x-agent-token");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === env.AGENT_TOKEN || bearer === env.AGENT_TOKEN;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function dashboardHtml(kpis: Awaited<ReturnType<Store["kpis"]>>, rows: Awaited<ReturnType<Store["list"]>>, benchmarks: Awaited<ReturnType<Store["benchmarks"]>>) {
  const latest = benchmarks[0];
  const queue = rows
    .filter((row) => !row.sentAt && row.result.routedTo === "human")
    .slice(-12)
    .reverse();

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Triage Agent — dashboard</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0a0e17; color:#f3ede4; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; line-height:1.5; }
  .wrap { max-width:1180px; margin:0 auto; padding:32px 20px 64px; }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#96a3bd; }
  h1 { font-size:32px; letter-spacing:-.02em; margin:8px 0 4px; }
  h2 { font-size:18px; margin:32px 0 12px; }
  .rule { width:56px; height:2px; background:#d98243; margin:16px 0 24px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
  .card { background:#141c2b; border:1px solid #26314a; border-radius:9px; padding:16px; }
  .card strong { display:block; font-size:26px; margin-top:6px; letter-spacing:-.02em; }
  .card span { color:#96a3bd; font-size:12px; }
  table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
  th, td { text-align:left; padding:10px 8px; border-bottom:1px solid #26314a; vertical-align:top; }
  th { font:600 10px/1.4 ui-monospace,Menlo,monospace; letter-spacing:.08em; text-transform:uppercase; color:#96a3bd; }
  .tag { display:inline-block; border:1px solid #3e5fa8; color:#96a3bd; border-radius:3px; padding:2px 6px; font:10px/1.4 ui-monospace,monospace; }
  .tag.good { border-color:#a6e83c; color:#a6e83c; }
  .tag.warn { border-color:#ffb43d; color:#ffb43d; }
  .btn { border:1px solid #d98243; background:#d98243; color:#170d04; font:600 12px/1 ui-monospace,monospace; padding:8px 10px; border-radius:3px; cursor:pointer; }
  .btn.alt { background:transparent; color:#f3ede4; border-color:#3e5fa8; }
  .note { border-left:2px solid #ffb43d; padding:10px 14px; background:#141c2b; font-size:13px; color:#c7cfdd; }
  pre { white-space:pre-wrap; word-break:break-word; font-size:11px; color:#96a3bd; }
  .actions { display:flex; gap:6px; flex-wrap:wrap; }
  .demo { border:1px solid #2A313E; border-radius:8px; padding:16px; background:#12161D; margin-top:24px; }
  .demo textarea { width:100%; min-height:110px; background:#0B0E13; color:#F9FAFB; border:1px solid #2A313E; border-radius:4px; padding:10px; font:13px/1.5 ui-monospace,monospace; }
  .demo .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
  .demo pre { white-space:pre-wrap; word-break:break-word; font-size:11px; color:#C2C6D4; }
  @media (max-width:700px) { table, thead, tbody, tr, th, td { display:block; } th { display:none; } td { border:0; padding:4px 0; } tr { border-bottom:1px solid #26314a; padding:10px 0; } }
</style>
</head>
<body>
<div class="wrap">
  <p class="mono">Progetto P1 · dati sintetici dichiarati</p>
  <h1>Triage Agent</h1>
  <p class="mono">Human-in-the-loop · audit trail · metriche misurate</p>
  <div class="rule"></div>

  <h2>Contatori live della demo</h2>
  <div class="grid">
    <div class="card"><span>Ticket processati</span><strong>${kpis.sampleSize}</strong></div>
    <div class="card"><span>Accuratezza tipo</span><strong>${percent(kpis.accuracyType)}</strong></div>
    <div class="card"><span>Auto-route</span><strong>${percent(kpis.autoRouteRate)}</strong></div>
    <div class="card"><span>Revisione umana</span><strong>${percent(kpis.manualReviewRate)}</strong></div>
    <div class="card"><span>Copertura audit</span><strong>${percent(kpis.auditCoverage)}</strong></div>
    <div class="card"><span>Latenza media</span><strong>${kpis.avgProcessingMs > 0 ? kpis.avgProcessingMs + " ms" : "—"}</strong></div>
    <div class="card"><span>Inviati</span><strong>${kpis.sentCount}</strong></div>
    <div class="card"><span>In attesa</span><strong>${kpis.pendingCount}</strong></div>
  </div>

  <h2>Benchmark congelato · bench-1794868562337</h2>
  <div class="grid">
    <div class="card"><span>Ticket</span><strong>${latest?.sampleSize ?? "—"}</strong></div>
    <div class="card"><span>Accuratezza tipo</span><strong>${latest ? (latest.metrics.accuracyType * 100).toFixed(1) + "%" : "—"}</strong></div>
    <div class="card"><span>Auto-route</span><strong>${latest ? (latest.metrics.autoRouteRate * 100).toFixed(1) + "%" : "—"}</strong></div>
    <div class="card"><span>Copertura audit</span><strong>${latest ? percent(latest.metrics.auditCoverage) : "—"}</strong></div>
  </div>
  <p style="font-size:12px;color:#9CA3AF">I contatori live includono i ticket generati dai visitatori. Il benchmark è il risultato congelato del 16 novembre 2026 su 120 ticket sintetici.</p>

  <h2>Prova il triage</h2>
  <div class="demo">
    <p style="font-size:13px;color:#9CA3AF">Incolla un ticket <strong style="color:#F9FAFB">inventato</strong>. Non usare dati reali di clienti: questa è una demo con dati sintetici.</p>
    <textarea id="demo-text" aria-label="Testo del ticket" placeholder="Es. Il cliente segnala un ritardo nell'ordine ORD-4021, serve una risposta entro oggi."></textarea>
    <div class="row">
      <button class="btn" id="demo-run">Analizza</button>
      <button class="btn alt" id="demo-copy" hidden>Copia JSON</button>
      <span class="mono" id="demo-status" role="status" aria-live="polite"></span>
    </div>
    <pre id="demo-result" hidden></pre>
  </div>

  <h2>Coda di approvazione</h2>
  <table>
    <thead><tr><th>ID</th><th>Oggetto</th><th>Previsione</th><th>Confidenza</th><th>Azioni</th></tr></thead>
    <tbody>
      ${queue.length ? queue.map((row) => `<tr data-id="${escapeHtml(row.ticket.id)}">
        <td><span class="mono">${escapeHtml(row.ticket.id)}</span></td>
        <td>${escapeHtml(row.ticket.subject)}<br /><span class="mono">${escapeHtml(row.result.reason)}</span></td>
        <td><span class="tag">${escapeHtml(row.result.prediction.type)}</span> <span class="tag">${escapeHtml(row.result.prediction.urgency)}</span></td>
        <td>${row.result.prediction.confidence}</td>
        <td><div class="actions"><button class="btn" data-action="approve">Approva</button><button class="btn alt" data-action="reject">Scarta</button><button class="btn alt" data-action="send">Invia</button></div></td>
      </tr>`).join("") : `<tr><td colspan="5">Nessun ticket in coda. Esegui il benchmark o genera un ticket di esempio.</td></tr>`}
    </tbody>
  </table>

  <h2>Ultimo benchmark</h2>
  <div class="card">
    ${latest ? `<p class="mono">${escapeHtml(latest.createdAt)} · ${latest.sampleSize} ticket · soglia ${latest.threshold}</p>
    <pre>${escapeHtml(JSON.stringify(latest.metrics, null, 2))}</pre>` : `<p>Nessun benchmark eseguito.</p>`}
  </div>

  <p class="note" style="margin-top:24px">${escapeHtml(SYNTHETIC_DECLARATION)}</p>
  <p class="mono" style="margin-top:16px">Baseline dichiarato: ${kpis.declaredBaselineHandlingSec ?? "—"} s/ticket · Revisione umana misurata: ${kpis.measuredAvgReviewSec ?? "non registrata"} s</p>
</div>
<script>
document.querySelectorAll("button[data-action]").forEach(function(button) {
  button.addEventListener("click", async function() {
    var id = button.closest("tr").dataset.id;
    var action = button.dataset.action;
    var body = action === "approve" || action === "reject"
      ? { decision: action, actor: "reviewer@local", note: "dashboard" }
      : {};
    var url = action === "send"
      ? "api/tickets/" + encodeURIComponent(id) + "/send"
      : "api/tickets/" + encodeURIComponent(id) + "/decide";
    var response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    button.textContent = response.ok ? "Fatto" : "Errore";
    if (response.ok) setTimeout(function() { location.reload(); }, 250);
  });
});
document.getElementById("demo-run").addEventListener("click", async function() {
  var text = document.getElementById("demo-text").value;
  var status = document.getElementById("demo-status");
  status.textContent = "Analisi in corso…";
  var response = await fetch("api/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "", body: text, locale: "it" })
  });
  var data = await response.json();
  if (!response.ok) { status.textContent = data.error || "Errore"; return; }
  status.textContent = "Completato · " + data.ticketId;
  var out = document.getElementById("demo-result");
  out.textContent = JSON.stringify(data.result, null, 2);
  out.hidden = false;
  document.getElementById("demo-copy").hidden = false;
});
document.getElementById("demo-copy").addEventListener("click", async function() {
  await navigator.clipboard.writeText(document.getElementById("demo-result").textContent);
  this.textContent = "Copiato";
});
</script>
</body>
</html>`;
}

export async function fetch(request: Request, env: Env = {}): Promise<Response> {
  const url = new URL(request.url);
  // Deployed behind a more specific Worker Route on the main domain, the same
  // handler must also work from the bare workers.dev URL.
  const base = "/triage-agent";
  const path = url.pathname.startsWith(base)
    ? url.pathname.slice(base.length) || "/"
    : url.pathname;
  const store = storeFor(env);
  const threshold = Number(env.CONFIDENCE_THRESHOLD ?? 0.72);

  if (path === "/health") return json({ ok: true, synthetic: true, engine: "deterministic-v1" });

  if (path === "/" && request.method === "GET") {
    const [kpis, rows, benchmarks] = await Promise.all([store.kpis(), store.list(), store.benchmarks()]);
    return new Response(dashboardHtml(kpis, rows, benchmarks), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (path === "/api/kpis" && request.method === "GET") return json(await store.kpis());

  if (path === "/api/tickets" && request.method === "GET") {
    const rows = await store.list();
    return json(rows.map((row) => ({
      id: row.ticket.id,
      subject: row.ticket.subject,
      synthetic: true,
      routedTo: row.result.routedTo,
      prediction: row.result.prediction,
      decision: row.decision?.decision ?? null,
      sentAt: row.sentAt ?? null,
    })));
  }

  if (path === "/api/audits" && request.method === "GET") {
    return json(await store.audits(url.searchParams.get("ticket") ?? undefined));
  }

  if (path === "/api/benchmarks" && request.method === "GET") return json(await store.benchmarks());

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  // The interactive demo is public; all management endpoints require a token.
  if (path !== "/api/triage" && !authorized(request, env)) return json({ error: "Unauthorized" }, 401);

  if (path === "/api/tickets") {
    const body = (await request.json().catch(() => ({}))) as {
      ticket?: Partial<SyntheticTicket>;
      count?: number;
    };
    let ticket: SyntheticTicket;
    if (body.ticket) {
      const generated = generateDataset(1)[0]!;
      ticket = {
        ...generated,
        ...body.ticket,
        id: String(body.ticket.id ?? generated.id),
        synthetic: true,
      } as SyntheticTicket;
    } else {
      const count = Math.max(1, Math.min(20, Number(body.count ?? 1)));
      ticket = generateDataset(count).at(-1)!;
    }
    const result = await triage(ticket, env, threshold);
    await store.put(ticket, result);
    await store.audit({
      ticketId: ticket.id,
      actor: "system",
      action: "ingested",
      detail: { synthetic: true, source: ticket.from },
      createdAt: new Date().toISOString(),
    });
    await store.audit({
      ticketId: ticket.id,
      actor: result.prediction.model,
      action: "classified",
      detail: {
        type: result.prediction.type,
        urgency: result.prediction.urgency,
        confidence: result.prediction.confidence,
        routedTo: result.routedTo,
        reason: result.reason,
      },
      createdAt: result.createdAt,
    });
    return json({ ticket, result }, 201);
  }

  // Interactive demo: a visitor pastes an invented ticket and gets a real
  // triage result. The UI warns not to paste real customer data.
  if (path === "/api/triage" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      subject?: string;
      body?: string;
      locale?: "it" | "en";
    };
    const subject = sanitize(String(body.subject ?? ""), 160);
    const text = sanitize(String(body.body ?? ""), 4000);
    if (text.length < 10) return json({ error: "Inserisci almeno 10 caratteri di testo." }, 400);
    const locale = body.locale === "en" ? "en" : "it";
    const ticket: SyntheticTicket = {
      id: `demo-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      locale,
      subject: subject || (locale === "it" ? "Richiesta di prova" : "Test request"),
      body: text,
      from: "demo@example.test",
      synthetic: true,
      groundTruth: {
        type: "richiesta_informazioni",
        urgency: "media",
        client: "",
        fields: {},
        baselineHandlingSec: 0,
      },
    };
    const result = await triage(ticket, {}, threshold);
    await store.put(ticket, result);
    await store.audit({
      ticketId: ticket.id,
      actor: "visitor",
      action: "demo_submitted",
      detail: { syntheticDeclarationAccepted: true },
      createdAt: new Date().toISOString(),
    });
    return json({ ticketId: ticket.id, result }, 201);
  }

  const decideMatch = path.match(/^\/api\/tickets\/([^/]+)\/decide$/);
  if (decideMatch) {
    const body = (await request.json().catch(() => ({}))) as {
      decision?: string;
      actor?: string;
      note?: string;
      editedDraft?: string;
      reviewSeconds?: number;
    };
    if (body.decision !== "approve" && body.decision !== "reject") {
      return json({ error: "decision must be approve or reject" }, 400);
    }
    const id = decodeURIComponent(decideMatch[1]!);
    const ok = await store.decide(id, {
      decision: body.decision,
      actor: body.actor ?? "reviewer@local",
      note: body.note,
      editedDraft: body.editedDraft,
      reviewSeconds: body.reviewSeconds,
    });
    if (!ok) return json({ error: "Ticket not found" }, 404);
    await store.audit({
      ticketId: id,
      actor: body.actor ?? "reviewer@local",
      action: body.decision,
      detail: { note: body.note, edited: Boolean(body.editedDraft), reviewSeconds: body.reviewSeconds },
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true });
  }

  const sendMatch = path.match(/^\/api\/tickets\/([^/]+)\/send$/);
  if (sendMatch) {
    const id = decodeURIComponent(sendMatch[1]!);
    const ok = await store.send(id);
    if (!ok) return json({ error: "Ticket not found or not approved" }, 409);
    await store.audit({
      ticketId: id,
      actor: "system",
      action: "simulated_send",
      detail: { realEmailSent: false },
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true, realEmailSent: false });
  }

  if (path === "/api/benchmark") {
    const body = (await request.json().catch(() => ({}))) as { count?: number; seed?: number };
    const count = Math.max(1, Math.min(500, Number(body.count ?? 120)));
    const tickets = generateDataset(count, Number(body.seed ?? 20261116));
    const result = await runBenchmark(store, tickets, env, threshold);
    return json(result, 201);
  }

  return json({ error: "Not found" }, 404);
}

// Workers also accept a default export with a fetch handler.
export default { fetch };
