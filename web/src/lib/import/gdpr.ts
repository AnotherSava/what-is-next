// Optional GDPR cross-check (brief §6.4). The service GDPR dump's `user_tv_show_data.csv` carries a per-show
// `nb_episodes_seen` keyed by TVDB id; we compare it to what the import actually wrote and note discrepancies
// without failing. The other GDPR CSVs are ignored in v1 (their lists file is raw Go map dumps — do not parse).

export interface GdprShowRow {
  tvdbId: number;
  name: string;
  episodesSeen: number;
}

// Header: user_id,tv_show_id,is_followed,is_favorited,nb_episodes_seen,tv_show_name
// The name is the trailing column and may itself contain commas, so we split on the fixed leading columns and
// re-join the remainder as the name rather than assuming a fixed field count.
export function parseUserTvShowData(csv: string): GdprShowRow[] {
  const rows: GdprShowRow[] = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return rows;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols.length < 6) continue;
    const tvdbId = Number(cols[1]);
    const episodesSeen = Number(cols[4]);
    const name = cols.slice(5).join(",").trim();
    if (!Number.isFinite(tvdbId) || !Number.isFinite(episodesSeen)) continue;
    rows.push({ tvdbId, name, episodesSeen });
  }
  return rows;
}

// Given GDPR rows and the imported per-show watched-episode counts (keyed by tvdbId), list the shows where the
// two disagree. Shows present in GDPR but absent from the import (imported = 0) are reported too — that catches
// a series that failed to resolve or matched no episodes.
export function crossCheck(
  gdprRows: GdprShowRow[],
  importedByTvdb: Map<number, number>,
): { checked: number; discrepancies: { tvdbId: number; showName: string; gdprSeen: number; importedSeen: number }[] } {
  const discrepancies: { tvdbId: number; showName: string; gdprSeen: number; importedSeen: number }[] = [];
  for (const row of gdprRows) {
    const importedSeen = importedByTvdb.get(row.tvdbId) ?? 0;
    if (importedSeen !== row.episodesSeen) {
      discrepancies.push({
        tvdbId: row.tvdbId,
        showName: row.name,
        gdprSeen: row.episodesSeen,
        importedSeen,
      });
    }
  }
  return { checked: gdprRows.length, discrepancies };
}
