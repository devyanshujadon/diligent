import { parseCompanyInput } from "@/lib/parse";
import { keepPipeline, runPipeline } from "@/lib/pipeline";
import { configFlags, createRun, ensureSeed, listRuns } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const runs = await listRuns();
    return Response.json({ runs, config: configFlags() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load runs.";
    return Response.json({ error: message, runs: [], config: configFlags() }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { input?: string };
  try {
    body = (await request.json()) as { input?: string };
  } catch {
    return Response.json({ error: "Send JSON with an input string." }, { status: 400 });
  }
  const raw = body.input?.trim() ?? "";
  if (!raw) return Response.json({ error: "Enter a startup name or URL." }, { status: 400 });
  if (!process.env.AGENT37_API_KEY) {
    return Response.json(
      { error: "AGENT37_API_KEY is not set. Open the seeded Resend memo, or add the key and run again." },
      { status: 503 },
    );
  }
  try {
    await ensureSeed();
    const parsed = parseCompanyInput(raw);
    const { run, company } = await createRun(parsed);
    keepPipeline(runPipeline(run.id, company.id, raw, parsed));
    return Response.json({ id: run.id, company });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the run.";
    return Response.json({ error: message }, { status: 500 });
  }
}
