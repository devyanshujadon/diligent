import assert from "node:assert/strict";
import test from "node:test";
import {
  citationNumbers,
  extractJsonObject,
  floorReview,
  normalizeFindings,
  parseCompanyInput,
  parsePlan,
  parseReviews,
  parseVerdict,
  sentencesMissingCitation,
} from "./parse";
import { seedFindings, seedMemoMarkdown } from "./seed-data";

test("extracts fenced and bare JSON", () => {
  assert.deepEqual(extractJsonObject("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(extractJsonObject("note {\"findings\":[]} thanks"), { findings: [] });
});

test("normalizes findings and drops empty claims", () => {
  const findings = normalizeFindings({
    findings: [
      { claim: "Sells email", evidence_quote: "email API", source_url: "https://resend.com", confidence: 0.8 },
      { statement: "" },
    ],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].source_url, "https://resend.com");
});

test("floor rejects a missing url and keeps a critic rejection", () => {
  assert.equal(floorReview({ source_url: "", evidence_quote: "a long enough quote here" }, { status: "accepted" }).status, "rejected");
  const kept = floorReview(
    { source_url: "https://resend.com", evidence_quote: "Resend is the email API for developers." },
    { status: "rejected", reason: "The quote does not support the share." },
  );
  assert.equal(kept.status, "rejected");
  assert.match(kept.reason ?? "", /share/);
});

test("parses a plan, reviews, verdict, and company input", () => {
  const plan = parsePlan({ company_name: "Resend", url: "https://resend.com", market: "email", tasks: {} }, "X", null);
  assert.equal(plan.tasks.risks.includes("Resend"), true);
  const reviews = parseReviews({ reviews: [{ index: 1, status: "rejected", reason: "no" }] }, 3);
  assert.equal(reviews[0].index, 1);
  assert.deepEqual(parseVerdict("Verdict: Watch\nConfidence: 0.62\n"), { verdict: "Watch", confidence: 0.62 });
  assert.equal(parseCompanyInput("https://resend.com").name, "Resend");
});

test("seed memo cites only real accepted findings", () => {
  const accepted = seedFindings.filter((finding) => finding.status === "accepted").length;
  const missing = sentencesMissingCitation(seedMemoMarkdown);
  assert.deepEqual(missing, []);
  for (const n of citationNumbers(seedMemoMarkdown)) {
    assert.ok(n >= 1 && n <= accepted, `citation ${n} out of range`);
  }
  assert.equal(seedFindings.some((finding) => finding.status === "rejected"), true);
});
