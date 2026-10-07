import { strongModel } from "./openai";

const HOST = "https://api.agent37.com/v1";

export class Agent37Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "Agent37Error";
  }
}

export interface TraceEvent {
  kind: "tool" | "message" | "status";
  message: string;
}

interface TurnResult {
  outputText: string;
  sessionId: string;
  responseId: string;
}

function apiKey(): string {
  const value = process.env.AGENT37_API_KEY;
  if (!value) throw new Agent37Error("AGENT37_API_KEY is not set.", 0);
  return value;
}

function instanceUrl(id: string): string {
  return `https://${id}.agent37.app`;
}

async function errorText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 600);
  } catch {
    return res.statusText;
  }
}

async function hosting(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function waitHealthy(id: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    try {
      const res = await fetch(`${instanceUrl(id)}/v1/health`, {
        headers: { "X-Agent37-Key": apiKey() },
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as { healthy?: boolean; status?: string };
        if (body.healthy === true || body.status === "healthy") return;
      }
    } catch {
      // The instance may still be booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function resolvePool(): Promise<string[]> {
  const many = process.env.AGENT37_INSTANCE_IDS?.split(",").map((item) => item.trim()).filter(Boolean);
  if (many?.length) return many;
  if (process.env.AGENT37_INSTANCE_ID?.trim()) return [process.env.AGENT37_INSTANCE_ID.trim()];

  const listed = await hosting("/instances");
  if (!listed.ok) {
    throw new Agent37Error(`Agent37 list instances failed (${listed.status}): ${await errorText(listed)}`, listed.status);
  }
  const body = (await listed.json()) as { data?: Array<{ id: string; name?: string | null; status?: string }> };
  const existing = (body.data ?? []).find((item) => item.name === "diligent" && item.status !== "deleted");
  if (existing) {
    if (existing.status === "stopped") {
      const started = await hosting(`/instances/${existing.id}/start`, { method: "POST" });
      if (!started.ok) {
        throw new Agent37Error(`Agent37 start failed (${started.status}): ${await errorText(started)}`, started.status);
      }
    }
    await waitHealthy(existing.id);
    return [existing.id];
  }

  const openai = process.env.OPENAI_API_KEY;
  const createBody: Record<string, unknown> = {
    template: "agent37-hermes",
    name: "diligent",
    auto_sleep: true,
    idle_timeout_seconds: 600,
    budget: { credit_micros: 2_000_000 },
  };
  if (openai) {
    createBody.env = {
      AGENT37_LLM_PROXY_URL: "https://api.openai.com",
      AGENT37_MANAGED_TOKEN: openai,
      AGENT37_STARTER_MODEL_ID: strongModel(),
    };
  }
  const created = await hosting("/instances", { method: "POST", body: JSON.stringify(createBody) });
  if (!created.ok) {
    throw new Agent37Error(
      `Agent37 could not create an instance (${created.status}): ${await errorText(created)}. Set AGENT37_INSTANCE_ID if you already have one.`,
      created.status,
    );
  }
  const instance = (await created.json()) as { id?: string };
  if (!instance.id) throw new Agent37Error("Agent37 create returned no instance id.", created.status);
  await waitHealthy(instance.id);
  return [instance.id];
}

export function getInstancePool(): Promise<string[]> {
  if (!globalThis.__diligentPool) {
    globalThis.__diligentPool = resolvePool().catch((error) => {
      globalThis.__diligentPool = null;
      throw error;
    });
  }
  return globalThis.__diligentPool;
}

function emitSseFrame(frame: string, onFrame: (event: string, data: Record<string, unknown>) => void): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  try {
    onFrame(event, JSON.parse(dataLines.join("\n")) as Record<string, unknown>);
  } catch {
    onFrame(event, { raw: dataLines.join("\n") });
  }
}

async function readSse(
  res: Response,
  onFrame: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Agent37Error("Agent37 returned an empty body.", res.status);
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) emitSseFrame(frame, onFrame);
  }
  if (buffer.trim()) emitSseFrame(buffer, onFrame);
}

function toolLabel(data: Record<string, unknown>): string {
  const tool = String(data.tool ?? "tool");
  const label = typeof data.label === "string" ? data.label : "";
  let args = "";
  if (data.arguments && typeof data.arguments === "object") {
    args = ` ${JSON.stringify(data.arguments).slice(0, 160)}`;
  }
  return `${tool}${label ? `: ${label}` : ""}${args}`.trim();
}

async function postTurn(
  instanceId: string,
  input: string,
  model: string | undefined,
  effort: string,
  onTrace?: (event: TraceEvent) => void,
  timeoutMs = 150_000,
): Promise<TurnResult> {
  const body: Record<string, unknown> = {
    input,
    stream: true,
    reasoning_effort: effort,
    metadata: { app: "diligent" },
  };
  if (model) body.model = model;
  const res = await fetch(`${instanceUrl(instanceId)}/v1/responses`, {
    method: "POST",
    headers: {
      "X-Agent37-Key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Agent37Error(`Agent37 ${res.status}: ${await errorText(res)}`, res.status);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const payload = JSON.parse((await res.text()).trim()) as {
      id?: string;
      session_id?: string;
      status?: string;
      output_text?: string;
      error?: { message?: string; code?: string };
    };
    if (payload.status === "failed") {
      throw new Agent37Error(payload.error?.message || "Agent37 turn failed.", 200, payload.error?.code);
    }
    return {
      outputText: payload.output_text ?? "",
      sessionId: payload.session_id ?? "",
      responseId: payload.id ?? "",
    };
  }

  let output = "";
  let sessionId = "";
  let responseId = "";
  let failure: Agent37Error | null = null;
  await readSse(res, (event, data) => {
    if (event === "response.created") {
      sessionId = String(data.session_id ?? sessionId);
      responseId = String(data.id ?? responseId);
    } else if (event === "response.tool_call.started" || event === "response.tool_call.generating") {
      onTrace?.({ kind: "tool", message: toolLabel(data) });
    } else if (event === "response.tool_call.failed") {
      onTrace?.({ kind: "tool", message: `${toolLabel(data)} failed` });
    } else if (event === "response.output_text.delta" && typeof data.text === "string") {
      output += data.text;
    } else if (event === "response.completed") {
      if (typeof data.output_text === "string" && data.output_text) output = data.output_text;
    } else if (event === "response.failed") {
      const err = data.error as { message?: string; code?: string } | undefined;
      failure = new Agent37Error(err?.message || "Agent37 turn failed.", 200, err?.code);
    }
  });
  if (failure) throw failure;
  return { outputText: output, sessionId, responseId };
}

function isModelMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /model|provider|unknown/i.test(message);
}

export async function runAgentTurn(options: {
  instanceId: string;
  input: string;
  effort?: string;
  timeoutMs?: number;
  onTrace?: (event: TraceEvent) => void;
}): Promise<TurnResult> {
  const effort = options.effort ?? "low";
  try {
    return await postTurn(options.instanceId, options.input, strongModel(), effort, options.onTrace, options.timeoutMs);
  } catch (error) {
    if (!isModelMismatch(error)) throw error;
    options.onTrace?.({
      kind: "status",
      message: `Model ${strongModel()} was refused. Retrying on the instance default.`,
    });
    return postTurn(options.instanceId, options.input, undefined, effort, options.onTrace, options.timeoutMs);
  }
}
