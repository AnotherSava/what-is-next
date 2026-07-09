import { describe, expect, it } from "vitest";
import { crossCheck, parseUserTvShowData } from "./gdpr";

const HEADER = "user_id,tv_show_id,is_followed,is_favorited,nb_episodes_seen,tv_show_name";

describe("parseUserTvShowData", () => {
  it("parses rows keyed by tvdb id with episodes seen", () => {
    const csv = `${HEADER}\n72266066,73244,1,0,0,The Office (US)\n72266066,73730,1,0,72,Veronica Mars`;
    const rows = parseUserTvShowData(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ tvdbId: 73244, name: "The Office (US)", episodesSeen: 0 });
    expect(rows[1].episodesSeen).toBe(72);
  });

  it("keeps commas that appear inside the show name", () => {
    const csv = `${HEADER}\n1,999,1,0,5,Cosmos, A Spacetime Odyssey`;
    const [row] = parseUserTvShowData(csv);
    expect(row.name).toBe("Cosmos, A Spacetime Odyssey");
    expect(row.episodesSeen).toBe(5);
    expect(row.tvdbId).toBe(999);
  });

  it("skips malformed lines and empty input", () => {
    expect(parseUserTvShowData("")).toEqual([]);
    expect(parseUserTvShowData(HEADER)).toEqual([]);
    expect(parseUserTvShowData(`${HEADER}\n1,2,3,4,5,ok\nbadline`)).toHaveLength(1);
  });
});

describe("crossCheck", () => {
  it("flags shows whose imported count differs from GDPR (absent import counts as 0)", () => {
    const rows = [
      { tvdbId: 1, name: "A", episodesSeen: 10 },
      { tvdbId: 2, name: "B", episodesSeen: 5 },
      { tvdbId: 3, name: "C", episodesSeen: 0 },
    ];
    const imported = new Map([
      [1, 10],
      [2, 3],
    ]);
    const result = crossCheck(rows, imported);
    expect(result.checked).toBe(3);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]).toMatchObject({ tvdbId: 2, gdprSeen: 5, importedSeen: 3 });
  });
});
