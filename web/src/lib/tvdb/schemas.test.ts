import { describe, expect, it } from "vitest";
import login from "./fixtures/login.json";
import movieExtended from "./fixtures/movie-extended.json";
import seriesEpisodes from "./fixtures/series-episodes.json";
import seriesExtended from "./fixtures/series-extended.json";
import {
  tvdbLoginResponseSchema,
  tvdbMovieExtendedResponseSchema,
  tvdbSeriesEpisodesResponseSchema,
  tvdbSeriesExtendedResponseSchema,
} from "./schemas";

describe("tvdb schemas", () => {
  it("parses the login envelope → data.token", () => {
    const parsed = tvdbLoginResponseSchema.parse(login);
    expect(parsed.data.token).toBe("TEST_JWT_TOKEN");
  });

  it("parses a series extended record incl. status name, genres, seasons and remoteIds", () => {
    const { data } = tvdbSeriesExtendedResponseSchema.parse(seriesExtended);
    expect(data.id).toBe(420847);
    expect(data.status?.name).toBe("Continuing");
    expect(data.seasons).toHaveLength(3); // specials + absolute S1 + official S1
    expect(data.firstAired).toBe("2022-01-07");
    expect(data.remoteIds?.[0].sourceName).toBe("IMDB");
  });

  it("parses a movie extended record incl. first_release and runtime", () => {
    const { data } = tvdbMovieExtendedResponseSchema.parse(movieExtended);
    expect(data.id).toBe(138435);
    expect(data.first_release?.date).toBe("2010-08-01");
    expect(data.runtime).toBe(25);
  });

  it("parses the episodes envelope incl. a null-overview episode and the specials season", () => {
    const { data, links } = tvdbSeriesEpisodesResponseSchema.parse(seriesEpisodes);
    expect(data.episodes).toHaveLength(3);
    expect(data.episodes.find((e) => e.number === 2 && e.seasonNumber === 1)?.overview).toBeNull();
    expect(data.episodes.some((e) => e.seasonNumber === 0)).toBe(true);
    expect(links?.next).toBeNull();
  });

  it("rejects a schema-invalid series record (non-numeric id)", () => {
    expect(() => tvdbSeriesExtendedResponseSchema.parse({ status: "ok", data: { id: "x", name: "Y" } })).toThrow();
  });
});
