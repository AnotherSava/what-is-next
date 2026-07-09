# What's Next — Implementation Brief

A personal, self-hosted tracker for TV series and movies: what I've watched, what I'm behind on, what's planned, and when new episodes air. Replaces TV Time (service shut down July 15, 2026). Single *owner* (Sava) who can edit; the site is also **publicly viewable read-only** — anyone with the URL can browse the content as a showcase, but every mutation requires the owner's session. Deployed with Docker on a server/VPS, reachable from phone/desktop browser.

This document is the complete handover spec. Everything needed — source data locations, external API strategy, data model, import rules with measured facts about the actual export, derived-state definitions, work plan — is in here. When something is ambiguous, prefer the simplest interpretation that keeps the data model intact, and leave a `// TODO(question)` comment.

## 1. Context and inputs on disk

| What | Where | Notes |
|---|---|---|
| New project root | `D:\projects\what-is-next\` | Create the app in `web/` (mirror printlab's layout). `claude-desktop\` holds planning docs — leave it alone. |
| Convention reference | `D:\projects\printlab\web\` | An existing working project by the same author. **Reference, not gospel** — see §3. Read its `AGENTS.md`, `prisma/schema.prisma`, configs (eslint/prettier/tsconfig/vitest), and Dockerfile before scaffolding. |
| TV Time export (PRIMARY import source) | `D:\backup\TV Time\tv time out\` | `tvtime-series-2026-07-07.json`, `tvtime-movies-2026-07-07.json`, `tvtime-lists-2026-07-07.json` (produced by the "TV Time Out" extension). |
| TV Time GDPR dump (secondary/cross-check) | `D:\backup\TV Time\*.csv` | Messy service-oriented CSVs. Only used for reconciliation and a couple of fields (§6.4). Never the primary source. |

The export files are irreplaceable (the service is gone). The importer must treat them as read-only; never modify or move them.

## 2. Stack

Same family as printlab, current versions:

- **Next.js 16** (App Router, RSC), **TypeScript strict**, **React 19**
- **Prisma 7 + SQLite** (`@prisma/adapter-better-sqlite3`), DB file on a Docker volume
- **Tailwind 4**, **zod 4** (validate ALL external JSON: TMDB responses, import files, JSON-in-string columns)
- **vitest** for tests; prettier + eslint configs copied from printlab
- Node LTS per printlab's `.nvmrc` approach

## 3. Deliberate divergences from printlab

printlab is a customer-facing order shop; this is a single-user tracker. Do **not** carry over machinery that only makes sense there. Specifically:

1. **Auth is "public viewer / one owner", not customer flows.** No PIN hashes, tracking tokens, per-order capability tokens, or user registration. Two access levels:
   - **Viewer (default, unauthenticated):** every content page (§8) renders read-only. No login required. All mutation affordances (checkboxes, toggles, add/search-to-add, admin) are hidden.
   - **Owner:** a single `ADMIN_PASSWORD` env var → `/login` form → signed session cookie (e.g. `iron-session` or an HMAC-signed cookie). Unlocks all mutations and `/admin`.

   Enforcement is server-side, always: **every Server Action and the admin page verify the session before doing anything** — hiding buttons is UX, not security. An optional `PUBLIC_ACCESS=off` env flips the whole site to owner-only (middleware redirects viewers to `/login`) in case the showcase mood passes; default is `readonly`. The session cookie stores a `userId` that maps to the seeded `User` row. A side benefit of anonymous read-only traffic: public pages have no per-visitor state, so RSC caching can be aggressive.
2. **An external-API integration layer exists here and didn't there.** A dedicated `src/lib/tmdb/` module: typed fetch wrappers with zod-parsed responses, a global throttle (stay under ~40 requests / 10 s), retry with backoff on 429/5xx, and an in-process request de-dupe. All TMDB knowledge lives in this module; nothing else imports `fetch` for TMDB.
3. **Background jobs are first-class.** printlab is purely request-driven; this app needs a nightly metadata refresh (§7). Use Next's `instrumentation.ts` to register an in-process scheduler (e.g. `node-cron`) on server start, plus a manual "Refresh now" action in the UI. SQLite single-writer is fine at this scale.
4. **Server Actions first.** Mutations (mark episode watched, change tracking state, add to list…) are Server Actions co-located with their features, not REST routes. API routes only where a non-form client needs them — in this project that means exactly one: the Plex scrobble receiver (§7a, Phase 7).
5. **Drop: email (Resend), payments/transactions ledger, promo codes, file upload/slicing, quote snapshots.** None of it applies. Also skip Doppler unless it's already convenient — the only secrets are the TMDB token and the admin password; a `.env` works.
6. **Derived state is computed, never stored** (this one is printlab-*aligned*, but stricter here): "behind / up to date / finished airing" and unwatched counts are pure functions over `Episode.releaseDate` × `SeenEvent`. One module, `src/lib/progress.ts`, owns these rules (§5) and is the most unit-tested code in the app.
7. **Multi-user is a design constraint, not a feature.** v1 ships single-user, but the code must be written so adding accounts later is an *addition*, not a rebuild. The concrete rules are in §5a — treat them as binding as the schema.
8. **The database is the crown jewel, not the app.** TV Time's shutdown is the reason this project exists. Consequences: importer is idempotent and provenance-tagged; nightly SQLite backup (`.backup` copy on the volume, keep 14 days); every entity keeps its external IDs so the data can outlive TMDB too; and a `npm run export` script that dumps user state back to JSON is a v1 requirement, not a nice-to-have.

## 4. External data: TMDB (primary), TVmaze (backlog)

- Register a TMDB API key (free for personal/non-commercial), use the **v4 Read Access Token** as a Bearer header. Env: `TMDB_API_TOKEN`.
- Endpoints used: `/3/find/{id}?external_source=tvdb_id` (resolve series) and `external_source=imdb_id` (resolve movies); `/3/tv/{id}?append_to_response=external_ids`; `/3/tv/{id}/season/{n}` (episode lists with `air_date`, runtime); `/3/movie/{id}?append_to_response=external_ids`; `/3/search/tv` + `/3/search/movie` (add-new + import fallback); `/3/configuration` (image base URLs, fetch once and cache in the `Setting` KV table).
- Show airing status comes from TMDB `status` ("Returning Series", "Ended", "Canceled", "In Production", …); also persist `next_episode_to_air`/`last_episode_to_air` data implicitly via episode rows.
- Posters/backdrops: store TMDB **paths** only; render by hotlinking `https://image.tmdb.org/t/p/{size}{path}` (add to `next.config` image `remotePatterns`). A local poster-cache job is backlog (§10) — the schema (paths, not URLs) already supports switching.
- **Attribution is mandatory**: a footer notice — "This product uses the TMDB API but is not endorsed or certified by TMDB" — with the TMDB logo.
- TVmaze (free, keyless) is a *backlog* cross-check for air dates, not part of v1. Don't build an abstraction layer for hypothetical providers; the external-ID columns are the abstraction.

## 5. Data model

Prisma schema below — reviewed and agreed; keep field names/uniques as-is unless implementation reveals a real defect (document any change at the top of the schema file). Design lineage: MediaTracker's catalog/user-state separation, adapted to this stack.

Key rules encoded in it:

- **Catalog** (`MediaItem`, `Season`, `Episode`) mirrors TMDB and is refreshable at any time without touching user data. One `MediaItem` table for both movies and TV so lists/ratings/seen point at one FK.
- **User state**: `UserMediaState` holds *intent* (`planned | watching | stopped | finished` + favorite); `SeenEvent` is an **append-only watch log** (movie watch = row with `episodeId NULL`; rewatch = another row; `watchedAt` nullable = "seen, date unknown"; `source` tags provenance).
- **Derived, never stored**: behind/up-to-date, unwatched counts, "has this episode aired" (`releaseDate <= today`), next episode to watch.

Definitions for `src/lib/progress.ts` (given a followed show, `now`, its episodes and seen events; specials/season-0 excluded from all counts by default):

| Derived status | Rule |
|---|---|
| `behind` | ≥1 aired, unwatched, non-special episode |
| `up-to-date` | 0 aired-unwatched AND show still expects more (TMDB status Returning/In Production/Planned) |
| `finished` | 0 aired-unwatched AND show Ended/Canceled |
| (user intents `planned`, `stopped`) | from `UserMediaState.tracking`; they override derived display grouping |

"Next up" for a behind show = lowest (seasonNumber, episodeNumber) aired-unwatched non-special episode.

```prisma
// Data model for "What's next". Lineage: MediaTracker (github.com/bonukai/MediaTracker),
// adapted to Prisma + SQLite. Catalog (refreshable from TMDB) is fully separated from
// user state (append-only history, never touched by refresh).

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"
}

// ── CATALOG ──────────────────────────────────────────────────────────────

model MediaItem {
  id        String @id @default(cuid())
  mediaType String // "tv" | "movie"

  tmdbId Int?    @unique
  tvdbId Int?
  imdbId String?

  title         String
  originalTitle String?
  overview      String?
  releaseDate   String? // ISO date string (TMDB convention)
  status        String? // TMDB airing status: "Returning Series" | "Ended" | "Canceled" | ...
  runtime       Int?    // minutes
  posterPath    String? // TMDB path; rendered via configured image base
  backdropPath  String?
  genres        String? // JSON string[] + zod (printlab convention)
  tmdbRating    Float?

  numberOfSeasons  Int? // denormalized for list views; recomputed on refresh
  numberOfEpisodes Int?

  lastRefreshedAt DateTime?
  needsDetails    Boolean   @default(true) // imported stub not yet hydrated from TMDB

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  seasons   Season[]
  episodes  Episode[]
  userState UserMediaState[]
  seen      SeenEvent[]
  listItems ListItem[]
  ratings   Rating[]

  @@unique([tvdbId, mediaType]) // TVDB numbers movies and series independently
  @@index([mediaType])
}

model Season {
  id          String    @id @default(cuid())
  mediaItemId String
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)

  seasonNumber Int
  isSpecials   Boolean @default(false) // season 0
  title        String?
  overview     String?
  releaseDate  String?
  posterPath   String?
  tmdbId       Int?

  episodes Episode[]

  @@unique([mediaItemId, seasonNumber])
}

model Episode {
  id          String    @id @default(cuid())
  mediaItemId String    // denormalized show FK for cheap per-show queries
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)
  seasonId    String
  season      Season    @relation(fields: [seasonId], references: [id], onDelete: Cascade)

  seasonNumber  Int // denormalized for "S02E05" rendering and sorting
  episodeNumber Int
  isSpecial     Boolean @default(false)
  title         String?
  overview      String?
  releaseDate   String? // "has it aired?" is DERIVED (releaseDate <= today), never stored
  runtime       Int?
  tmdbId        Int?
  tvdbId        Int?    // kept from import — allows re-matching if TMDB mapping was wrong
  imdbId        String?

  seen      SeenEvent[]
  listItems ListItem[]
  ratings   Rating[]

  @@unique([mediaItemId, seasonNumber, episodeNumber])
  @@index([mediaItemId, releaseDate])
}

// ── USER STATE ───────────────────────────────────────────────────────────

// Single-user today; every state row still carries userId (free now, saves a
// migration if accounts ever happen). Seed exactly one User with role "owner".
model User {
  id        String   @id @default(cuid())
  name      String
  role      String   @default("owner") // "owner" | "member" — admin/refresh/import actions require "owner",
  //                                      so future added users don't silently get admin rights
  createdAt DateTime @default(now())

  states  UserMediaState[]
  seen    SeenEvent[]
  lists   List[]
  ratings Rating[]
}

model UserMediaState {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  mediaItemId String
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)

  tracking   String  @default("watching") // "planned" | "watching" | "stopped" | "finished" — user INTENT,
  //                                          distinct from derived progress (aired vs seen)
  isFavorite Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, mediaItemId])
  @@index([userId, tracking])
}

// Append-only watch log. Movie watch → episodeId NULL; episode watch → set;
// rewatch → another row. Booleans and counts are always derived from this.
model SeenEvent {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  mediaItemId String
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)
  episodeId   String?
  episode     Episode?  @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  watchedAt DateTime? // null = "seen, date unknown"
  source    String    @default("app") // "app" | "tvtime-import"

  @@index([userId, mediaItemId])
  @@index([episodeId])
}

model Rating {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  mediaItemId String
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)
  episodeId   String?
  episode     Episode?  @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  rating    Float?   // 1–10; nullable — TV Time only had reactions
  liked     Boolean? // preserves TV Time love/like losslessly
  review    String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, mediaItemId, episodeId])
}

// Manual curation only. The watch-next queue is DERIVED, not a list.
model List {
  id          String  @id @default(cuid())
  userId      String
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  description String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  items ListItem[]

  @@unique([userId, name])
}

model ListItem {
  id          String    @id @default(cuid())
  listId      String
  list        List      @relation(fields: [listId], references: [id], onDelete: Cascade)
  mediaItemId String
  mediaItem   MediaItem @relation(fields: [mediaItemId], references: [id], onDelete: Cascade)
  episodeId   String?
  episode     Episode?  @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  position Int      @default(0)
  addedAt  DateTime @default(now())

  @@unique([listId, mediaItemId, episodeId])
}

// Key-value store for app config (TMDB image config cache, refresh bookkeeping).
// JSON-encoded values, typed access via src/lib/settings.ts (printlab pattern).
model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

## 5a. Multi-user readiness rules (binding)

Multi-user support is a plausible later phase. It must never require rewriting queries, components, or the derived-state logic — only *adding* an account system and routes. Five rules make that true; violating them is a bug even though v1 has one user:

1. **No implicit "the user".** Every function that reads or writes user state takes an explicit `userId` parameter. Exactly one seam knows the v1 reality: `getOwner()` in `src/lib/auth.ts` (returns the seeded owner row). Nothing else may query `User` "the first row" or hardcode an id. Grepping for `getOwner(` must be the complete list of places to touch when accounts arrive.
2. **Two identities per request, never conflated:** `sessionUser` (who is logged in — `null` for anonymous viewers) and `displayedUser` (whose data the page shows — in v1 always `getOwner()`). Layouts/pages fetch data for `displayedUser` and compute permissions from `sessionUser` (`canEdit = sessionUser?.id === displayedUser.id`, admin = `sessionUser?.role === "owner"`). The read-only showcase is thus already the multi-user rendering path with `sessionUser = null`; per-user profile pages later (`/u/[handle]`) just vary `displayedUser` and reuse every component unchanged.
3. **Pure derived-state logic.** `progress.ts` functions take episodes + seen events as arguments; they never fetch, never know about sessions.
4. **Scope by design in the DB layer.** All user-state uniques already include `userId` (schema §5); keep it that way for any new table. App-level state (TMDB config cache, refresh log) lives in `Setting`; user preferences, if ever needed, get a new `UserSetting` table — never keys like `"pref:<userId>"` in `Setting`.
5. **Admin ≠ logged-in.** Refresh, import, backups check `role === "owner"`, not merely session presence — so adding `member` users later grants them nothing accidentally.

The later upgrade path (documented here so it's designed-for, NOT built now): add credentials via an auth library (e.g. better-auth / Auth.js) on top of the existing `User` table, add `/u/[handle]` routes where `displayedUser` comes from the URL, add per-user visibility settings, replace `getOwner()` call sites with the routed user. Catalog tables are shared across users by design — only ever one `MediaItem` row per show, whoever tracks it.

## 6. Importer (the make-or-break piece)

A CLI script (`npm run import -- <dir>`), re-runnable and idempotent (natural keys: external IDs for catalog, `(userId, episodeId, source)`-style de-dupe for events). It must produce a **reconciliation report** at the end and write unresolved items to a JSON file rather than dying.

### 6.1 Measured facts about the real export (verified 2026-07-08)

- `tvtime-series-*.json`: array of **83 series**; every series and all **3,766 episodes** have a TVDB id (`id.tvdb`); **zero** have IMDb ids. **1,948 episodes** are `is_watched: true`. Per-series `status` counts: `up_to_date` 47, `not_started_yet` 13, `stopped` 12, `continuing` 11. 17 favorites. Season `number: 0` = specials (`is_specials: true`). `rewatch_count` is 0 everywhere (ignore it). `_noEpisodeData` is false everywhere.
- `tvtime-movies-*.json`: array of **99 movies**; all have `id.tvdb`, **98/99** have `id.imdb`. **81 watched**, 8 favorites, years 1940–2026. `rewatch_count` 0 everywhere.
- `tvtime-lists-*.json`: **one** custom list, "Didn't like", 5 series items referenced by `tvdb_id` + `custom_order`.
- **Bulk-marked timestamps**: ~667 watched episodes share a `watched_at` with ≥10 others (backlog marked in one go when the account was set up, e.g. dozens of episodes at `2023-08-16T03:34:50Z`). Keep these timestamps as-is but tag all imported rows `source: "tvtime-import"` so stats views can treat clustered timestamps as "date approximate".

### 6.2 Field mapping

| TV Time export | Target |
|---|---|
| series `id.tvdb` | `MediaItem.tvdbId` (mediaType "tv"); resolve → `tmdbId` via `/find?external_source=tvdb_id` |
| series `status` `up_to_date` / `continuing` | `UserMediaState.tracking = "watching"` (the split is *derived* state — do not store it) |
| series `status` `not_started_yet` | `tracking = "planned"` |
| series `status` `stopped` | `tracking = "stopped"` |
| series/movie `is_favorite` | `UserMediaState.isFavorite` |
| series/movie `created_at` | `UserMediaState.createdAt` |
| episode `is_watched` + `watched_at` | one `SeenEvent` (episodeId set, `watchedAt` from export, source `tvtime-import`) |
| episode `number` within season `number` | match to TMDB episode by (seasonNumber, episodeNumber); keep `tvdbId` on the Episode row |
| movie `id.imdb` | resolve → `tmdbId` via `/find?external_source=imdb_id`; the 1 movie without imdb id → `/search/movie` by title+year, log for manual confirm |
| movie `is_watched: true` + `watched_at` | `SeenEvent` with `episodeId NULL` + `tracking = "finished"` |
| movie `is_watched: false` | `tracking = "planned"` (the movie watchlist) |
| lists file | `List` + `ListItem` (position = `custom_order`) |

### 6.3 Order of operations

1. Parse + zod-validate export files. 2. Resolve external IDs → TMDB (throttled; cache resolutions in DB so re-runs are cheap). 3. Hydrate catalog: show details + every season's episodes; movie details. 4. Match export episodes to catalog episodes by (season, episode) number; unmatched → report (TVDB/TMDB numbering occasionally disagrees — expected for a handful; do not guess). 5. Write user state. 6. Reconcile and print report.

### 6.4 Acceptance / reconciliation

Report must show: series imported (expect 83), movies (99), episodes matched vs unmatched (expect ≈3,766 matched; investigate if >2% unmatched), SeenEvents for episodes (expect 1,948) and movies (81), favorites (17 + 8), lists (1 with 5 items), unresolved-ID list (expect ≤2). Cross-check against GDPR `user_tv_show_data.csv` (`nb_episodes_seen` per show) and note discrepancies without failing. GDPR CSVs are otherwise ignored in v1 (their `lists-prod-lists.csv` contains raw Go map dumps — do not parse).

## 7. Nightly refresh

Registered via `instrumentation.ts` on server start (guard against double-registration in dev); default schedule `REFRESH_CRON` env (default `0 11 * * *` UTC ≈ 4am Pacific). For each `MediaItem` where `mediaType = "tv"` AND (`status` not in Ended/Canceled OR `lastRefreshedAt` > 30 days ago) → re-fetch show + seasons, upsert catalog rows (never touch user-state tables), update `lastRefreshedAt`. Movies: refresh only those with `releaseDate` null or in the future. Log a one-line summary into `Setting` (`refresh:lastRun`) for the admin page. Also run the SQLite backup here (`.backup` to `/data/backups/`, prune >14 days). Manual "Refresh now" button (per-show and global) calls the same code path.

## 7a. Plex integration (Phase 7 — after deploy; schema needs nothing new)

The owner watches most content via their own Plex Media Server. Integration goal for the first iteration: **watching something in Plex automatically marks it watched here.** The schema already supports this perfectly — Plex payloads identify media by tmdb/tvdb/imdb GUIDs, which map straight onto `MediaItem`/`Episode` external-ID columns; a Plex-originated watch is just a `SeenEvent` with `source: "plex"`.

**Receiver:** `POST /api/plex/webhook?secret=<PLEX_WEBHOOK_SECRET>` — the one non-page API route. It accepts Plex's native webhook format (multipart form with a `payload` JSON part). Processing rules:

1. Reject unless the `secret` query param matches (constant-time compare). Log and 200-swallow malformed payloads (Plex retries aggressively; never make it retry-storm).
2. Handle only `event: "media.scrobble"` with `Metadata.type` of `episode` or `movie`. Ignore play/pause/resume/stop in v1.
3. If `PLEX_OWNER_ACCOUNT` env is set, ignore scrobbles from other Plex accounts/managed users (friends streaming from the server must not write the owner's history).
4. Resolve the media: parse `Metadata.Guid[]` (`tmdb://`, `tvdb://`, `imdb://`; for episodes also `grandparentGuid` → the show). Match episode by tmdbId → tvdbId → imdbId, in that order; movie likewise on `MediaItem`.
5. Matched → insert `SeenEvent` (`watchedAt: now`, `source: "plex"`), with a de-dupe guard: skip if an event for the same episode/movie exists within the last 6 h (scrobble can fire more than once; credits-replays shouldn't double-log).
6. Show exists but episode row doesn't (brand-new episode, nightly refresh hasn't run) → trigger a targeted refresh of that show, then retry the match once.
7. Unmatched entirely (something in Plex not tracked here) → append to an `unmatched-scrobbles` log surfaced on `/admin` with a one-click "add & mark watched" action. Do NOT auto-add — Plex libraries contain other people's tastes.

**How events reach the receiver — two supported senders, same endpoint:**
- *Plex Pass:* native webhook (Settings → Webhooks → add the URL). Zero extra software.
- *No Plex Pass:* Tautulli (free) pointed at the same endpoint via its webhook notification agent, with a JSON template shaped to the same minimal fields the receiver reads (document the template in the repo). Detect by content-type: native Plex is multipart, Tautulli template is `application/json`.

**Backlog (design-compatible, don't build yet):** reconciliation polling of Plex history (`X-Plex-Token`, `/status/sessions/history/all`) to catch webhooks missed during downtime; "on my Plex" badge + deep-link on watch-next cards (match library contents by GUID, link `https://app.plex.tv/desktop#!/server/<machineId>/details?key=...`); syncing Plex watched-state *from* this app back to Plex.

Env (all optional; feature is off unless `PLEX_WEBHOOK_SECRET` is set): `PLEX_WEBHOOK_SECRET`, `PLEX_OWNER_ACCOUNT`, and for the backlog items `PLEX_SERVER_URL` + `PLEX_TOKEN`.

## 8. v1 UI (pages)

Mobile-first (primary device for "what do I watch next" is a phone/TV browser). Dark theme default. Tailwind, no component library unless printlab already established one.

Every content page renders in two modes from the same components: **viewer** (unauthenticated — read-only, no mutation controls, no admin link) and **owner** (full controls). Don't build separate page trees; pass an `isOwner` flag down from the layout (derived from the session) and gate affordances on it. A discreet "Sign in" link lives in the footer next to the TMDB attribution; `/admin` and `/login` are the only non-public routes.

1. **/ (Watch next)** — the payoff screen. Behind-shows with their next-up episode (poster, SxxEyy, title, "mark watched" one tap); below: upcoming airings (next 2 weeks) for up-to-date shows; below: movie watchlist snippet.
2. **/shows** — followed shows grouped: Behind / Up to date / Waiting-finished / Planned / Stopped. Counts (e.g. "3 unwatched"), favorite stars, filter/sort.
3. **/shows/[id]** — show page: poster, status line, seasons as collapsible episode checklists (aired-unaired visually distinct), mark episode / season / "watched up to here", tracking-state switcher, favorite toggle.
4. **/movies** — Watched / Watchlist tabs, mark-watched with date (defaults to today, editable).
5. **/search** — TMDB search (tv+movie), add → creates catalog stub + `UserMediaState` (`planned` by default), hydrates in the background.
6. **/lists** and **/lists/[id]** — manual lists, add/remove/reorder.
7. **/admin** — refresh now, last-refresh log, import report, unresolved imports, backup status. Login page. TMDB attribution in the footer of everything.

## 9. Ops

- **Dockerfile**: multi-stage, mirroring printlab's; SQLite file + backups + (later) poster cache on a volume mounted at `/data`. `DATABASE_URL=file:/data/whats-next.db`.
- Migrations run on container start (`prisma migrate deploy`).
- Env: `TMDB_API_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`, `REFRESH_CRON` (optional), `PUBLIC_ACCESS` (`readonly` default | `off`), `TZ`, plus the optional Plex vars (§7a). Provide `.env.example`.
- Public pages: add `noindex` robots meta by default (it's a showcase for people given the link, not for search engines) — trivially removable later.
- `npm run export` → JSON dump of all user state (+ external IDs), the app's own escape hatch.

## 10. Explicitly out of scope for v1 (backlog)

Multi-user accounts (§5a defines the upgrade path; v1 only obeys its rules); notifications (new-episode email/push); local poster cache; stats page (total watch time etc. — would make the public showcase more fun); numeric ratings UI (schema supports it); TVmaze air-date cross-check; Trakt/SIMKL sync; PWA/offline; per-list visibility controls (v1: everything visible to viewers except `/admin`); Plex extras beyond scrobbling (§7a backlog: history reconciliation, "on my Plex" badges/deep-links, write-back to Plex).

## 11. Working agreements

- Follow printlab's `AGENTS.md` conventions (formatting, commit style) unless contradicted here; §3 lists the intentional differences.
- Test what's cheap to test and high-value: `progress.ts` (derived states — exhaustive unit tests), import mapping (fixture = trimmed real export snippets), TMDB response parsing (recorded fixtures). UI e2e not required in v1.
- Phase order: **0** scaffold (app boots, auth, schema migrated, seeded User) → **1** TMDB client (tested) → **2** importer (acceptance = §6.4 numbers) → **3** core UI (shows/show/movies) → **4** search + watch-next dashboard → **5** refresh job + admin + backups + export script → **6** Dockerfile + deploy docs → **7** Plex scrobble receiver (§7a; needs the deployed URL, hence last — acceptance: a scrobble-shaped test payload creates exactly one correctly-matched `SeenEvent`, and replays within 6 h create none). Each phase ends with `npm run lint && npm run test` green and a short summary of decisions taken.
- After the importer first succeeds against the real export, back up the resulting DB file before iterating further.
