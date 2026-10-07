import { getRun } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      let last = "";
      const tick = async () => {
        if (closed || request.signal.aborted) return;
        try {
          const detail = await getRun(id);
          if (!detail) {
            send({ type: "error", error: "Run not found." });
            controller.close();
            return;
          }
          const snapshot = {
            type: detail.run.status === "completed" || detail.run.status === "failed" ? "done" : "tick",
            status: detail.run.status,
            events: detail.events,
            findings: detail.findings,
            memo: detail.memo,
            company: detail.company,
          };
          const encoded = JSON.stringify(snapshot);
          if (encoded !== last) {
            send(snapshot);
            last = encoded;
          } else {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          }
          if (snapshot.type === "done") {
            controller.close();
            return;
          }
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : "Stream failed." });
          controller.close();
          return;
        }
        timer = setTimeout(() => {
          void tick();
        }, 700);
      };
      await tick();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
