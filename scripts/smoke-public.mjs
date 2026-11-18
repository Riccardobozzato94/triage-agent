import { readFileSync } from "node:fs";
const token = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").trim().split("=")[1];
const base = "https://riccardobozzato.com/triage-agent";

const health = await fetch(`${base}/health`);
console.log("health", health.status, await health.text());

const bench = await fetch(`${base}/api/benchmark`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-agent-token": token },
  body: JSON.stringify({ count: 120 }),
});
const benchData = await bench.json();
console.log("benchmark", bench.status, JSON.stringify(benchData.metrics ?? benchData));

const kpis = await fetch(`${base}/api/kpis`);
console.log("kpis", kpis.status, await kpis.text());

const dash = await fetch(`${base}/`);
const html = await dash.text();
console.log("dashboard", dash.status, "has KPI:", html.includes("Ticket processati"));
