import { describe, expect, it } from "vitest";
import type { DownloadSource } from "./downloadSources";
import { searchLanguageOptions } from "./searchLanguages";

function source(language: string): DownloadSource {
  return {
    label: "",
    template: "https://t.example/?nm={query}",
    movies: true,
    shows: true,
    language,
    seasonPattern: "",
  };
}

describe("searchLanguageOptions", () => {
  it("offers the catalog's languages, name-sorted", () => {
    expect(searchLanguageOptions(["ru", "ko", "ja"], [])).toEqual([
      { code: "en", name: "English" },
      { code: "ja", name: "Japanese" },
      { code: "ko", name: "Korean" },
      { code: "ru", name: "Russian" },
    ]);
  });

  it("always offers English, even for an empty catalog", () => {
    expect(searchLanguageOptions([], [])).toEqual([{ code: "en", name: "English" }]);
  });

  it("keeps a language a source already uses after it leaves the catalog", () => {
    // Otherwise the saved source's own value would vanish from its picker and read as an unnamed raw code.
    expect(searchLanguageOptions([], [source("ru")]).map((l) => l.code)).toEqual(["en", "ru"]);
  });

  it("normalizes codes and never lists one twice", () => {
    expect(searchLanguageOptions(["RU", " ru "], [source("ru"), source("")]).map((l) => l.code)).toEqual(["en", "ru"]);
  });

  it("skips the no-language placeholder coming from the catalog", () => {
    expect(searchLanguageOptions(["xx", "ja"], []).map((l) => l.code)).toEqual(["en", "ja"]);
  });

  it("keeps the no-language placeholder when a source is saved with it", () => {
    // The catalog filter must not override the "never drop a configured code" rule — that's what would relabel it.
    expect(searchLanguageOptions(["xx"], [source("xx")]).map((l) => l.code)).toEqual(["en", "xx"]);
  });

  it("shows a code TMDB doesn't name as itself, so it stays selectable", () => {
    expect(searchLanguageOptions(["qq"], []).map((l) => l.name)).toEqual(["English", "qq"]);
  });
});
