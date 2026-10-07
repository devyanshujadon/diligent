import type { FindingDraft, Plan, ResearchAgent, Review } from "./types";
import { RESEARCH_AGENTS } from "./types";

export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next slice
    }
  }
  return null;
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.4;
  if (n > 1 && n <= 100) return Math.round((n / 100) * 100) / 100;
  return Math.min(1, Math.max(0, n));
}

export function normalizeFindings(raw: unknown): FindingDraft[] {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.findings)
      ? record.findings
      : Array.isArray(record?.claims)
        ? record.claims
        : [];
  const out: FindingDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const claim = String(row.claim ?? row.statement ?? "").trim();
    if (!claim) continue;
    out.push({
      claim: claim.slice(0, 700),
      evidence_quote: String(row.evidence_quote ?? row.quote ?? row.evidence ?? "").trim().slice(0, 1200),
      source_url: String(row.source_url ?? row.url ?? row.source ?? "").trim(),
      confidence: clampConfidence(row.confidence),
    });
  }
  return out;
}

export function parsePlan(raw: unknown, fallbackName: string, fallbackUrl: string | null): Plan {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tasksRaw = row.tasks && typeof row.tasks === "object" ? (row.tasks as Record<string, unknown>) : {};
  const name = String(row.company_name ?? row.name ?? fallbackName).trim() || fallbackName;
  const urlValue = row.url;
  const url =
    typeof urlValue === "string" && isHttpUrl(urlValue)
      ? urlValue.trim()
      : fallbackUrl;
  const market = String(row.market ?? "the company's market").trim() || "the company's market";
  const defaults: Record<ResearchAgent, string> = {
    product_market: `What ${name} sells, who buys it, published pricing, and any sourced market size.`,
    competitors: `Name 3 to 5 competitors of ${name} and how ${name} says it differs.`,
    traction_team: `Funding, founders, job posts, GitHub or open-source activity, and recent news for ${name}.`,
    risks: `Red flags for ${name}: weak moat, vague numbers, regulatory issues, inflated traction.`,
  };
  const tasks = { ...defaults };
  for (const agent of RESEARCH_AGENTS) {
    const value = tasksRaw[agent];
    if (typeof value === "string" && value.trim()) tasks[agent] = value.trim();
  }
  return { company_name: name, url, market, tasks };
}

export function parseReviews(raw: unknown, count: number): Review[] {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.reviews)
      ? record.reviews
      : [];
  const byIndex = new Map<number, Review>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const index = Number(row.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const status = row.status === "rejected" ? "rejected" : row.status === "accepted" ? "accepted" : null;
    if (!status) continue;
    const reason = row.reason == null ? null : String(row.reason).trim() || null;
    byIndex.set(index, { index, status, reason });
  }
  return Array.from(byIndex.values());
}

export function floorReview(
  finding: { source_url?: string | null; evidence_quote?: string | null },
  review: { status: string; reason?: string | null },
): { status: "accepted" | "rejected"; reason: string | null } {
  if (!isHttpUrl(finding.source_url)) {
    return {
      status: "rejected",
      reason: review.status === "rejected" && review.reason ? review.reason : "No real source_url.",
    };
  }
  const quote = finding.evidence_quote?.trim() ?? "";
  if (quote.length < 12) {
    return { status: "rejected", reason: "No supporting quote." };
  }
  if (review.status === "rejected") {
    return {
      status: "rejected",
      reason: review.reason?.trim() || "The quote does not support the claim.",
    };
  }
  return { status: "accepted", reason: null };
}

export function parseVerdict(markdown: string): {
  verdict: "Pass" | "Watch" | "Invest" | null;
  confidence: number | null;
} {
  const verdictMatch = markdown.match(/Verdict:\s*(Pass|Watch|Invest)\b/i);
  const confidenceMatch = markdown.match(/Confidence:\s*(\d+(?:\.\d+)?)\s*(%)?/i);
  let confidence: number | null = null;
  if (confidenceMatch) {
    confidence = clampConfidence(Number(confidenceMatch[1]));
  }
  const label = verdictMatch?.[1];
  const verdict =
    label?.toLowerCase() === "pass"
      ? "Pass"
      : label?.toLowerCase() === "watch"
        ? "Watch"
        : label?.toLowerCase() === "invest"
          ? "Invest"
          : null;
  return { verdict, confidence };
}

export function parseCompanyInput(input: string): { name: string; url: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { name: "", url: null };
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\./, "");
      const stem = host.split(".")[0] || host;
      const name = stem.charAt(0).toUpperCase() + stem.slice(1);
      return { name, url: trimmed };
    } catch {
      return { name: trimmed, url: null };
    }
  }
  return { name: trimmed, url: null };
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "source";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

export function sentencesMissingCitation(markdown: string): string[] {
  const missing: string[] = [];
  for (const line of markdown.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^verdict:/i.test(trimmed) || /^confidence:/i.test(trimmed)) continue;
    for (const sentence of trimmed.split(/(?<=\.)\s+/)) {
      const text = sentence.trim();
      if (!text || !/[A-Za-z]/.test(text)) continue;
      if (!/\[\d+\]/.test(text)) missing.push(text);
    }
  }
  return missing;
}

export function citationNumbers(markdown: string): number[] {
  const found = new Set<number>();
  for (const match of markdown.matchAll(/\[(\d+)\]/g)) {
    found.add(Number(match[1]));
  }
  return Array.from(found).sort((a, b) => a - b);
}
