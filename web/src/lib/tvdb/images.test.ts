import { describe, expect, it } from "vitest";
import { tvdbImageUrl } from "./images";

describe("tvdbImageUrl", () => {
  it("passes an absolute URL through unchanged", () => {
    expect(tvdbImageUrl("https://artworks.thetvdb.com/banners/x.jpg")).toBe(
      "https://artworks.thetvdb.com/banners/x.jpg",
    );
  });

  it("prefixes the artwork host onto a bare path (with or without a leading slash)", () => {
    expect(tvdbImageUrl("/banners/x.jpg")).toBe("https://artworks.thetvdb.com/banners/x.jpg");
    expect(tvdbImageUrl("banners/x.jpg")).toBe("https://artworks.thetvdb.com/banners/x.jpg");
  });

  it("returns null for empty input", () => {
    expect(tvdbImageUrl(null)).toBeNull();
    expect(tvdbImageUrl(undefined)).toBeNull();
    expect(tvdbImageUrl("")).toBeNull();
  });
});
