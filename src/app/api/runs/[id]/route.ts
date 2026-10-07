import { getRun } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const detail = await getRun(id);
    if (!detail) return Response.json({ error: "Run not found." }, { status: 404 });
    return Response.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the run.";
    return Response.json({ error: message }, { status: 500 });
  }
}
