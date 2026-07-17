import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { resolveBackupFile } from "@/lib/backup";
import { requireOwner } from "@/lib/session";

// Owner-gated download of a single SQLite backup snapshot. The Settings page links each snapshot's filename here;
// resolveBackupFile validates the name against the backup dir (no traversal) before we stream it as an attachment.
export const runtime = "nodejs"; // better-sqlite3 backups live on the Node filesystem
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    await requireOwner();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const name = new URL(req.url).searchParams.get("file") ?? "";
  const path = resolveBackupFile(name);
  if (!path) return new Response("Not found", { status: 404 });

  const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(statSync(path).size),
      "Cache-Control": "no-store",
    },
  });
}
