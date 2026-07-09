import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPrisma } from "../src/lib/db";
import { getOwner } from "../src/lib/owner";
import { getTmdb } from "../src/lib/tmdb";
import { Importer } from "../src/lib/import/importer";
import { formatReport, summarizeReport } from "../src/lib/import/report";
import { tvtimeListsFileSchema, tvtimeMovieFileSchema, tvtimeSeriesFileSchema } from "../src/lib/import/schemas";
import { setSetting } from "../src/lib/settings";

// CLI: `npm run import -- <export-dir>` (brief §6). Reads + zod-validates the "TV Time Out" export files,
// finds the optional GDPR user_tv_show_data.csv for the cross-check, runs the idempotent importer, prints the
// reconciliation report, and writes the full report + unresolved items to scripts/out/ so nothing is lost.

function findFile(dir: string, pattern: RegExp): string | null {
  const match = readdirSync(dir).find((f) => pattern.test(f));
  return match ? join(dir, match) : null;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function findGdprCsv(dir: string): string | null {
  for (const candidate of [join(dir, "user_tv_show_data.csv"), join(dirname(dir), "user_tv_show_data.csv")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error(
      "Usage: npm run import -- <export-dir>\n  <export-dir> holds tvtime-series-*.json, tvtime-movies-*.json, tvtime-lists-*.json",
    );
    process.exitCode = 1;
    return;
  }
  if (!existsSync(dir)) {
    console.error(`Export directory not found: ${dir}`);
    process.exitCode = 1;
    return;
  }

  const seriesFile = findFile(dir, /^tvtime-series.*\.json$/);
  const moviesFile = findFile(dir, /^tvtime-movies.*\.json$/);
  const listsFile = findFile(dir, /^tvtime-lists.*\.json$/);
  if (!seriesFile || !moviesFile || !listsFile) {
    console.error(`Missing export files in ${dir}:`);
    console.error(`  series: ${seriesFile ?? "NOT FOUND"}`);
    console.error(`  movies: ${moviesFile ?? "NOT FOUND"}`);
    console.error(`  lists:  ${listsFile ?? "NOT FOUND"}`);
    process.exitCode = 1;
    return;
  }

  console.log("Validating export files…");
  const series = tvtimeSeriesFileSchema.parse(readJson(seriesFile));
  const movies = tvtimeMovieFileSchema.parse(readJson(moviesFile));
  const lists = tvtimeListsFileSchema.parse(readJson(listsFile));
  const gdprPath = findGdprCsv(dir);
  const gdprCsv = gdprPath ? readFileSync(gdprPath, "utf-8") : null;
  console.log(
    `  ${series.length} series, ${movies.length} movies, ${lists.length} list(s). GDPR cross-check: ${gdprPath ?? "skipped"}`,
  );

  const prisma = getPrisma();
  const owner = await getOwner();
  const startedAt = new Date().toISOString();

  console.log(`Importing as owner "${owner.name}" (${owner.id})…`);
  const importer = new Importer(
    { prisma, tmdb: getTmdb(), ownerId: owner.id, log: (m) => console.log(m) },
    dir,
    startedAt,
  );
  const report = await importer.run({ series, movies, lists, gdprCsv });

  console.log("\n" + formatReport(report));

  // Persist a summary so the admin page can show it regardless of where the CLI ran.
  await setSetting("import:lastReport", summarizeReport(report));

  const outDir = join(process.cwd(), "scripts", "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const reportPath = join(outDir, `import-report-${stamp}.json`);
  const unresolvedPath = join(outDir, `import-unresolved-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync(
    unresolvedPath,
    JSON.stringify(
      {
        series: report.series.unresolved,
        movies: report.movies.unresolved,
        moviesSearchedByTitle: report.movies.searchedByTitle,
        unmatchedEpisodes: report.episodes.unmatched,
        unresolvedListItems: report.lists.unresolvedItems,
        gdpr: report.gdpr,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport written to ${reportPath}`);
  console.log(`Unresolved items written to ${unresolvedPath}`);
}

main()
  .catch((err) => {
    console.error("\nImport failed:", err);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
