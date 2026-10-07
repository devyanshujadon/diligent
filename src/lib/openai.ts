const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const EMBED_URL = "https://api.openai.com/v1/embeddings";

export function strongModel(): string {
  return process.env.OPENAI_STRONG_MODEL || "gpt-5.4";
}

export function extractModel(): string {
  return process.env.OPENAI_EXTRACT_MODEL || "gpt-5.4-nano";
}

export function embedModel(): string {
  return process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
}

function key(): string {
  const value = process.env.OPENAI_API_KEY;
  if (!value) throw new Error("OPENAI_API_KEY is not set.");
  return value;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  return text.slice(0, 500);
}

function textFromResponses(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  if (typeof row.output_text === "string") return row.output_text;
  const output = Array.isArray(row.output) ? row.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("\n");
}

export async function openaiJson(system: string, user: string, model = extractModel()): Promise<string> {
  const headers = {
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/json",
  };
  const chatBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };
  let res = await fetch(CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(chatBody),
    cache: "no-store",
  });
  if (res.status === 400) {
    delete chatBody.response_format;
    res = await fetch(CHAT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(chatBody),
      cache: "no-store",
    });
  }
  if (res.ok) {
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (content) return content;
  } else if (res.status !== 404 && res.status !== 400) {
    const detail = await readError(res);
    if (!/responses/i.test(detail) && res.status < 500) {
      throw new Error(`OpenAI ${res.status}: ${detail}`);
    }
  }

  const responses = await fetch(RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    cache: "no-store",
  });
  if (!responses.ok) {
    throw new Error(`OpenAI ${responses.status}: ${await readError(responses)}`);
  }
  const text = textFromResponses(await responses.json());
  if (!text) throw new Error("OpenAI returned an empty extraction.");
  return text;
}

export async function embedText(input: string): Promise<number[]> {
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: embedModel(),
      input: input.slice(0, 8000),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await readError(res)}`);
  const payload = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error("OpenAI returned an empty embedding.");
  return embedding;
}
