/** Local Node server for the Triage Agent (no Cloudflare account needed). */
import { createServer } from "node:http";
import { fetch as handle } from "./index.ts";
import type { Env } from "./types.ts";

const port = Number(process.env.PORT ?? 8788);
const env: Env = {
  STORE: "memory",
  CONFIDENCE_THRESHOLD: process.env.CONFIDENCE_THRESHOLD ?? "0.72",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  WORKERS_AI_ACCOUNT_ID: process.env.WORKERS_AI_ACCOUNT_ID,
  WORKERS_AI_API_TOKEN: process.env.WORKERS_AI_API_TOKEN,
  AGENT_TOKEN: process.env.AGENT_TOKEN,
};

createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[key] = value;
  }

  const incoming = new Request(`http://localhost:${port}${request.url ?? "/"}`, {
    method: request.method,
    headers,
    body: body && request.method !== "GET" && request.method !== "HEAD" ? body : undefined,
  });

  try {
    const result = await handle(incoming, env);
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(port, () => {
  console.log(`Triage Agent local server: http://localhost:${port}`);
});
