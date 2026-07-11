import { describe, expect, it } from "vitest";
import { plexWatchUrl, plexWebUrl } from "./link";

describe("plexWebUrl", () => {
  it("builds an app.plex.tv details deep link with the metadata key URL-encoded", () => {
    expect(plexWebUrl("abc123", "56")).toBe(
      "https://app.plex.tv/desktop/#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F56",
    );
  });

  it("encodes the ratingKey and machine id (defensive against odd characters)", () => {
    const url = plexWebUrl("id/with space", "9 9");
    expect(url).toContain("/server/id%2Fwith%20space/");
    expect(url).toContain("key=%2Flibrary%2Fmetadata%2F9%209");
  });
});

describe("plexWatchUrl", () => {
  it("returns a URL only when both the server id and ratingKey are present", () => {
    expect(plexWatchUrl("abc123", "56")).toBe(plexWebUrl("abc123", "56"));
    expect(plexWatchUrl(null, "56")).toBeNull();
    expect(plexWatchUrl("abc123", null)).toBeNull();
    expect(plexWatchUrl("abc123", undefined)).toBeNull();
    expect(plexWatchUrl(null, null)).toBeNull();
  });
});
