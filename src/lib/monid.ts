interface DiscoverHit {
  provider?: string;
  endpoint?: string;
  description?: string;
  price?: { type?: string; amount?: number; flatFee?: number };
}

function headers(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function priceOf(hit: DiscoverHit): number {
  const amount = hit.price?.amount ?? 1;
  const flat = hit.price?.flatFee ?? 0;
  return amount + flat;
}

function fillInput(schema: unknown, company: string, url: string | null): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object") return null;
  const properties = (schema as { properties?: Record<string, { type?: string }> }).properties;
  if (!properties) return null;
  const input: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(properties)) {
    if (spec?.type && spec.type !== "string") continue;
    if (/query|search|keyword|q$|company|name|domain|url/i.test(name)) {
      input[name] = /url|domain/i.test(name) && url ? url : company;
      break;
    }
  }
  return Object.keys(input).length ? input : null;
}

async function pollRun(key: string, runId: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    const res = await fetch(`https://api.monid.ai/v1/runs/${runId}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as { status?: string; output?: unknown };
    if (body.status === "COMPLETED" || body.status === "FAILED") return body.output ?? null;
  }
  return null;
}

export async function monidTractionContext(company: string, url: string | null): Promise<string | null> {
  const key = process.env.MONID_API_KEY;
  if (!key) return null;
  const discovered = await fetch("https://api.monid.ai/v1/discover", {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ query: `${company} company funding news`, limit: 5 }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!discovered.ok) return null;
  const discovery = (await discovered.json()) as { results?: DiscoverHit[] };
  const hits = (discovery.results ?? []).filter((hit) => hit.provider && hit.endpoint);
  if (!hits.length) return null;
  const notes = hits
    .slice(0, 3)
    .map((hit) => `- ${hit.provider}${hit.endpoint}: ${hit.description ?? ""}`.trim())
    .join("\n");
  const cheapest = hits.slice().sort((a, b) => priceOf(a) - priceOf(b))[0];
  if (!cheapest?.provider || !cheapest.endpoint || priceOf(cheapest) > 0.05) {
    return `Monid discover (not executed):\n${notes}`;
  }
  const inspected = await fetch("https://api.monid.ai/v1/inspect", {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ provider: cheapest.provider, endpoint: cheapest.endpoint }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!inspected.ok) return `Monid discover (not executed):\n${notes}`;
  const details = (await inspected.json()) as { inputSchema?: unknown };
  const input = fillInput(details.inputSchema, company, url);
  if (!input) return `Monid discover (not executed):\n${notes}`;
  const run = await fetch("https://api.monid.ai/v1/run", {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ provider: cheapest.provider, endpoint: cheapest.endpoint, input }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (run.status === 202) {
    const accepted = (await run.json()) as { runId?: string };
    const output = accepted.runId ? await pollRun(key, accepted.runId) : null;
    return `Monid ${cheapest.provider}${cheapest.endpoint}:\n${JSON.stringify(output).slice(0, 1500)}`;
  }
  if (!run.ok) return `Monid discover (not executed):\n${notes}`;
  const body = await run.json();
  const output = (body as { output?: unknown }).output ?? body;
  return `Monid ${cheapest.provider}${cheapest.endpoint}:\n${JSON.stringify(output).slice(0, 1500)}`;
}
