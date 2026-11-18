const base = "http://localhost:8788";

async function call(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  console.log(path, options.method ?? "GET", response.status, text.slice(0, 180));
  return text;
}

(async () => {
  await call("/health");
  const dashboard = await call("/");
  console.log("dashboard has KPI cards:", dashboard.includes("Ticket processati"));
  await call("/api/benchmark", { method: "POST", body: JSON.stringify({ count: 12 }) });
  await call("/api/kpis");
  const ticketsText = await call("/api/tickets");
  const tickets = JSON.parse(ticketsText);
  const first = tickets[0];
  if (first) {
    await call(`/api/tickets/${first.id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", actor: "qa", reviewSeconds: 37 }),
    });
    await call(`/api/tickets/${first.id}/send`, { method: "POST", body: "{}" });
  }
  await call("/api/audits");
})();
