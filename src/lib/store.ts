import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  seedCompany,
  seedEvents,
  seedFindings,
  seedMemo,
  seedRun,
  SEED_RUN_ID,
} from "./seed-data";
import type {
  AgentEvent,
  Company,
  Finding,
  FindingStatus,
  Memo,
  Run,
  RunDetail,
  RunListItem,
  RunStatus,
} from "./types";

interface FileDb {
  companies: Company[];
  runs: Run[];
  events: AgentEvent[];
  findings: Finding[];
  memos: Memo[];
}

const EMPTY: FileDb = { companies: [], runs: [], events: [], findings: [], memos: [] };
const FILE = path.join(process.cwd(), ".data", "store.json");

let writeChain: Promise<unknown> = Promise.resolve();
let memoryDb: FileDb | null = null;
let fileWritable: boolean | null = null;

function supabaseServer(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function backendName(): "supabase" | "file" {
  return supabaseServer() ? "supabase" : "file";
}

export function configFlags() {
  return {
    supabase: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)),
    agent37: Boolean(process.env.AGENT37_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    monid: Boolean(process.env.MONID_API_KEY),
  };
}

async function readFileDb(): Promise<FileDb> {
  if (memoryDb) return memoryDb;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as FileDb;
    return {
      companies: parsed.companies ?? [],
      runs: parsed.runs ?? [],
      events: parsed.events ?? [],
      findings: parsed.findings ?? [],
      memos: parsed.memos ?? [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

async function mutateFile(fn: (db: FileDb) => void): Promise<void> {
  const run = writeChain.then(async () => {
    const db = memoryDb ?? (await readFileDb());
    fn(db);
    if (fileWritable === false) {
      memoryDb = db;
      return;
    }
    try {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(db));
      fileWritable = true;
      memoryDb = null;
    } catch {
      // Read-only hosts (some containers, serverless) still serve the seed from memory.
      fileWritable = false;
      memoryDb = db;
    }
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function seedPacket() {
  return {
    company: seedCompany,
    run: seedRun,
    findings: seedFindings.map((row, index) => ({
      ...row,
      run_id: SEED_RUN_ID,
      embedding: null,
      created_at: new Date(Date.parse("2026-10-07T18:05:00.000Z") + index * 1000).toISOString(),
    })),
    events: seedEvents,
    memo: seedMemo,
  };
}

async function ensureSeedFile(): Promise<void> {
  await mutateFile((db) => {
    if (db.runs.some((run) => run.id === SEED_RUN_ID)) return;
    const packet = seedPacket();
    db.companies.push(packet.company);
    db.runs.push(packet.run);
    db.findings.push(...packet.findings);
    db.events.push(...packet.events);
    db.memos.push(packet.memo);
  });
}

async function ensureSeedSupabase(client: SupabaseClient): Promise<void> {
  const existing = await client.from("runs").select("id").eq("id", SEED_RUN_ID).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return;
  const packet = seedPacket();
  const company = await client.from("companies").upsert(packet.company).select("id").single();
  if (company.error) throw new Error(company.error.message);
  const run = await client.from("runs").insert(packet.run);
  if (run.error) throw new Error(run.error.message);
  const findings = await client.from("findings").insert(
    packet.findings.map(({ embedding: _embedding, ...row }) => row),
  );
  if (findings.error) throw new Error(findings.error.message);
  const events = await client.from("agent_events").insert(packet.events);
  if (events.error) throw new Error(events.error.message);
  const memo = await client.from("memos").insert(packet.memo);
  if (memo.error) throw new Error(memo.error.message);
}

let seedOnce: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seedOnce) {
    seedOnce = (async () => {
      const client = supabaseServer();
      if (client) await ensureSeedSupabase(client);
      else await ensureSeedFile();
    })().catch((error) => {
      seedOnce = null;
      throw error;
    });
  }
  return seedOnce;
}

export async function listRuns(): Promise<RunListItem[]> {
  await ensureSeed();
  const client = supabaseServer();
  if (!client) {
    const db = await readFileDb();
    return db.runs
      .slice()
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .map((run) => {
        const company = db.companies.find((item) => item.id === run.company_id);
        const memo = db.memos.find((item) => item.run_id === run.id) ?? null;
        return {
          run,
          company: company ?? { id: run.company_id, name: "Unknown", url: null, created_at: run.started_at },
          memo: memo ? { verdict: memo.verdict, confidence: memo.confidence } : null,
        };
      });
  }
  const { data, error } = await client
    .from("runs")
    .select("id, company_id, status, started_at, finished_at, companies(id, name, url, created_at), memos(verdict, confidence)")
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const companyJoin = row.companies as unknown as Company | Company[] | null;
    const company = Array.isArray(companyJoin) ? companyJoin[0] : companyJoin;
    const memoJoin = row.memos as unknown as Pick<Memo, "verdict" | "confidence"> | Array<Pick<Memo, "verdict" | "confidence">> | null;
    const memo = Array.isArray(memoJoin) ? memoJoin[0] ?? null : memoJoin;
    return {
      run: {
        id: row.id,
        company_id: row.company_id,
        status: row.status as RunStatus,
        started_at: row.started_at,
        finished_at: row.finished_at,
      },
      company: company ?? { id: row.company_id, name: "Unknown", url: null, created_at: row.started_at },
      memo,
    };
  });
}

export async function getRun(id: string): Promise<RunDetail | null> {
  await ensureSeed();
  const client = supabaseServer();
  if (!client) {
    const db = await readFileDb();
    const run = db.runs.find((item) => item.id === id);
    if (!run) return null;
    const company = db.companies.find((item) => item.id === run.company_id);
    if (!company) return null;
    return {
      run,
      company,
      events: db.events
        .filter((event) => event.run_id === id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      findings: db.findings
        .filter((finding) => finding.run_id === id)
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")),
      memo: db.memos.find((memo) => memo.run_id === id) ?? null,
    };
  }
  const [runRes, eventRes, findingRes, memoRes] = await Promise.all([
    client.from("runs").select("id, company_id, status, started_at, finished_at, companies(id, name, url, created_at)").eq("id", id).maybeSingle(),
    client.from("agent_events").select("id, run_id, agent, type, message, created_at").eq("run_id", id).order("created_at", { ascending: true }),
    client.from("findings").select("id, run_id, agent, claim, evidence_quote, source_url, confidence, status, reject_reason, created_at").eq("run_id", id).order("created_at", { ascending: true }),
    client.from("memos").select("id, run_id, markdown, verdict, confidence").eq("run_id", id).maybeSingle(),
  ]);
  if (runRes.error) throw new Error(runRes.error.message);
  if (!runRes.data) return null;
  const companyJoin = runRes.data.companies as unknown as Company | Company[] | null;
  const company = Array.isArray(companyJoin) ? companyJoin[0] : companyJoin;
  if (!company) return null;
  if (eventRes.error) throw new Error(eventRes.error.message);
  if (findingRes.error) throw new Error(findingRes.error.message);
  if (memoRes.error) throw new Error(memoRes.error.message);
  return {
    run: {
      id: runRes.data.id,
      company_id: runRes.data.company_id,
      status: runRes.data.status as RunStatus,
      started_at: runRes.data.started_at,
      finished_at: runRes.data.finished_at,
    },
    company,
    events: (eventRes.data ?? []) as AgentEvent[],
    findings: (findingRes.data ?? []) as Finding[],
    memo: (memoRes.data as Memo | null) ?? null,
  };
}

export async function createRun(input: { name: string; url: string | null }): Promise<{ run: Run; company: Company }> {
  const now = new Date().toISOString();
  const company: Company = {
    id: crypto.randomUUID(),
    name: input.name,
    url: input.url,
    created_at: now,
  };
  const run: Run = {
    id: crypto.randomUUID(),
    company_id: company.id,
    status: "queued",
    started_at: now,
    finished_at: null,
  };
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      db.companies.push(company);
      db.runs.push(run);
    });
    return { run, company };
  }
  const companyRes = await client.from("companies").insert(company).select("id, name, url, created_at").single();
  if (companyRes.error) throw new Error(companyRes.error.message);
  const runRes = await client.from("runs").insert(run).select("id, company_id, status, started_at, finished_at").single();
  if (runRes.error) throw new Error(runRes.error.message);
  return { run: runRes.data as Run, company: companyRes.data as Company };
}

export async function updateCompany(id: string, patch: { name?: string; url?: string | null }): Promise<void> {
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      const company = db.companies.find((item) => item.id === id);
      if (!company) return;
      if (patch.name) company.name = patch.name;
      if (patch.url !== undefined) company.url = patch.url;
    });
    return;
  }
  const { error } = await client.from("companies").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setStatus(runId: string, status: RunStatus): Promise<void> {
  const finished = status === "completed" || status === "failed" ? new Date().toISOString() : null;
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      const run = db.runs.find((item) => item.id === runId);
      if (!run) return;
      run.status = status;
      if (finished) run.finished_at = finished;
    });
    return;
  }
  const patch: { status: RunStatus; finished_at?: string } = { status };
  if (finished) patch.finished_at = finished;
  const { error } = await client.from("runs").update(patch).eq("id", runId);
  if (error) throw new Error(error.message);
}

export async function addEvent(runId: string, agent: string, type: string, message: string): Promise<AgentEvent> {
  const event: AgentEvent = {
    id: crypto.randomUUID(),
    run_id: runId,
    agent,
    type,
    message: message.slice(0, 700),
    created_at: new Date().toISOString(),
  };
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      db.events.push(event);
    });
    return event;
  }
  const { error } = await client.from("agent_events").insert(event);
  if (error) throw new Error(error.message);
  return event;
}

export async function addFindings(
  runId: string,
  rows: Array<{
    agent: string;
    claim: string;
    evidence_quote: string | null;
    source_url: string | null;
    confidence: number | null;
    status: FindingStatus;
    reject_reason: string | null;
  }>,
): Promise<Finding[]> {
  if (!rows.length) return [];
  const started = Date.now();
  const findings: Finding[] = rows.map((row, index) => ({
    id: crypto.randomUUID(),
    run_id: runId,
    agent: row.agent,
    claim: row.claim,
    evidence_quote: row.evidence_quote,
    source_url: row.source_url,
    confidence: row.confidence,
    status: row.status,
    reject_reason: row.reject_reason,
    embedding: null,
    created_at: new Date(started + index).toISOString(),
  }));
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      db.findings.push(...findings);
    });
    return findings;
  }
  const payload = findings.map(({ embedding: _embedding, ...row }) => row);
  const { error } = await client.from("findings").insert(payload);
  if (error) throw new Error(error.message);
  return findings;
}

export async function updateFinding(
  id: string,
  patch: Partial<Pick<Finding, "status" | "reject_reason" | "claim" | "evidence_quote" | "source_url" | "confidence">>,
): Promise<void> {
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      const finding = db.findings.find((item) => item.id === id);
      if (!finding) return;
      Object.assign(finding, patch);
    });
    return;
  }
  const { error } = await client.from("findings").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveMemo(memo: Memo): Promise<void> {
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      const index = db.memos.findIndex((item) => item.run_id === memo.run_id);
      if (index >= 0) db.memos[index] = memo;
      else db.memos.push(memo);
    });
    return;
  }
  const { error } = await client.from("memos").upsert(memo);
  if (error) throw new Error(error.message);
}

export async function setEmbedding(id: string, embedding: number[]): Promise<void> {
  const client = supabaseServer();
  if (!client) {
    await mutateFile((db) => {
      const finding = db.findings.find((item) => item.id === id);
      if (finding) finding.embedding = embedding;
    });
    return;
  }
  const { error } = await client
    .from("findings")
    .update({ embedding: `[${embedding.join(",")}]` })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function matchFindings(
  embedding: number[],
  count = 6,
): Promise<Array<Finding & { similarity: number }>> {
  const client = supabaseServer();
  if (!client) {
    const db = await readFileDb();
    return db.findings
      .filter((finding) => finding.status === "accepted" && finding.embedding && finding.embedding.length)
      .map((finding) => ({ ...finding, similarity: cosine(embedding, finding.embedding ?? []) }))
      .filter((finding) => finding.similarity >= 0.55)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, count);
  }
  const { data, error } = await client.rpc("match_findings", {
    query_embedding: `[${embedding.join(",")}]`,
    match_count: count,
    match_threshold: 0.55,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Finding & { similarity: number }>;
}
