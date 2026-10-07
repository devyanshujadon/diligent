import type { FindingDraft, Plan, ResearchAgent } from "./types";

const JSON_ONLY = "Reply with one JSON object and no markdown fences.";

export function plannerPrompt(input: string, memory: string): string {
  return `You are the planner for Diligent, a one-page investment diligence desk.
Do not use tools. Do not browse. Decide the research plan from the input alone.

Company input: ${input}

Prior memory from earlier diligences (context only, may be empty):
${memory || "(none)"}

${JSON_ONLY}
{
  "company_name": "canonical name",
  "url": "https://... or null",
  "market": "short market label",
  "tasks": {
    "product_market": "what to research",
    "competitors": "what to research",
    "traction_team": "what to research",
    "risks": "what to research"
  }
}`;
}

export function researchPrompt(options: {
  agent: ResearchAgent;
  plan: Plan;
  task: string;
  memory: string;
  extra?: string | null;
}): string {
  const role = {
    product_market: "Product and market analyst",
    competitors: "Competitive analyst",
    traction_team: "Traction and team analyst",
    risks: "Risk analyst",
  }[options.agent];
  return `You are the ${role} at Diligent.
Company: ${options.plan.company_name}
URL: ${options.plan.url ?? "unknown"}
Market: ${options.plan.market}
Task: ${options.task}

Prior memory from earlier diligences. Do not cite it unless you open the URL yourself and copy a quote:
${options.memory || "(none)"}

${options.extra ? `Auxiliary context. Not a citable source unless it contains a real page URL and a verbatim sentence:\n${options.extra}\n` : ""}
Rules:
- Use web_search, then open at least one page. Stop after 2 searches and 1 page fetch.
- Do not answer from memory. If you cannot find a source, return fewer findings.
- Return 3 to 5 findings. Each evidence_quote must be copied verbatim from the page.
- source_url must be the http(s) URL of that page. confidence is 0 to 1.
- ${JSON_ONLY}
{"findings":[{"claim":"","evidence_quote":"","source_url":"","confidence":0.5}]}`;
}

export function retryPrompt(agent: ResearchAgent, plan: Plan, rejected: FindingDraft[], reasons: string[]): string {
  const packet = rejected
    .map((finding, index) => `${index + 1}. Claim: ${finding.claim}\nQuote: ${finding.evidence_quote}\nURL: ${finding.source_url}\nCritic: ${reasons[index] ?? "unsupported"}`)
    .join("\n\n");
  return `You are retrying rejected findings for ${plan.company_name} (${agent}).
The critic rejected these. Search once more and replace them with sourced findings, or return an empty list.
Do not repeat a claim you still cannot source.

${packet}

Use at most 1 web search and 1 page fetch.
${JSON_ONLY}
{"findings":[{"claim":"","evidence_quote":"","source_url":"","confidence":0.5}]}`;
}

export function criticPrompt(company: string, findings: FindingDraft[]): string {
  const packet = findings
    .map(
      (finding, index) =>
        `[${index}] claim: ${finding.claim}\nquote: ${finding.evidence_quote}\nurl: ${finding.source_url}`,
    )
    .join("\n\n");
  return `You are the critic at Diligent. Do not use tools. Do not browse.
Company: ${company}

Reject a finding when the source_url is missing or not http(s), the quote is empty, or the quote does not actually support the claim (different company, number not in the quote, or a slogan standing in for a market-share figure).
Accept it when the quote, read literally, supports the claim.

${packet}

${JSON_ONLY}
{"reviews":[{"index":0,"status":"accepted","reason":""}]}
Put a one-sentence reason on every rejection. Use "accepted" or "rejected" only.`;
}

export function writerPrompt(company: string, findings: Array<FindingDraft & { n: number }>): string {
  const packet = findings
    .map(
      (finding) =>
        `[${finding.n}] (${finding.source_url}) ${finding.claim}\nQuote: ${finding.evidence_quote}`,
    )
    .join("\n\n");
  return `You are the writer at Diligent. Do not use tools. Do not browse. Do not add facts that are not in the packet.
Company: ${company}

Write a one-page investment memo. Use only these accepted findings. Every sentence ends with one or more citations before the period, like "The round was $18 million [9]." Use only these numbers.
Sections, in order, as markdown headings: Overview, Market, Competition, Traction, Red Flags, Verdict.
The Verdict section is one short paragraph and must still cite findings. Do not mention rejected claims.

Begin the reply with exactly two lines:
Verdict: Pass
Confidence: 0.00
Use Pass, Watch, or Invest. Pass means do not invest. Confidence is 0 to 1.

Findings:
${packet}`;
}

export const EXTRACT_FINDINGS = `Extract diligence findings from analyst notes.
Return JSON {"findings":[{"claim":"","evidence_quote":"","source_url":"","confidence":0.5}]}.
Keep only items with an http(s) source_url and a verbatim evidence_quote.
Do not invent quotes or URLs. If there are none, return {"findings":[]}.`;

export const EXTRACT_PLAN = `Extract the diligence plan as JSON with company_name, url, market, and tasks.product_market, tasks.competitors, tasks.traction_team, tasks.risks. Do not invent a URL if none is present; use null.`;

export const EXTRACT_REVIEWS = `Extract the critic's reviews as JSON {"reviews":[{"index":0,"status":"accepted","reason":""}]}. status is accepted or rejected. Keep the original index numbers.`;
