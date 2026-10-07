"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { hostOf } from "@/lib/parse";
import { AGENTS } from "@/lib/types";
import type { AgentEvent, Finding, Memo, RunDetail, RunListItem } from "@/lib/types";

interface Config {
  supabase: boolean;
  agent37: boolean;
  openai: boolean;
  monid: boolean;
}

const ACTIVE: Record<string, string[]> = {
  planning: ["planner"],
  researching: ["product_market", "competitors", "traction_team", "risks"],
  critiquing: ["critic"],
  retrying: ["critic", "product_market", "competitors", "traction_team", "risks"],
  writing: ["writer"],
};

function groupEvents(events: AgentEvent[]): AgentEvent[][] {
  const groups: AgentEvent[][] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && Math.abs(Date.parse(event.created_at) - Date.parse(prev.created_at)) < 700) last.push(event);
    else groups.push([event]);
  }
  return groups;
}

function RichText({ text, count }: { text: string; count: number }) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return <span key={index}>{part}</span>;
    const n = Number(match[1]);
    if (n < 1 || n > count) return <span key={index}>{part}</span>;
    return (
      <a key={index} className="cite" href={`#source-${n}`}>
        [{n}]
      </a>
    );
  });
}

function MemoView({ memo, findings }: { memo: Memo; findings: Finding[] }) {
  const accepted = findings.filter((finding) => finding.status === "accepted");
  const body = memo.markdown
    .replace(/^Verdict:.*$/gim, "")
    .replace(/^Confidence:.*$/gim, "")
    .trim();
  const blocks = body.split(/\n+/).filter((line) => line.trim());
  const verdict = (memo.verdict ?? "Watch").toLowerCase();
  const confidence = memo.confidence ?? 0;
  return (
    <article>
      <div className="memo-top">
        <div>
          <span className={`stamp ${verdict}`}>{memo.verdict ?? "Watch"}</span>
          <p className="hint">Pass means decline. Watch means not yet. Invest means the packet supports a check.</p>
        </div>
        <p className="conf">
          Confidence
          <b>{Math.round(confidence * 100)}%</b>
        </p>
      </div>
      <div className="memo-body">
        {blocks.map((line, index) =>
          line.startsWith("## ") ? (
            <h3 key={index}>{line.replace(/^##\s+/, "")}</h3>
          ) : (
            <p key={index}>
              <RichText text={line} count={accepted.length} />
            </p>
          ),
        )}
      </div>
      <ol className="sources">
        {accepted.map((finding, index) => (
          <li id={`source-${index + 1}`} key={finding.id}>
            <a href={finding.source_url ?? "#"} target="_blank" rel="noreferrer">
              [{index + 1}] {hostOf(finding.source_url)}
            </a>
            <blockquote>{finding.evidence_quote}</blockquote>
          </li>
        ))}
      </ol>
    </article>
  );
}

export function Desk() {
  const [input, setInput] = useState("Resend");
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "live" | "playing">("idle");
  const [shown, setShown] = useState<AgentEvent[] | null>(null);
  const [showMemo, setShowMemo] = useState(true);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lanesRef = useRef<HTMLDivElement>(null);

  async function loadList(selectId?: string) {
    const res = await fetch("/api/runs", { cache: "no-store" });
    const body = (await res.json()) as { runs?: RunListItem[]; config?: Config; error?: string };
    if (body.config) setConfig(body.config);
    if (!res.ok) {
      setError(body.error ?? "Could not load history.");
      return;
    }
    const next = body.runs ?? [];
    setRuns(next);
    const id = selectId ?? detail?.run.id ?? next[0]?.run.id;
    if (id) await openRun(id, false);
  }

  async function openRun(id: string, stopPlay = true) {
    if (stopPlay) {
      if (playTimer.current) clearTimeout(playTimer.current);
      playTimer.current = null;
      setPhase("idle");
    }
    const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
    const body = (await res.json()) as RunDetail & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not open that run.");
      return;
    }
    setDetail(body);
    setShown(null);
    setShowMemo(true);
    setInput(body.company.name);
  }

  function stopPlayback() {
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = null;
    setPhase((current) => (current === "playing" ? "idle" : current));
  }

  useEffect(() => {
    void loadList();
    return () => {
      if (playTimer.current) clearTimeout(playTimer.current);
    };
    // Initial history load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "live" || !detail) return;
    const source = new EventSource(`/api/runs/${detail.run.id}/events`);
    source.onmessage = (message) => {
      const payload = JSON.parse(message.data) as RunDetail & {
        type?: string;
        status?: RunDetail["run"]["status"];
        error?: string;
      };
      if (payload.type === "error") {
        setError(payload.error ?? "The live trace dropped.");
        source.close();
        setPhase("idle");
        return;
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              run: { ...current.run, status: payload.status ?? current.run.status },
              company: payload.company ?? current.company,
              events: payload.events ?? current.events,
              findings: payload.findings ?? current.findings,
              memo: payload.memo ?? current.memo,
            }
          : current,
      );
      if (payload.type === "done") {
        source.close();
        setPhase("idle");
        setShowMemo(true);
        void loadList(detail.run.id);
      }
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setPhase("idle");
    };
    return () => source.close();
    // Rebind only when a live run id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, detail?.run.id]);

  function play() {
    if (!detail || phase === "live") return;
    stopPlayback();
    const groups = groupEvents(detail.events);
    setPhase("playing");
    setShowMemo(false);
    setShown([]);
    let index = 0;
    const step = () => {
      index += 1;
      setShown(groups.slice(0, index).flat());
      if (index >= groups.length) {
        playTimer.current = setTimeout(() => {
          setShowMemo(true);
          setPhase("idle");
        }, 700);
        return;
      }
      const delay = groups[index - 1]?.some((event) => event.type === "rejected") ? 2800 : 1500;
      playTimer.current = setTimeout(step, delay);
    };
    playTimer.current = setTimeout(step, 400);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    stopPlayback();
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const body = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || !body.id) {
      setError(body.error ?? "Could not start.");
      return;
    }
    setShowMemo(false);
    setShown(null);
    setDetail({
      run: {
        id: body.id,
        company_id: "",
        status: "queued",
        started_at: new Date().toISOString(),
        finished_at: null,
      },
      company: { id: "", name: input, url: null, created_at: new Date().toISOString() },
      events: [],
      findings: [],
      memo: null,
    });
    setPhase("live");
  }

  const events = shown ?? detail?.events ?? [];

  useEffect(() => {
    if (phase === "idle") return;
    const root = lanesRef.current;
    if (!root) return;
    const marks = root.querySelectorAll(".ev.reject");
    const target = marks[marks.length - 1] as HTMLElement | undefined;
    if (!target) {
      root.scrollTop = root.scrollHeight;
      return;
    }
    const delta = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
    if (delta < 8 || delta > root.clientHeight - 96) root.scrollTop += delta - 48;
  }, [events, phase]);
  const status = detail?.run.status ?? "queued";
  const active = phase === "playing" ? new Set(events.slice(-4).map((event) => event.agent)) : new Set(ACTIVE[status] ?? []);
  const storeLabel = useMemo(() => {
    if (!config) return "Loading the desk";
    return config.supabase ? "Supabase memory on" : "Local seed store — add Supabase to persist";
  }, [config]);

  return (
    <main className="sheet">
      <header className="mast">
        <div>
          <p className="kicker">Investment memorandum · No. 37</p>
          <h1>Diligent</h1>
        </div>
        <p className="dek">One page. Every sentence has a source. The critic throws out the rest.</p>
      </header>
      <div className="desk grid grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)_minmax(0,1.05fr)]">
        <aside className="col pad">
          <form onSubmit={(event) => void onSubmit(event)}>
            <label htmlFor="company">Startup name or URL</label>
            <input
              id="company"
              className="ask"
              value={input}
              placeholder="Resend"
              onChange={(event) => setInput(event.target.value)}
              autoComplete="off"
            />
            <div className="actions">
              <button className="run" type="submit" disabled={phase === "live" || !input.trim()}>
                {phase === "live" ? "Running" : "Run live"}
              </button>
              <button className="ghost" type="button" onClick={play} disabled={!detail || phase === "live"}>
                {phase === "playing" ? "Playing" : "Play trace"}
              </button>
            </div>
          </form>
          <p className="hint">
            {storeLabel}. A live run is a real Agent37 pass and can take a couple of minutes. Play trace replays the seeded Resend desk in under a minute.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <div className="history">
            <h2>Past runs</h2>
            <ul>
              {runs.map((item) => (
                <li key={item.run.id}>
                  <button
                    type="button"
                    aria-current={item.run.id === detail?.run.id}
                    onClick={() => void openRun(item.run.id)}
                  >
                    <strong>{item.company.name}</strong>
                    <small>{item.memo?.verdict ?? item.run.status}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="col pad" aria-live="polite">
          <div className="trace-head">
            <h2>Live trace</h2>
            <p className="meta">{phase === "playing" ? "replaying" : status}</p>
          </div>
          <div className="lanes" ref={lanesRef}>
            {AGENTS.map((agent) => {
              const laneEvents = events.filter((event) => event.agent === agent.id);
              return (
                <section className="lane" key={agent.id}>
                  <div>
                    <h3>{agent.label}</h3>
                    {active.has(agent.id) && phase !== "idle" ? <span className="working">Working</span> : null}
                  </div>
                  <ol>
                    {laneEvents.length === 0 ? <li className="ev mute">Waiting</li> : null}
                    {laneEvents.map((event) => (
                      <li key={event.id} className={event.type === "rejected" || event.type === "error" ? "ev reject" : "ev"}>
                        <span className="ev-type">{event.type}</span>
                        <span>{event.message}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        </section>
        <section className="col pad memo-panel">
          <div className="memo-head">
            <h2>{detail?.company.name ?? "Memo"}</h2>
            <p className="meta">{detail?.company.url ?? "No company yet"}</p>
          </div>
          {showMemo && detail?.memo ? (
            <MemoView memo={detail.memo} findings={detail.findings} />
          ) : (
            <p className="empty">
              {detail?.run.status === "failed"
                ? "This run failed. The reason is in the trace."
                : phase === "idle"
                  ? "The memo lands here."
                  : "The desk is still writing."}
            </p>
          )}
        </section>
      </div>
      <footer className="footer">
        <span>Agent37 runs the agents. OpenAI writes and embeds. Supabase remembers.</span>
        <span>{config?.monid ? "Monid attached" : "Monid optional"} · InstaCloud via the Dockerfile</span>
      </footer>
    </main>
  );
}
