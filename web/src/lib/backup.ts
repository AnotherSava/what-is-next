import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { setSetting } from "@/lib/settings";

// Nightly SQLite backup (brief §7, §8: "the database is the crown jewel"). Uses SQLite's online backup API via
// a separate read-only connection (consistent even while the app is writing), writes to <db-dir>/backups (or
// BACKUP_DIR), and prunes snapshots older than 14 days. In prod the DB lives at /data/whats-next.db, so backups
// land in /data/backups — all on the mounted volume.

const RETENTION_DAYS = 14;
const BACKUP_PREFIX = "whats-next-";

export interface BackupResult {
  ok: boolean;
  file: string | null;
  prunedCount: number;
  error: string | null;
}

function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? "";
  return url.replace(/^file:/, "");
}

function backupDir(): string {
  return process.env.BACKUP_DIR ?? join(dirname(dbFilePath()), "backups");
}

export async function runBackup(nowMs: number = Date.now()): Promise<BackupResult> {
  const at = new Date(nowMs).toISOString();
  const src = dbFilePath();
  const dir = backupDir();
  try {
    if (!src) throw new Error("DATABASE_URL is not set");
    if (!existsSync(src)) throw new Error(`Database file not found: ${src}`);
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, `${BACKUP_PREFIX}${at.replace(/[:.]/g, "-")}.db`);

    const db = new Database(src, { readonly: true });
    try {
      await db.backup(dest);
    } finally {
      db.close();
    }

    const prunedCount = pruneOld(dir, nowMs);
    const result: BackupResult = { ok: true, file: dest, prunedCount, error: null };
    await setSetting("backup:lastRun", { at, ...result });
    return result;
  } catch (e) {
    const result: BackupResult = {
      ok: false,
      file: null,
      prunedCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
    await setSetting("backup:lastRun", { at, ...result });
    return result;
  }
}

function pruneOld(dir: string, nowMs: number): number {
  const cutoff = nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(BACKUP_PREFIX) || !f.endsWith(".db")) continue;
    const full = join(dir, f);
    if (statSync(full).mtimeMs < cutoff) {
      rmSync(full, { force: true });
      pruned++;
    }
  }
  return pruned;
}
