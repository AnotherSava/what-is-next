import { describe, expect, it } from "vitest";
import { cleanDownloadSources, type DownloadSource, downloadLinksFor, type SearchTitle } from "./downloadSources";

function source(over: Partial<DownloadSource> = {}): DownloadSource {
  return {
    label: "",
    template: "https://tracker.example/s?f=1,2&nm={query}",
    movies: true,
    shows: false,
    language: "en",
    seasonPattern: "S%02d",
    ...over,
  };
}

function item(over: Partial<SearchTitle> = {}): SearchTitle {
  return { title: "X", originalTitle: null, originalLanguage: null, ...over };
}

describe("downloadLinksFor", () => {
  it("only returns sources targeting the requested card kind", () => {
    const sources = [
      source({ label: "M", movies: true, shows: false }),
      source({ label: "S", movies: false, shows: true }),
      source({ label: "Both", movies: true, shows: true }),
    ];
    expect(downloadLinksFor(sources, "movies", item()).map((l) => l.label)).toEqual(["M", "Both"]);
    expect(downloadLinksFor(sources, "shows", item()).map((l) => l.label)).toEqual(["S", "Both"]);
  });

  it("substitutes the URL-encoded title into the placeholder", () => {
    expect(downloadLinksFor([source()], "movies", item({ title: "After the Hunt" }))[0].href).toBe(
      "https://tracker.example/s?f=1,2&nm=After%20the%20Hunt",
    );
  });

  it("encodes query-breaking characters so the title stays one param", () => {
    expect(downloadLinksFor([source()], "movies", item({ title: "Dungeons & Dragons" }))[0].href).toBe(
      "https://tracker.example/s?f=1,2&nm=Dungeons%20%26%20Dragons",
    );
  });

  it("appends the season marker to the searched title", () => {
    expect(downloadLinksFor([source({ shows: true })], "shows", item({ title: "Severance" }), 2)[0].href).toBe(
      "https://tracker.example/s?f=1,2&nm=Severance%20S02",
    );
  });

  it("uses the custom label, or the host (minus www.) when it's blank", () => {
    expect(downloadLinksFor([source({ label: "RT" })], "movies", item())[0].label).toBe("RT");
    expect(
      downloadLinksFor([source({ label: "", template: "https://www.rt.example/?nm={query}" })], "movies", item())[0]
        .label,
    ).toBe("rt.example");
  });

  it("fills the season number in printf style, and leaves a pattern with no token literal", () => {
    const href = (seasonPattern: string) =>
      downloadLinksFor([source({ shows: true, seasonPattern })], "shows", item({ title: "S" }), 5)[0].href.replace(
        "https://tracker.example/s?f=1,2&nm=S%20",
        "",
      );
    expect(href("S%02d")).toBe("S05");
    expect(href("season %d")).toBe("season%205");
    expect(href("%03d")).toBe("005");
    expect(href("100%% s%d")).toBe("100%25%20s5"); // %% is a literal percent, then the number
    expect(href("complete")).toBe("complete");
  });

  it("appends no marker when the season pattern is blank", () => {
    expect(
      downloadLinksFor([source({ shows: true, seasonPattern: "" })], "shows", item({ title: "S" }), 5)[0].href,
    ).toBe("https://tracker.example/s?f=1,2&nm=S");
  });

  it("skips sources whose template is blank, not http(s), or missing the placeholder", () => {
    const sources = [
      source({ label: "blank", template: "" }),
      source({ label: "relative", template: "tracker.example/?nm={query}" }),
      source({ label: "no-placeholder", template: "https://tracker.example/browse" }),
    ];
    expect(downloadLinksFor(sources, "movies", item())).toEqual([]);
  });

  describe("search language", () => {
    const brother = item({ title: "Brother", originalTitle: "Брат", originalLanguage: "ru" });

    it("searches the original title when the source's language is the item's own", () => {
      expect(downloadLinksFor([source({ language: "ru" })], "movies", brother)[0].href).toBe(
        "https://tracker.example/s?f=1,2&nm=%D0%91%D1%80%D0%B0%D1%82",
      );
    });

    it("falls back to the English title when the item isn't in the source's language", () => {
      const matrix = item({ title: "The Matrix", originalTitle: "The Matrix", originalLanguage: "en" });
      expect(downloadLinksFor([source({ language: "ru" })], "movies", matrix)[0].href).toBe(
        "https://tracker.example/s?f=1,2&nm=The%20Matrix",
      );
    });

    it("falls back to the English title when the original title was never resolved", () => {
      const noOriginal = item({ title: "Brother", originalTitle: null, originalLanguage: "ru" });
      expect(downloadLinksFor([source({ language: "ru" })], "movies", noOriginal)[0].href).toBe(
        "https://tracker.example/s?f=1,2&nm=Brother",
      );
    });

    it("searches the English title for an English source, and for a row saved before the field existed", () => {
      const english = "https://tracker.example/s?f=1,2&nm=Brother";
      expect(downloadLinksFor([source({ language: "en" })], "movies", brother)[0].href).toBe(english);
      expect(downloadLinksFor([source({ language: "" })], "movies", brother)[0].href).toBe(english);
    });

    it("uses the source's own season marker whichever title the query took", () => {
      const ru = source({ shows: true, language: "ru", seasonPattern: "Сезон %d" });
      const seasonRu = "%D0%A1%D0%B5%D0%B7%D0%BE%D0%BD%205";
      // Native title and an English-title fallback both get the tracker's marker — that's how IT indexes seasons.
      expect(downloadLinksFor([ru], "shows", brother, 5)[0].href).toBe(
        `https://tracker.example/s?f=1,2&nm=%D0%91%D1%80%D0%B0%D1%82%20${seasonRu}`,
      );
      expect(downloadLinksFor([ru], "shows", item({ title: "Severance" }), 5)[0].href).toBe(
        `https://tracker.example/s?f=1,2&nm=Severance%20${seasonRu}`,
      );
    });

    it("gives each source its own language, so one item yields differently-worded searches", () => {
      const sources = [source({ label: "EN", language: "en" }), source({ label: "RU", language: "ru" })];
      expect(downloadLinksFor(sources, "movies", brother).map((l) => l.href)).toEqual([
        "https://tracker.example/s?f=1,2&nm=Brother",
        "https://tracker.example/s?f=1,2&nm=%D0%91%D1%80%D0%B0%D1%82",
      ]);
    });
  });
});

describe("cleanDownloadSources", () => {
  it("trims text and drops rows with no template", () => {
    const cleaned = cleanDownloadSources([
      source({ label: "  RT  ", template: "  https://t.example/?nm={query}  " }),
      source({ label: "empty", template: "   " }),
    ]);
    expect(cleaned).toEqual([
      {
        label: "RT",
        template: "https://t.example/?nm={query}",
        movies: true,
        shows: false,
        language: "en",
        seasonPattern: "S%02d",
      },
    ]);
  });

  it("trims the season pattern", () => {
    expect(cleanDownloadSources([source({ seasonPattern: " Сезон %d " })])[0].seasonPattern).toBe("Сезон %d");
  });

  it("normalizes the language, defaulting a blank one to English", () => {
    expect(
      cleanDownloadSources([source({ language: " RU " }), source({ language: "" })]).map((s) => s.language),
    ).toEqual(["ru", "en"]);
  });
});
