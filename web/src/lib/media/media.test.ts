import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { setSetting } from "@/lib/settings";
import { applyEpisodePresence, applyPresence, applyWatched } from "./apply";
import { getMediaServer, getMediaServers, isUsable, normalizeServerUrl, setMediaServer } from "./config";
import { jellyfinWebUrl, plexWebUrl, watchTarget, type ServerLinks } from "./link";
import {
  getEpisodePresence,
  getMoviePresence,
  getPlayableEpisodeRefs,
  getPresenceRefs,
  getShowPresence,
} from "./presence";
import { suppressWatch } from "./suppression";
import type { MediaProvider, PresenceRow } from "./types";

// The shared media-server core, exercised where Plex and Jellyfin meet. The behaviour that matters most here is
// ISOLATION: each provider owns its own rows, and one server's sync must never delete or overwrite the other's.

const MIGRATION_SQL = readdirSync(join("prisma", "migrations"))
  .filter((d) => /^\d+_/.test(d))
  .sort()
  .map((d) => readFileSync(join("prisma", "migrations", d, "migration.sql"), "utf-8"))
  .join(";\n");

function createDb() {
  const dbPath = join("prisma", `test-media-${randomUUID()}.db`);
  const raw = new Database(dbPath);
  raw.exec(MIGRATION_SQL);
  raw.close();
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath.replace(/\\/g, "/")}` }) });
  return {
    prisma,
    dbPath,
    cleanup: async () => {
      await prisma.$disconnect();
      for (const s of ["", "-journal", "-shm", "-wal"]) if (existsSync(dbPath + s)) rmSync(dbPath + s, { force: true });
    },
  };
}

let prisma: PrismaClient;
let dbPath: string;
let cleanup: () => Promise<void>;

// The read-side helpers (presence.ts) resolve the app's Prisma singleton, which db.ts caches on globalThis. Point
// that cache at this test's throwaway database for the duration of each test, so the reads and the writes below
// are looking at the same rows.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Presence reads are scoped to the CONNECTED servers, so every test states which ones are connected rather than
// inheriting whatever the ambient environment happens to hold.
async function connect(...providers: MediaProvider[]): Promise<void> {
  const server = (p: MediaProvider) => ({
    enabled: providers.includes(p),
    url: p === "plex" ? "http://localhost:32400" : "http://localhost:8096",
    token: "t",
    libraries: "",
    user: "",
  });
  await setSetting("settings:mediaServers", { plex: server("plex"), jellyfin: server("jellyfin") });
}

beforeEach(async () => {
  process.env.SESSION_SECRET ??= "0".repeat(64); // the key stored credentials are encrypted with (lib/secrets.ts)
  ({ prisma, dbPath, cleanup } = createDb());
  globalForPrisma.prisma = prisma;
  await prisma.user.create({ data: { id: "owner", name: "T", role: "owner" } });
  await connect("plex", "jellyfin");
  await prisma.mediaItem.create({
    data: { id: "mi-show", mediaType: "tv", tmdbId: 100, title: "Show", needsDetails: false },
  });
  await prisma.mediaItem.create({
    data: { id: "mi-movie", mediaType: "movie", tmdbId: 200, title: "Movie", needsDetails: false },
  });
  await prisma.season.create({ data: { id: "se1", mediaItemId: "mi-show", seasonNumber: 1 } });
  await prisma.episode.createMany({
    data: [
      { id: "ep1", mediaItemId: "mi-show", seasonId: "se1", seasonNumber: 1, episodeNumber: 1 },
      { id: "ep2", mediaItemId: "mi-show", seasonId: "se1", seasonNumber: 1, episodeNumber: 2 },
    ],
  });
});
afterEach(async () => {
  delete globalForPrisma.prisma;
  await cleanup();
});

const row = (over: Partial<PresenceRow> = {}): PresenceRow => ({
  mediaItemId: "mi-show",
  seasonNumber: 1,
  itemKey: "k1",
  ...over,
});

describe("applyPresence across two connected servers", () => {
  it("replaces only the syncing provider's rows, leaving the other server's untouched", async () => {
    await applyPresence(prisma, "owner", "plex", [row({ itemKey: "plex-1" })]);
    await applyPresence(prisma, "owner", "jellyfin", [row({ itemKey: "jf-1" })]);

    // A Plex re-sync that now finds nothing must not wipe Jellyfin's presence — that would empty the Download
    // view and the home dashboard for a library that is still perfectly present on the other server.
    await applyPresence(prisma, "owner", "plex", []);

    const rows = await prisma.mediaPresence.findMany({ where: { userId: "owner" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "jellyfin", itemKey: "jf-1" });
  });

  it("reports a change only for the provider whose own snapshot moved", async () => {
    await applyPresence(prisma, "owner", "jellyfin", [row({ itemKey: "jf-1" })]);
    // Plex's first sync is a change for Plex, and re-running it is not — the other provider's rows must not leak
    // into the delta and make every sync look like a change (which would refresh open pages forever).
    expect(await applyPresence(prisma, "owner", "plex", [row({ itemKey: "plex-1" })])).toBe(true);
    expect(await applyPresence(prisma, "owner", "plex", [row({ itemKey: "plex-1" })])).toBe(false);
  });

  it("inherits a season's stored source only from the same provider", async () => {
    // Plex holds the 4K copy; Jellyfin holds a 1080p one.
    await applyPresence(prisma, "owner", "plex", [
      row({ itemKey: "plex-1", sourceDerived: true, videoResolution: "4k", hdrFormat: "Dolby Vision" }),
    ]);
    await applyPresence(prisma, "owner", "jellyfin", [
      row({ itemKey: "jf-1", sourceDerived: true, videoResolution: "1080", hdrFormat: null }),
    ]);

    // A steady-state Plex sync sends the season bare (its episodes didn't move). It must inherit PLEX's stored 4K
    // source, not the Jellyfin row that shares its (item, season) key.
    await applyPresence(prisma, "owner", "plex", [row({ itemKey: "plex-1" })]);

    const plexRow = await prisma.mediaPresence.findFirst({ where: { userId: "owner", provider: "plex" } });
    expect(plexRow?.videoResolution).toBe("4k");
    expect(plexRow?.hdrFormat).toBe("Dolby Vision");
    const jfRow = await prisma.mediaPresence.findFirst({ where: { userId: "owner", provider: "jellyfin" } });
    expect(jfRow?.videoResolution).toBe("1080");
  });
});

describe("applyEpisodePresence across two connected servers", () => {
  it("keeps the other provider's rows when a sync matches nothing at all", async () => {
    await applyEpisodePresence(prisma, "owner", "plex", { "mi-show": [{ seasonNumber: 1, episodeNumber: 1 }] }, [
      "mi-show",
    ]);
    await applyEpisodePresence(prisma, "owner", "jellyfin", { "mi-show": [{ seasonNumber: 1, episodeNumber: 2 }] }, [
      "mi-show",
    ]);

    // An empty matched set (a misconfigured allowlist, an empty server, a first run) clears that provider only.
    await applyEpisodePresence(prisma, "owner", "jellyfin", {}, []);

    const rows = await prisma.mediaEpisodePresence.findMany({ where: { userId: "owner" } });
    expect(rows.map((r) => `${r.provider}:${r.episodeId}`)).toEqual(["plex:ep1"]);
  });

  it("lets the same episode be present on both servers at once", async () => {
    const refreshed = { "mi-show": [{ seasonNumber: 1, episodeNumber: 1 }] };
    await applyEpisodePresence(prisma, "owner", "plex", refreshed, ["mi-show"]);
    await applyEpisodePresence(prisma, "owner", "jellyfin", refreshed, ["mi-show"]);
    // Two rows for one episode — the unique key is (user, provider, episode), so this must not collide.
    expect(await prisma.mediaEpisodePresence.count({ where: { userId: "owner", episodeId: "ep1" } })).toBe(2);
    // The read side unions them: having it on either server means you can watch it.
    expect(await getEpisodePresence("owner")).toEqual(new Set(["ep1"]));
  });

  it("reports shows whose episodes the catalog couldn't resolve, so their cursor isn't sealed", async () => {
    // The library holds S1E3, which the catalog doesn't know yet (a partly-hydrated show, or a season TMDB hasn't
    // filled in). That signal is dropped here — and if the caller then advanced the show's cursor, the server's
    // counts would never move again, so the show would never be re-fetched and those episodes would stay missing.
    const unresolved = await applyEpisodePresence(
      prisma,
      "owner",
      "plex",
      {
        "mi-show": [
          { seasonNumber: 1, episodeNumber: 1 },
          { seasonNumber: 1, episodeNumber: 3 },
        ],
      },
      ["mi-show"],
    );
    expect(unresolved).toEqual(["mi-show"]);
    // What DID resolve is still stored — the miss doesn't discard the rest.
    const rows = await prisma.mediaEpisodePresence.findMany({ where: { userId: "owner" } });
    expect(rows.map((r) => r.episodeId)).toEqual(["ep1"]);
  });

  it("reports nothing when every episode resolved", async () => {
    const unresolved = await applyEpisodePresence(
      prisma,
      "owner",
      "plex",
      { "mi-show": [{ seasonNumber: 1, episodeNumber: 1 }] },
      ["mi-show"],
    );
    expect(unresolved).toEqual([]);
  });

  it("drops a show that fell out of one server's library without touching the other's", async () => {
    const refreshed = { "mi-show": [{ seasonNumber: 1, episodeNumber: 1 }] };
    await applyEpisodePresence(prisma, "owner", "plex", refreshed, ["mi-show"]);
    await applyEpisodePresence(prisma, "owner", "jellyfin", refreshed, ["mi-show"]);
    // Jellyfin still syncs other shows, but no longer holds this one.
    await applyEpisodePresence(prisma, "owner", "jellyfin", {}, ["mi-other"]);
    const rows = await prisma.mediaEpisodePresence.findMany({ where: { userId: "owner" } });
    expect(rows.map((r) => r.provider)).toEqual(["plex"]);
  });
});

describe("applyWatched across two connected servers", () => {
  it("tags the log with the server that reported the watch", async () => {
    await applyWatched(prisma, "owner", "jellyfin", [
      { mediaItemId: "mi-show", seasonNumber: 1, episodeNumber: 1, watchedAt: null },
    ]);
    const event = await prisma.seenEvent.findFirst({ where: { userId: "owner", episodeId: "ep1" } });
    expect(event?.source).toBe("jellyfin");
  });

  it("does not double-log a watch both servers report", async () => {
    const signal = [{ mediaItemId: "mi-show", seasonNumber: 1, episodeNumber: 1, watchedAt: null }];
    expect(await applyWatched(prisma, "owner", "plex", signal)).toBe(1);
    expect(await applyWatched(prisma, "owner", "jellyfin", signal)).toBe(0);
    expect(await prisma.seenEvent.count({ where: { userId: "owner", episodeId: "ep1" } })).toBe(1);
  });

  it("honours an in-app unwatch against every server, not just the one that reported it", async () => {
    // The suppression is provider-less on purpose: "I have not watched this" is a statement about the user.
    await suppressWatch(prisma, "owner", "mi-show", "ep1");
    await suppressWatch(prisma, "owner", "mi-movie", null);
    const inserted = await applyWatched(prisma, "owner", "jellyfin", [
      { mediaItemId: "mi-show", seasonNumber: 1, episodeNumber: 1, watchedAt: null },
      { mediaItemId: "mi-movie", seasonNumber: null, episodeNumber: null, watchedAt: null },
    ]);
    expect(inserted).toBe(0);
  });
});

describe("presence reads with two servers", () => {
  it("prefers Plex for the play link when an item is on both", async () => {
    await applyPresence(prisma, "owner", "jellyfin", [
      row({ mediaItemId: "mi-movie", seasonNumber: null, itemKey: "jf-1" }),
    ]);
    await applyPresence(prisma, "owner", "plex", [
      row({ mediaItemId: "mi-movie", seasonNumber: null, itemKey: "plex-1" }),
    ]);

    const refs = await getPresenceRefs("owner");
    expect(refs.get("mi-movie")).toEqual({ provider: "plex", itemKey: "plex-1" });

    const movie = await getMoviePresence("owner", "mi-movie");
    expect(movie?.ref).toEqual({ provider: "plex", itemKey: "plex-1" });
  });

  it("falls back to the other server when the preferred one doesn't have it", async () => {
    await applyPresence(prisma, "owner", "jellyfin", [
      row({ mediaItemId: "mi-movie", seasonNumber: null, itemKey: "jf-1" }),
    ]);
    const refs = await getPresenceRefs("owner");
    expect(refs.get("mi-movie")).toEqual({ provider: "jellyfin", itemKey: "jf-1" });
  });

  it("shows the preferred server's copy for a season held by both", async () => {
    await applyPresence(prisma, "owner", "jellyfin", [
      row({ itemKey: "jf-1", sourceDerived: true, videoResolution: "1080" }),
    ]);
    await applyPresence(prisma, "owner", "plex", [
      row({ itemKey: "plex-1", sourceDerived: true, videoResolution: "4k", hdrFormat: "HDR10" }),
    ]);
    const show = await getShowPresence("owner", "mi-show");
    expect(show.seasons).toEqual(new Set([1]));
    expect(show.sources.get(1)).toMatchObject({ videoResolution: "4k", hdrFormat: "HDR10" });
    expect(show.ref).toEqual({ provider: "plex", itemKey: "plex-1" });
  });

  it("unions the seasons each server holds", async () => {
    await applyPresence(prisma, "owner", "plex", [row({ seasonNumber: 1, itemKey: "plex-1" })]);
    await applyPresence(prisma, "owner", "jellyfin", [row({ seasonNumber: 2, itemKey: "jf-1" })]);
    const show = await getShowPresence("owner", "mi-show");
    expect(show.seasons).toEqual(new Set([1, 2]));
  });

  it("ignores a disconnected server's leftover rows", async () => {
    // Switching a server off doesn't delete its rows — a re-enable should get the library back without a full
    // re-scan — so the reads must exclude it. Otherwise a decommissioned Plex keeps titles badged as owned, hides
    // them from the Download view, and (since Plex outranks Jellyfin) hands the play button a dead deep link.
    await applyPresence(prisma, "owner", "plex", [
      row({ mediaItemId: "mi-movie", seasonNumber: null, itemKey: "plex-1" }),
    ]);
    await applyPresence(prisma, "owner", "jellyfin", [
      row({ mediaItemId: "mi-movie", seasonNumber: null, itemKey: "jf-1" }),
    ]);
    await applyEpisodePresence(prisma, "owner", "plex", { "mi-show": [{ seasonNumber: 1, episodeNumber: 1 }] }, [
      "mi-show",
    ]);

    await connect("jellyfin"); // the owner finishes migrating and switches Plex off

    expect((await getPresenceRefs("owner")).get("mi-movie")).toEqual({ provider: "jellyfin", itemKey: "jf-1" });
    expect(await getEpisodePresence("owner")).toEqual(new Set()); // the Plex-only episode is no longer "owned"
    expect((await getMoviePresence("owner", "mi-movie"))?.ref.provider).toBe("jellyfin");
  });

  it("reports nothing at all once every server is disconnected", async () => {
    await applyPresence(prisma, "owner", "plex", [row({ itemKey: "plex-1" })]);
    await connect();
    expect(await getPresenceRefs("owner")).toEqual(new Map());
    expect((await getShowPresence("owner", "mi-show")).seasons).toEqual(new Set());
  });

  it("prefers a row that actually carries an item key over one written before keys were captured", async () => {
    // Rows predating key capture are null; picking one would produce a play button that can't link anywhere.
    await prisma.mediaPresence.createMany({
      data: [
        { userId: "owner", provider: "plex", mediaItemId: "mi-show", seasonNumber: 1, itemKey: null },
        { userId: "owner", provider: "plex", mediaItemId: "mi-show", seasonNumber: 2, itemKey: "plex-1" },
      ],
    });
    expect((await getPresenceRefs("owner")).get("mi-show")).toEqual({ provider: "plex", itemKey: "plex-1" });
  });
});

describe("getPlayableEpisodeRefs", () => {
  it("links a specific episode to the server that actually holds THAT episode", async () => {
    // Plex has the show but only season 1; Jellyfin has the season-2 episode you're next up on. Ranking by the
    // show-level preference alone would offer "Play in Plex" for an episode Plex doesn't have.
    await applyPresence(prisma, "owner", "plex", [row({ seasonNumber: 1, itemKey: "plex-1" })]);
    await applyPresence(prisma, "owner", "jellyfin", [row({ seasonNumber: 1, itemKey: "jf-1" })]);
    await applyEpisodePresence(prisma, "owner", "plex", { "mi-show": [{ seasonNumber: 1, episodeNumber: 1 }] }, [
      "mi-show",
    ]);
    await applyEpisodePresence(prisma, "owner", "jellyfin", { "mi-show": [{ seasonNumber: 1, episodeNumber: 2 }] }, [
      "mi-show",
    ]);

    const refs = await getPlayableEpisodeRefs("owner", ["ep1", "ep2"]);
    expect(refs.get("ep1")).toEqual({ provider: "plex", itemKey: "plex-1" });
    expect(refs.get("ep2")).toEqual({ provider: "jellyfin", itemKey: "jf-1" });
  });

  it("still prefers Plex when both servers hold the episode", async () => {
    const refreshed = { "mi-show": [{ seasonNumber: 1, episodeNumber: 1 }] };
    await applyPresence(prisma, "owner", "plex", [row({ itemKey: "plex-1" })]);
    await applyPresence(prisma, "owner", "jellyfin", [row({ itemKey: "jf-1" })]);
    await applyEpisodePresence(prisma, "owner", "plex", refreshed, ["mi-show"]);
    await applyEpisodePresence(prisma, "owner", "jellyfin", refreshed, ["mi-show"]);
    expect((await getPlayableEpisodeRefs("owner", ["ep1"])).get("ep1")).toEqual({
      provider: "plex",
      itemKey: "plex-1",
    });
  });

  it("omits an episode no connected server holds, so the poster stays inert", async () => {
    await applyPresence(prisma, "owner", "plex", [row({ itemKey: "plex-1" })]);
    expect(await getPlayableEpisodeRefs("owner", ["ep1"])).toEqual(new Map());
    expect(await getPlayableEpisodeRefs("owner", [])).toEqual(new Map());
  });
});

describe("watch links", () => {
  const links: ServerLinks = {
    plex: { serverId: "machine-1", url: "http://localhost:32400" },
    jellyfin: { serverId: "server-1", url: "http://media-box:8096" },
  };

  it("routes each provider to its own web app", () => {
    expect(watchTarget({ provider: "plex", itemKey: "367" }, links)).toEqual({
      url: plexWebUrl("machine-1", "367"),
      provider: "plex",
      server: "Plex",
    });
    expect(watchTarget({ provider: "jellyfin", itemKey: "abc" }, links)).toEqual({
      url: jellyfinWebUrl("http://media-box:8096", "server-1", "abc"),
      provider: "jellyfin",
      server: "Jellyfin",
    });
  });

  it("builds the URL shape each web client actually routes on", () => {
    expect(plexWebUrl("m1", "367")).toBe(
      "https://app.plex.tv/desktop/#!/server/m1/details?key=%2Flibrary%2Fmetadata%2F367",
    );
    // Verified against the served jellyfin-web bundle (10.11): "#/details?id=…&serverId=…", no "!".
    expect(jellyfinWebUrl("http://host:8096/", "s1", "abc")).toBe("http://host:8096/web/#/details?id=abc&serverId=s1");
  });

  it("returns nothing when a piece is missing, so the poster stays inert instead of linking nowhere", () => {
    expect(watchTarget(null, links)).toBeNull();
    expect(watchTarget({ provider: "plex", itemKey: null }, links)).toBeNull();
    // The server id is only known after a successful sync.
    expect(watchTarget({ provider: "plex", itemKey: "1" }, { ...links, plex: { serverId: null, url: "" } })).toBeNull();
    // A Jellyfin link is relative to the server's own address, so a blank URL can't produce one.
    expect(
      watchTarget({ provider: "jellyfin", itemKey: "1" }, { ...links, jellyfin: { serverId: "s1", url: "" } }),
    ).toBeNull();
  });
});

describe("first-run seed from the environment", () => {
  // The seed only runs when no connection row exists yet; these tests start from that state.
  const SEED_VARS = ["PLEX_URL", "PLEX_TOKEN", "PLEX_LIBRARIES", "JELLYFIN_URL", "JELLYFIN_API_KEY"];

  async function seedWith(env: Record<string, string>) {
    await prisma.setting.deleteMany({ where: { key: "settings:mediaServers" } });
    const saved = { ...process.env };
    // Assigning `undefined` to process.env stores the string "undefined", so an unset variable must be deleted.
    for (const name of SEED_VARS) delete process.env[name];
    Object.assign(process.env, env);
    try {
      return await getMediaServers();
    } finally {
      process.env = saved;
    }
  }

  it("gives a token-only Plex deployment the documented default URL", async () => {
    // PLEX_URL has always been optional — the client defaulted to localhost:32400. Seeding a blank URL would make
    // isUsable false and silently switch off an integration that used to work.
    const config = await seedWith({ PLEX_TOKEN: "abc123" });
    expect(config.plex).toMatchObject({ enabled: true, url: "http://localhost:32400", token: "abc123" });
    expect(isUsable(config.plex)).toBe(true);
  });

  it("leaves a provider with no token switched off and address-less", async () => {
    const config = await seedWith({});
    expect(config.plex).toMatchObject({ enabled: false, url: "", token: "" });
    expect(isUsable(config.plex)).toBe(false);
  });

  it("completes a bare Jellyfin host and carries the Plex library allowlist through", async () => {
    const config = await seedWith({
      PLEX_TOKEN: "p",
      PLEX_LIBRARIES: "TV Shows,Movies",
      JELLYFIN_URL: "10.0.0.5",
      JELLYFIN_API_KEY: "k",
    });
    expect(config.jellyfin).toMatchObject({ enabled: true, url: "http://10.0.0.5:8096", token: "k" });
    expect(config.plex.libraries).toBe("TV Shows,Movies");
  });

  it("is a seed, not config: once stored, the environment no longer wins", async () => {
    expect((await seedWith({ PLEX_TOKEN: "first" })).plex.token).toBe("first");
    // The row now exists, so a later environment change must be ignored — otherwise a token edited on /admin
    // would be silently overwritten by a stale env on the next boot.
    const saved = { ...process.env };
    Object.assign(process.env, { PLEX_TOKEN: "second" });
    try {
      expect((await getMediaServers()).plex.token).toBe("first");
    } finally {
      process.env = saved;
    }
  });
});

describe("credentials at rest", () => {
  // The property that matters: a copy of the database — a nightly backup, a downloaded snapshot — must not carry a
  // usable token. Everything above lib/media/config works in plaintext; the Setting row does not.
  async function storedRow(): Promise<string> {
    return (await prisma.setting.findUnique({ where: { key: "settings:mediaServers" } }))!.value;
  }

  it("never writes a token to the database in the clear", async () => {
    await setMediaServer("plex", {
      enabled: true,
      url: "http://localhost:32400",
      token: "super-secret-plex-token",
      libraries: "",
      user: "",
    });
    const row = await storedRow();
    expect(row).not.toContain("super-secret-plex-token");
    expect(row).toContain("enc:v1:");
    // …and it still reads back intact for the scanner that has to use it.
    expect((await getMediaServer("plex")).token).toBe("super-secret-plex-token");
  });

  it("re-encrypts the other provider's token when only one is saved", async () => {
    await setMediaServer("jellyfin", {
      enabled: true,
      url: "http://jf:8096",
      token: "jf-secret",
      libraries: "",
      user: "Sava",
    });
    await setMediaServer("plex", {
      enabled: true,
      url: "http://localhost:32400",
      token: "plex-secret",
      libraries: "",
      user: "",
    });
    const row = await storedRow();
    expect(row).not.toContain("jf-secret"); // the untouched provider mustn't be written back in the clear
    expect(row).not.toContain("plex-secret");
    const all = await getMediaServers();
    expect([all.plex.token, all.jellyfin.token]).toEqual(["plex-secret", "jf-secret"]);
  });

  it("upgrades a legacy plaintext row on the next read", async () => {
    // Rows written before encryption existed keep working — and stop being copied into tonight's backup.
    const legacy = (token: string) => ({ enabled: true, url: "http://x", token, libraries: "", user: "" });
    await setSetting("settings:mediaServers", { plex: legacy("old-plaintext"), jellyfin: legacy("") });

    expect((await getMediaServers()).plex.token).toBe("old-plaintext"); // still readable
    const row = await storedRow();
    expect(row).not.toContain("old-plaintext"); // and rewritten encrypted
    expect(row).toContain("enc:v1:");
  });

  it("leaves no readable trace of the old token in the database FILE, not just its rows", async () => {
    // The property that actually protects a backup. Rewriting the row isn't enough: SQLite leaves the replaced
    // cell's bytes in free space, where the plaintext stays greppable and gets copied verbatim by db.backup().
    // Verified against the file on disk, because a row-level assertion passes while the file still leaks.
    const legacy = (token: string) => ({ enabled: true, url: "http://x", token, libraries: "", user: "" });
    await setSetting("settings:mediaServers", { plex: legacy("residue-token-xyz"), jellyfin: legacy("") });
    expect(readFileSync(dbPath).includes("residue-token-xyz")).toBe(true); // it really is in the file to begin with

    await getMediaServers(); // performs the upgrade, then vacuums the residue away

    expect(readFileSync(dbPath).includes("residue-token-xyz")).toBe(false);
    expect((await getMediaServer("plex")).token).toBe("residue-token-xyz"); // still usable, just not in the clear
  });
});

describe("normalizeServerUrl", () => {
  it("completes a bare host with the provider's scheme and default port", () => {
    expect(normalizeServerUrl("plex", "192.168.1.5")).toBe("http://192.168.1.5:32400");
    expect(normalizeServerUrl("jellyfin", "100.86.97.31")).toBe("http://100.86.97.31:8096");
  });

  it("leaves an address that already names a scheme or a port alone", () => {
    expect(normalizeServerUrl("jellyfin", "https://jellyfin.example.com")).toBe("https://jellyfin.example.com");
    expect(normalizeServerUrl("jellyfin", "media-box:9000")).toBe("http://media-box:9000");
    expect(normalizeServerUrl("plex", "http://localhost:32400/")).toBe("http://localhost:32400");
  });

  it("keeps a blank value blank rather than inventing a server", () => {
    expect(normalizeServerUrl("plex", "   ")).toBe("");
  });
});
