import { describe, expect, it } from "vitest";
import { cleanDownloadSources, type DownloadSource, downloadLinksFor } from "./downloadSources";

function source(over: Partial<DownloadSource> = {}): DownloadSource {
  return { label: "", template: "https://tracker.example/s?f=1,2&nm={query}", movies: true, shows: false, ...over };
}

describe("downloadLinksFor", () => {
  it("only returns sources targeting the requested card kind", () => {
    const sources = [
      source({ label: "M", movies: true, shows: false }),
      source({ label: "S", movies: false, shows: true }),
      source({ label: "Both", movies: true, shows: true }),
    ];
    expect(downloadLinksFor(sources, "movies", "X").map((l) => l.label)).toEqual(["M", "Both"]);
    expect(downloadLinksFor(sources, "shows", "X").map((l) => l.label)).toEqual(["S", "Both"]);
  });

  it("substitutes the URL-encoded title into the placeholder", () => {
    expect(downloadLinksFor([source()], "movies", "After the Hunt")[0].href).toBe(
      "https://tracker.example/s?f=1,2&nm=After%20the%20Hunt",
    );
  });

  it("encodes query-breaking characters so the title stays one param", () => {
    expect(downloadLinksFor([source()], "movies", "Dungeons & Dragons")[0].href).toBe(
      "https://tracker.example/s?f=1,2&nm=Dungeons%20%26%20Dragons",
    );
  });

  it("uses the custom label, or the host (minus www.) when it's blank", () => {
    expect(downloadLinksFor([source({ label: "RT" })], "movies", "X")[0].label).toBe("RT");
    expect(
      downloadLinksFor([source({ label: "", template: "https://www.rt.example/?nm={query}" })], "movies", "X")[0].label,
    ).toBe("rt.example");
  });

  it("skips sources whose template is blank, not http(s), or missing the placeholder", () => {
    const sources = [
      source({ label: "blank", template: "" }),
      source({ label: "relative", template: "tracker.example/?nm={query}" }),
      source({ label: "no-placeholder", template: "https://tracker.example/browse" }),
    ];
    expect(downloadLinksFor(sources, "movies", "X")).toEqual([]);
  });
});

describe("cleanDownloadSources", () => {
  it("trims text and drops rows with no template", () => {
    const cleaned = cleanDownloadSources([
      source({ label: "  RT  ", template: "  https://t.example/?nm={query}  " }),
      source({ label: "empty", template: "   " }),
    ]);
    expect(cleaned).toEqual([{ label: "RT", template: "https://t.example/?nm={query}", movies: true, shows: false }]);
  });
});
