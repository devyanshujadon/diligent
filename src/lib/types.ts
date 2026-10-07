export const AGENTS = [
  { id: "planner", label: "Planner" },
  { id: "product_market", label: "Product & Market" },
  { id: "competitors", label: "Competitors" },
  { id: "traction_team", label: "Traction & Team" },
  { id: "risks", label: "Risks" },
  { id: "critic", label: "Critic" },
  { id: "writer", label: "Writer" },
] as const;

export const RESEARCH_AGENTS = [
  "product_market",
  "competitors",
  "traction_team",
  "risks",
] as const;

export type AgentId = (typeof AGENTS)[number]["id"];
export type ResearchAgent = (typeof RESEARCH_AGENTS)[number];

export type RunStatus =
  | "queued"
  | "planning"
  | "researching"
  | "critiquing"
  | "retrying"
  | "writing"
  | "completed"
  | "failed";

export type FindingStatus = "accepted" | "rejected";

export interface Company {
  id: string;
  name: string;
  url: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  company_id: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
}

export interface AgentEvent {
  id: string;
  run_id: string;
  agent: string;
  type: string;
  message: string;
  created_at: string;
}

export interface Finding {
  id: string;
  run_id: string;
  agent: string;
  claim: string;
  evidence_quote: string | null;
  source_url: string | null;
  confidence: number | null;
  status: FindingStatus;
  reject_reason: string | null;
  embedding?: number[] | null;
  created_at?: string;
}

export interface Memo {
  id: string;
  run_id: string;
  markdown: string;
  verdict: string | null;
  confidence: number | null;
}

export interface RunListItem {
  run: Run;
  company: Company;
  memo: Pick<Memo, "verdict" | "confidence"> | null;
}

export interface RunDetail {
  run: Run;
  company: Company;
  events: AgentEvent[];
  findings: Finding[];
  memo: Memo | null;
}

export interface FindingDraft {
  claim: string;
  evidence_quote: string;
  source_url: string;
  confidence: number;
}

export interface Plan {
  company_name: string;
  url: string | null;
  market: string;
  tasks: Record<ResearchAgent, string>;
}

export interface Review {
  index: number;
  status: FindingStatus;
  reason: string | null;
}
