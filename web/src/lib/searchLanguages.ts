import { getPrisma } from "@/lib/db";
import { DEFAULT_LANGUAGE, type DownloadSource, type LanguageOption, normalizeLanguage } from "@/lib/downloadSources";
import { languageName } from "@/lib/tmdb";

// Which languages the admin's download-source picker offers. NOT the full TMDB language table (~190 entries, most
// of which could never match anything here): a source's language only ever decides whether an item is searched
// under its native title, which needs a catalog item whose originalLanguage IS that language. So the picker is
// exactly the set that can do something — the languages present in the library — plus English (the universal
// fallback and default) and whatever the saved sources already use.

// The distinct original languages actually in the catalog. Items with no original title are excluded: there'd be
// no native title to search with, so offering their language would be an option that changes nothing.
export async function getCatalogLanguageCodes(): Promise<string[]> {
  const rows = await getPrisma().mediaItem.findMany({
    where: { originalLanguage: { not: null }, originalTitle: { not: null } },
    select: { originalLanguage: true },
    distinct: ["originalLanguage"],
  });
  return rows.map((r) => r.originalLanguage).filter((code): code is string => !!code);
}

// The picker list, name-sorted. PURE. Every code is canonicalized with the same normalizeLanguage the write path
// uses, so the editor's "look my saved code up in this list" never misses. A code TMDB's table doesn't name falls
// back to showing the code itself, so it stays selectable rather than vanishing.
export function searchLanguageOptions(catalogCodes: string[], sources: DownloadSource[]): LanguageOption[] {
  const codes = new Set<string>([DEFAULT_LANGUAGE]);
  // From the catalog: every language you could actually search a native title in. "xx" (No Language) is skipped —
  // it marks a wordless film, never a language you'd search in.
  for (const raw of catalogCodes) {
    const code = normalizeLanguage(raw);
    if (code !== "xx") codes.add(code);
  }
  // From the saved sources: UNCONDITIONALLY, "xx" included. Whatever a source already holds must stay in its own
  // picker, or editing that source would silently relabel or reset its language.
  for (const source of sources) codes.add(normalizeLanguage(source.language));
  return [...codes]
    .map((code) => ({ code, name: languageName(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
