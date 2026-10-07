export const SEED_COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const SEED_RUN_ID = "22222222-2222-4222-8222-222222222222";
export const SEED_MEMO_ID = "33333333-3333-4333-8333-333333333333";

const T0 = Date.parse("2026-10-07T18:00:00.000Z");

function at(ms: number): string {
  return new Date(T0 + ms).toISOString();
}

export const seedCompany = {
  id: SEED_COMPANY_ID,
  name: "Resend",
  url: "https://resend.com",
  created_at: at(0),
};

export const seedRun = {
  id: SEED_RUN_ID,
  company_id: SEED_COMPANY_ID,
  status: "completed" as const,
  started_at: at(0),
  finished_at: at(22000),
};

interface SeedFinding {
  id: string;
  agent: string;
  claim: string;
  evidence_quote: string;
  source_url: string;
  confidence: number;
  status: "accepted" | "rejected";
  reject_reason: string | null;
}

function finding(n: number, row: Omit<SeedFinding, "id">): SeedFinding {
  return { id: `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`, ...row };
}

export const seedFindings: SeedFinding[] = [
  finding(1, {
    agent: "product_market",
    claim: "Resend is an email API for developers that sends transactional and marketing email at scale.",
    evidence_quote:
      "Resend is the email API for developers. Send transactional and marketing emails at scale with a simple, modern API.",
    source_url: "https://resend.com",
    confidence: 0.93,
    status: "accepted",
    reject_reason: null,
  }),
  finding(2, {
    agent: "product_market",
    claim:
      "Y Combinator describes Resend as an email API for developers to build, test, and send transactional email at scale.",
    evidence_quote:
      "Resend is the new email API for developers. It's designed for you to build, test, and send transactional emails at scale.",
    source_url: "https://www.ycombinator.com/companies/resend",
    confidence: 0.9,
    status: "accepted",
    reject_reason: null,
  }),
  finding(3, {
    agent: "product_market",
    claim:
      "At 500,000 emails a month, Resend's published Scale plan is $350 per month, an effective $0.70 per 1,000 emails.",
    evidence_quote: "500K emails/mo: Scale plan at $350/mo — effective rate of $0.70 per 1,000 emails.",
    source_url: "https://resend.com/pricing.md",
    confidence: 0.88,
    status: "accepted",
    reject_reason: null,
  }),
  finding(4, {
    agent: "product_market",
    claim: "Resend's free plan is limited to 100 emails per day.",
    evidence_quote: "The Free plan is limited to 100 emails per day.",
    source_url: "https://resend.com/pricing.md",
    confidence: 0.9,
    status: "accepted",
    reject_reason: null,
  }),
  finding(5, {
    agent: "competitors",
    claim: "Resend positions itself against SendGrid, Amazon SES, and Postmark.",
    evidence_quote: "If you're using Sendgrid, AWS SES, or Postmark, come talk to us.",
    source_url: "https://www.ycombinator.com/companies/resend",
    confidence: 0.92,
    status: "accepted",
    reject_reason: null,
  }),
  finding(6, {
    agent: "competitors",
    claim: "The CEO frames the ambition as becoming the next Twilio rather than the next SendGrid.",
    evidence_quote:
      "The vision for the company is not to become the next SendGrid — we want to be the next Twilio.",
    source_url: "https://techcrunch.com/2023/07/18/developer-focused-email-platform-resend-raises-3m/",
    confidence: 0.84,
    status: "accepted",
    reject_reason: null,
  }),
  finding(7, {
    agent: "traction_team",
    claim: "Resend was in the Y Combinator Winter 2023 batch and announced a $3 million seed round.",
    evidence_quote:
      "Resend, which participated in the Y Combinator Winter ’23 batch, today announced a $3 million seed funding round.",
    source_url: "https://techcrunch.com/2023/07/18/developer-focused-email-platform-resend-raises-3m/",
    confidence: 0.93,
    status: "accepted",
    reject_reason: null,
  }),
  finding(8, {
    agent: "traction_team",
    claim:
      "At the seed announcement, TechCrunch reported 10,000 developers and more than 7 million transactional emails since a January launch.",
    evidence_quote:
      "Since its launch in January, 10,000 developers have used the platform to send more than 7 million transactional emails.",
    source_url: "https://techcrunch.com/2023/07/18/developer-focused-email-platform-resend-raises-3m/",
    confidence: 0.86,
    status: "accepted",
    reject_reason: null,
  }),
  finding(9, {
    agent: "traction_team",
    claim: "In December 2024 Resend said it raised an $18 million Series A led by Andreessen Horowitz.",
    evidence_quote: "Resend just raised an $18M Series A led by Andreessen Horowitz.",
    source_url: "https://resend.com/blog/series-a",
    confidence: 0.9,
    status: "accepted",
    reject_reason: null,
  }),
  finding(10, {
    agent: "traction_team",
    claim: "The Series A post said more than 200,000 developers had signed up.",
    evidence_quote: "Now, more than 200,000 developers have signed up.",
    source_url: "https://resend.com/blog/series-a",
    confidence: 0.86,
    status: "accepted",
    reject_reason: null,
  }),
  finding(11, {
    agent: "traction_team",
    claim:
      "Zeno Rocha is founder and CEO, previously VP of Developer Experience at WorkOS and CPO at Liferay Cloud.",
    evidence_quote:
      "Founder & CEO at Resend. Previously VP of Developer Experience at WorkOS and CPO at Liferay Cloud.",
    source_url: "https://www.ycombinator.com/companies/resend",
    confidence: 0.9,
    status: "accepted",
    reject_reason: null,
  }),
  finding(12, {
    agent: "traction_team",
    claim: "Bu Kinoshita is co-founder and CTO and is building React Email.",
    evidence_quote: "Co-founder & CTO at Resend and building react.email.",
    source_url: "https://www.ycombinator.com/companies/resend",
    confidence: 0.88,
    status: "accepted",
    reject_reason: null,
  }),
  finding(13, {
    agent: "traction_team",
    claim: "TechCrunch named Jonni Lundy, with Bu Kinoshita, on the founding team.",
    evidence_quote:
      "The founding team, including Bu Kinoshita and Jonni Lundy, is currently concentrating on email.",
    source_url: "https://techcrunch.com/2023/07/18/developer-focused-email-platform-resend-raises-3m/",
    confidence: 0.8,
    status: "accepted",
    reject_reason: null,
  }),
  finding(14, {
    agent: "traction_team",
    claim: "Y Combinator's company page lists Resend's team size as 45.",
    evidence_quote: "Team Size:45",
    source_url: "https://www.ycombinator.com/companies/resend",
    confidence: 0.7,
    status: "accepted",
    reject_reason: null,
  }),
  finding(15, {
    agent: "traction_team",
    claim:
      "The founder said React Email had crossed 300,000 weekly npm downloads, 14,000 GitHub stars, and 130 contributors.",
    evidence_quote:
      "Our open source project, React Email, just crossed 300,000 weekly downloads on npm, 14,000 stars on GitHub, and more than 130 contributors.",
    source_url: "https://news.ycombinator.com/item?id=42318483",
    confidence: 0.78,
    status: "accepted",
    reject_reason: null,
  }),
  finding(16, {
    agent: "risks",
    claim: "Resend's own year-one note celebrated 1,000 paying customers, a much smaller figure than later signup headlines.",
    evidence_quote:
      "We celebrated 1,000 paying customers as we closed the first year of Resend as a company.",
    source_url: "https://resend.com/blog/what-is-next-after-100-000-users",
    confidence: 0.84,
    status: "accepted",
    reject_reason: null,
  }),
  finding(17, {
    agent: "risks",
    claim: "Resend's pricing page says every plan includes SOC 2 Type II and GDPR compliance.",
    evidence_quote:
      "All plans include: RESTful API, SMTP relay, official SDKs, inbound emails, batch sending, open & link tracking, React Email, multi-region, DKIM/SPF/DMARC, webhooks, SOC 2 Type II, GDPR compliance, MFA, and API key permissions.",
    source_url: "https://resend.com/pricing.md",
    confidence: 0.82,
    status: "accepted",
    reject_reason: null,
  }),
  finding(18, {
    agent: "risks",
    claim: "Resend already controls more than half of the developer email market.",
    evidence_quote: "Resend is the email API for developers.",
    source_url: "https://resend.com",
    confidence: 0.15,
    status: "rejected",
    reject_reason:
      "The quote names the product. It does not support a market-share figure.",
  }),
];

export const seedMemoMarkdown = `Verdict: Watch
Confidence: 0.62

## Overview

Resend is the email API for developers, for transactional and marketing email at scale [1]. Y Combinator lists the company in its Winter 2023 batch and describes the product as an API for building, testing, and sending transactional email [2].

## Market

The published buyer is a developer, and the company's YC listing says the product is for teams that need to build, test, and send transactional email at scale [2]. Public pricing starts at a free plan limited to 100 emails a day and, at 500,000 emails a month, a Scale plan of $350 a month [4] [3].

## Competition

Resend asks teams on SendGrid, Amazon SES, or Postmark to switch [5]. The CEO told TechCrunch the goal is not to become the next SendGrid, but the next Twilio [6].

## Traction

TechCrunch reported a $3 million seed after the Winter 2023 batch, and said 10,000 developers had sent more than 7 million transactional emails since a January launch [7] [8]. The company later wrote that it raised an $18 million Series A led by Andreessen Horowitz, and that more than 200,000 developers had signed up [9] [10]. Zeno Rocha, the founder and CEO, previously led developer experience at WorkOS and was chief product officer at Liferay Cloud [11]. Co-founder Bu Kinoshita is CTO and builds React Email, and TechCrunch also named Jonni Lundy on the founding team [12] [13]. Y Combinator lists a team size of 45 [14]. Rocha told Hacker News that React Email had passed 14,000 GitHub stars and 300,000 weekly npm downloads [15].

## Red Flags

The company's own year-one note celebrated 1,000 paying customers, which is a different claim from the later figure of more than 200,000 developer signups [16] [10]. The named alternatives are SendGrid and Amazon SES, and the stated ambition is to compete at the scope of Twilio [5] [6]. Resend does publish SOC 2 Type II and GDPR compliance on its pricing page, so those specific compliance marks are claimed rather than absent [17].

## Verdict

The call is Watch: the product, the price list, and the Series A are sourced, but paying-customer evidence in the packet is stale next to the signup headline, and no source shows a moat against Amazon SES beyond developer experience [9] [16] [5].
`;

export const seedMemo = {
  id: SEED_MEMO_ID,
  run_id: SEED_RUN_ID,
  markdown: seedMemoMarkdown,
  verdict: "Watch",
  confidence: 0.62,
};

export const seedEvents = [
  ["planner", "status", "Reading the company input.", 0],
  ["planner", "message", "Plan ready. Market: developer email infrastructure. Four research tasks dispatched.", 1400],
  ["product_market", "status", "Searching the public web.", 3000],
  ["competitors", "status", "Searching the public web.", 3080],
  ["traction_team", "status", "Searching the public web.", 3160],
  ["risks", "status", "Searching the public web.", 3240],
  ["product_market", "tool", "web_search: Resend email API pricing", 4600],
  ["competitors", "tool", "web_search: Resend vs SendGrid Postmark Amazon SES", 4680],
  ["traction_team", "tool", "web_search: Resend Series A Y Combinator founders", 4760],
  ["risks", "tool", "web_search: Resend paying customers deliverability", 4840],
  ["product_market", "message", "Filed 4 sourced claims, including the published price list.", 6400],
  ["competitors", "message", "Filed 2 sourced claims. Named rivals: SendGrid, Amazon SES, Postmark.", 8000],
  ["traction_team", "message", "Filed 9 sourced claims on funding, founders, headcount, and GitHub.", 9600],
  ["risks", "message", "Filed 2 sourced claims, plus one market-share claim with a weak quote.", 11200],
  ["critic", "status", "Checking every quote against its claim.", 12800],
  [
    "critic",
    "rejected",
    "Rejected: Resend already controls more than half of the developer email market. — The quote names the product. It does not support a market-share figure.",
    14200,
  ],
  ["risks", "rejected", "Rejected: Resend already controls more than half of the developer email market. — The quote names the product. It does not support a market-share figure.", 14240],
  ["critic", "message", "Accepted 17 claims that have a real URL and a quote that supports the sentence.", 15600],
  ["risks", "status", "One retry on the rejected market-share claim.", 17000],
  ["critic", "rejected", "Retry dropped. Still no source for a share of the email market.", 18400],
  ["writer", "status", "Drafting the memo from accepted claims only.", 19800],
  ["writer", "message", "Memo ready. Verdict Watch. Confidence 0.62.", 21200],
].map(([agent, type, message, ms], index) => ({
  id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
  run_id: SEED_RUN_ID,
  agent: String(agent),
  type: String(type),
  message: String(message),
  created_at: at(Number(ms)),
}));
