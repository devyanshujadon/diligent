import { getInstancePool, runAgentTurn } from "./agent37";
import { monidTractionContext } from "./monid";
import { embedText, openaiJson } from "./openai";
import {
  extractJsonObject,
  floorReview,
  normalizeFindings,
  parsePlan,
  parseReviews,
  parseVerdict,
} from "./parse";
import {
  EXTRACT_FINDINGS,
  EXTRACT_PLAN,
  EXTRACT_REVIEWS,
  criticPrompt,
  plannerPrompt,
  researchPrompt,
  retryPrompt,
  writerPrompt,
} from "./prompts";
import {
  addEvent,
  addFindings,
  matchFindings,
  saveMemo,
  setEmbedding,
  setStatus,
  updateCompany,
} from "./store";
import type { FindingDraft, Plan, ResearchAgent } from "./types";
import { RESEARCH_AGENTS } from "./types";

async function emit(runId: string, agent: string, type: string, message: string): Promise<void> {
  try {
    await addEvent(runId, agent, type, message);
  } catch (error) {
    console.error("event write failed", error instanceof Error ? error.message : error);
  }
}

async function toFindings(text: string): Promise<FindingDraft[]> {
  const direct = normalizeFindings(extractJsonObject(text));
  if (!process.env.OPENAI_API_KEY) return direct;
  try {
    const extracted = await openaiJson(EXTRACT_FINDINGS, text.slice(0, 14_000));
    const parsed = normalizeFindings(extractJsonObject(extracted));
    return parsed.length ? parsed : direct;
  } catch (error) {
    console.error("extraction failed", error instanceof Error ? error.message : error);
    return direct;
  }
}

async function judge(
  instanceId: string,
  plan: Plan,
  drafts: FindingDraft[],
  onTrace: (message: string) => void,
): Promise<Array<{ status: "accepted" | "rejected"; reason: string | null }>> {
  if (!drafts.length) return [];
  const turn = await runAgentTurn({
    instanceId,
    input: criticPrompt(plan.company_name, drafts),
    effort: "low",
    timeoutMs: 90_000,
    onTrace: (event) => onTrace(event.message),
  });
  let raw = extractJsonObject(turn.outputText);
  if (!raw && process.env.OPENAI_API_KEY) {
    const extracted = await openaiJson(EXTRACT_REVIEWS, turn.outputText.slice(0, 12_000));
    raw = extractJsonObject(extracted);
  }
  const reviews = parseReviews(raw, drafts.length);
  if (!reviews.length) throw new Error("The critic did not return reviews.");
  return drafts.map((_, index) => {
    const review = reviews.find((item) => item.index === index);
    if (!review) return { status: "rejected" as const, reason: "The critic skipped this claim." };
    return { status: review.status, reason: review.reason };
  });
}

export async function runPipeline(
  runId: string,
  companyId: string,
  rawInput: string,
  parsed: { name: string; url: string | null },
): Promise<void> {
  try {
    await setStatus(runId, "planning");
    await emit(runId, "planner", "status", "Starting the Agent37 runtime.");
    const pool = await getInstancePool();
    await emit(runId, "planner", "status", `Instance ${pool.map((id) => id).join(", ")} is up.`);

    const planTurn = await runAgentTurn({
      instanceId: pool[0],
      input: plannerPrompt(rawInput, ""),
      effort: "minimal",
      timeoutMs: 90_000,
      onTrace: (event) => {
        void emit(runId, "planner", event.kind, event.message);
      },
    });
    let planRaw = extractJsonObject(planTurn.outputText);
    if (!planRaw && process.env.OPENAI_API_KEY) {
      planRaw = extractJsonObject(await openaiJson(EXTRACT_PLAN, planTurn.outputText.slice(0, 8000)));
    }
    const plan = parsePlan(planRaw, parsed.name, parsed.url);
    if (plan.company_name !== parsed.name || plan.url !== parsed.url) {
      await updateCompany(companyId, { name: plan.company_name, url: plan.url });
    }
    await emit(runId, "planner", "message", `Plan ready. Market: ${plan.market}.`);

    let memory = "";
    if (process.env.OPENAI_API_KEY) {
      try {
        const embedding = await embedText(`${plan.company_name}\n${plan.market}`);
        const hits = (await matchFindings(embedding, 6)).filter((hit) => hit.run_id !== runId);
        if (hits.length) {
          memory = hits.map((hit) => `- (${hit.agent}, ${hit.similarity.toFixed(2)}) ${hit.claim} — ${hit.source_url}`).join("\n");
          await emit(runId, "planner", "message", `Memory: ${hits.length} prior findings passed to the researchers.`);
        } else {
          await emit(runId, "planner", "message", "Memory: no close prior findings.");
        }
      } catch (error) {
        await emit(runId, "planner", "message", `Memory search skipped. ${error instanceof Error ? error.message : ""}`.trim());
      }
    }

    let monid: string | null = null;
    if (process.env.MONID_API_KEY) {
      await emit(runId, "traction_team", "status", "Asking Monid for a funding or news endpoint.");
      try {
        monid = await monidTractionContext(plan.company_name, plan.url);
        await emit(runId, "traction_team", "message", monid ? "Monid context attached to traction research." : "Monid had nothing to attach.");
      } catch (error) {
        await emit(runId, "traction_team", "message", `Monid skipped. ${error instanceof Error ? error.message : ""}`.trim());
      }
    }

    await setStatus(runId, "researching");
    const batches = await Promise.all(
      RESEARCH_AGENTS.map(async (agent, index) => {
        try {
          await emit(runId, agent, "status", "Researching.");
          const turn = await runAgentTurn({
            instanceId: pool[index % pool.length],
            input: researchPrompt({
              agent,
              plan,
              task: plan.tasks[agent],
              memory,
              extra: agent === "traction_team" ? monid : null,
            }),
            effort: "low",
            timeoutMs: 150_000,
            onTrace: (event) => {
              void emit(runId, agent, event.kind, event.message);
            },
          });
          const drafts = await toFindings(turn.outputText);
          await emit(runId, agent, "message", drafts.length ? `Filed ${drafts.length} candidate claims.` : "No sourced claims in the reply.");
          return { agent, drafts };
        } catch (error) {
          await emit(runId, agent, "error", error instanceof Error ? error.message : "Research failed.");
          return { agent, drafts: [] as FindingDraft[] };
        }
      }),
    );

    const flat = batches.flatMap((batch) => batch.drafts.map((draft) => ({ agent: batch.agent, draft })));
    await setStatus(runId, "critiquing");
    await emit(runId, "critic", "status", `Reviewing ${flat.length} claims.`);
    const reviews = flat.length
      ? await judge(pool[0], plan, flat.map((item) => item.draft), (message) => {
          void emit(runId, "critic", "tool", message);
        })
      : [];

    const accepted: Array<{ agent: ResearchAgent; draft: FindingDraft }> = [];
    const rejectedGroups = new Map<ResearchAgent, Array<{ draft: FindingDraft; reason: string }>>();
    const rejectedRows: Array<{
      agent: string;
      claim: string;
      evidence_quote: string | null;
      source_url: string | null;
      confidence: number | null;
      status: "rejected";
      reject_reason: string | null;
    }> = [];

    for (let index = 0; index < flat.length; index++) {
      const item = flat[index];
      const review = reviews[index] ?? { status: "rejected" as const, reason: "No review." };
      const decision = floorReview(item.draft, review);
      if (decision.status === "accepted") {
        accepted.push(item);
        continue;
      }
      const reason = decision.reason ?? "Rejected.";
      const group = rejectedGroups.get(item.agent) ?? [];
      group.push({ draft: item.draft, reason });
      rejectedGroups.set(item.agent, group);
      rejectedRows.push({
        agent: item.agent,
        claim: item.draft.claim,
        evidence_quote: item.draft.evidence_quote,
        source_url: item.draft.source_url,
        confidence: item.draft.confidence,
        status: "rejected",
        reject_reason: reason,
      });
      await emit(runId, "critic", "rejected", `Rejected: ${item.draft.claim} — ${reason}`);
      await emit(runId, item.agent, "rejected", `Rejected: ${item.draft.claim} — ${reason}`);
    }
    if (rejectedRows.length) await addFindings(runId, rejectedRows);
    await emit(runId, "critic", "message", `Accepted ${accepted.length}. Rejected ${rejectedRows.length}.`);

    if (rejectedGroups.size) {
      await setStatus(runId, "retrying");
      const retried = await Promise.all(
        Array.from(rejectedGroups.entries()).map(async ([agent, items], index) => {
          try {
            await emit(runId, agent, "status", `Retrying ${items.length} rejected claim${items.length === 1 ? "" : "s"}.`);
            const turn = await runAgentTurn({
              instanceId: pool[index % pool.length],
              input: retryPrompt(
                agent,
                plan,
                items.map((item) => item.draft),
                items.map((item) => item.reason),
              ),
              effort: "low",
              timeoutMs: 120_000,
              onTrace: (event) => {
                void emit(runId, agent, event.kind, event.message);
              },
            });
            const drafts = await toFindings(turn.outputText);
            await emit(runId, agent, "message", drafts.length ? `Retry filed ${drafts.length} replacement claims.` : "Retry found nothing new.");
            return { agent, drafts };
          } catch (error) {
            await emit(runId, agent, "error", error instanceof Error ? error.message : "Retry failed.");
            return { agent, drafts: [] as FindingDraft[] };
          }
        }),
      );
      const retryFlat = retried.flatMap((batch) => batch.drafts.map((draft) => ({ agent: batch.agent, draft })));
      if (retryFlat.length) {
        const retryReviews = await judge(pool[0], plan, retryFlat.map((item) => item.draft), (message) => {
          void emit(runId, "critic", "tool", message);
        });
        const stillRejected = [];
        for (let index = 0; index < retryFlat.length; index++) {
          const item = retryFlat[index];
          const decision = floorReview(item.draft, retryReviews[index] ?? { status: "rejected", reason: "No review." });
          if (decision.status === "accepted") {
            accepted.push(item);
            continue;
          }
          stillRejected.push({
            agent: item.agent,
            claim: item.draft.claim,
            evidence_quote: item.draft.evidence_quote,
            source_url: item.draft.source_url,
            confidence: item.draft.confidence,
            status: "rejected" as const,
            reject_reason: decision.reason,
          });
          await emit(runId, "critic", "rejected", `Retry dropped: ${item.draft.claim} — ${decision.reason}`);
        }
        if (stillRejected.length) await addFindings(runId, stillRejected);
      } else {
        await emit(runId, "critic", "message", "Retry returned nothing. Rejected claims stay dropped.");
      }
    }

    if (!accepted.length) throw new Error("No claims survived the critic.");

    const saved = await addFindings(
      runId,
      accepted.map((item) => ({
        agent: item.agent,
        claim: item.draft.claim,
        evidence_quote: item.draft.evidence_quote,
        source_url: item.draft.source_url,
        confidence: item.draft.confidence,
        status: "accepted" as const,
        reject_reason: null,
      })),
    );

    if (process.env.OPENAI_API_KEY) {
      await Promise.all(
        saved.map(async (finding) => {
          try {
            const embedding = await embedText(`${finding.claim}\n${finding.evidence_quote ?? ""}`);
            await setEmbedding(finding.id, embedding);
          } catch (error) {
            console.error("embed failed", error instanceof Error ? error.message : error);
          }
        }),
      );
    }

    await setStatus(runId, "writing");
    await emit(runId, "writer", "status", "Writing the memo from accepted claims only.");
    const numbered = accepted.map((item, index) => ({ ...item.draft, n: index + 1 }));
    const written = await runAgentTurn({
      instanceId: pool[0],
      input: writerPrompt(plan.company_name, numbered),
      effort: "medium",
      timeoutMs: 120_000,
      onTrace: (event) => {
        void emit(runId, "writer", event.kind, event.message);
      },
    });
    const verdictParsed = parseVerdict(written.outputText);
    const average =
      accepted.reduce((sum, item) => sum + item.draft.confidence, 0) / Math.max(1, accepted.length);
    const verdict = verdictParsed.verdict ?? "Watch";
    const confidence = verdictParsed.confidence ?? Math.round(average * 100) / 100;
    let markdown = written.outputText.trim();
    if (!/^Verdict:/m.test(markdown)) {
      markdown = `Verdict: ${verdict}\nConfidence: ${confidence.toFixed(2)}\n\n${markdown}`;
    }
    await saveMemo({
      id: crypto.randomUUID(),
      run_id: runId,
      markdown,
      verdict,
      confidence,
    });
    await emit(runId, "writer", "message", `Memo ready. Verdict ${verdict}. Confidence ${confidence.toFixed(2)}.`);
    await setStatus(runId, "completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run failed.";
    await emit(runId, "planner", "error", message);
    try {
      await setStatus(runId, "failed");
    } catch (statusError) {
      console.error("status write failed", statusError instanceof Error ? statusError.message : statusError);
    }
  }
}

export function keepPipeline(work: Promise<void>): void {
  const jobs = (globalThis.__diligentJobs ??= new Set());
  jobs.add(work);
  void work.finally(() => jobs.delete(work));
}
