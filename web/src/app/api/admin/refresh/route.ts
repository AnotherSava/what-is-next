import { refreshAll, type RefreshProgress } from "@/lib/refresh";
import { requireOwner } from "@/lib/session";

// Streaming manual refresh. Runs the exact same refreshAll the nightly cron uses, but emits one NDJSON object per
// line so the admin UI can render a live progress bar: {type:"progress", ...RefreshProgress} while it runs, then a
// final {type:"done", result} (or {type:"error", message}). Owner-gated. The old server-action path revalidated
// four routes at the end (which strobed the dev indicator); here the client does a single router.refresh() instead.
export const runtime = "nodejs"; // Prisma + better-sqlite3 need the Node runtime
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    await requireOwner();
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const result = await refreshAll("manual", Date.now(), (p: RefreshProgress) => send({ type: "progress", ...p }));
        send({ type: "done", result });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Refresh failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no", // ask any proxy not to buffer, so progress streams incrementally
    },
  });
}
