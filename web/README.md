# What's next

A personal, self-hosted tracker for TV series and movies — what I've watched, what I'm behind on, what's planned, and when new episodes air. Built to replace TV Time. One **owner** can edit; anyone with the link can browse it read-only as a showcase.

- **Watch next** dashboard: what you can play right now — behind shows whose next episode is already in your media-server library, and unwatched watchlist movies you own.
- **Download** view: what to grab that isn't in your library yet — released watchlist movies you don't own, and behind/not-started shows with aired episodes missing (shows grouped into "Get back", "More of", and "Not started"). Each card links out to your configured search sources (e.g. a torrent tracker) for that title.
- **Shows** grouped Behind / Up to date / Planned / Finished / Stopped, with per-episode checklists.
- **Movies** watched + watchlist, mark-watched with a date.
- **Search** TMDB and add titles; preview a result's full details (cast, seasons) before adding, and details hydrate in the background after.
- **Ratings & director** on movie and show cards: an IMDb rating (★, via OMDb) and the director.
- **Lists** for manual curation.
- **Media-server sync** (Plex and/or Jellyfin): badges the shows/seasons you already have, continuous import of your watch history, and a review-then-add flow for titles that are in a library but not tracked. Both servers can be connected at once — presence, watch history and play links merge — so you can migrate between them without losing either. In-app "unwatch" is durable: a later sync won't re-add it. While you browse, watch state auto-refreshes, and a **Synced** pill in the nav shows how current it is.
- **Recently watched** feed: your watch history across sources (TV Time / Plex / Jellyfin / app), newest first.
- Nightly TMDB metadata refresh + SQLite backups.
- **TVDB fallback** (optional): hydrates niche/fan titles TMDB can't resolve from TheTVDB, so import stubs get real posters and episodes.

## Stack

Next.js 16 (App Router, RSC) · React 19 · TypeScript strict · Prisma 7 + SQLite (better-sqlite3 adapter) · Tailwind 4 · zod 4 · vitest. Metadata comes from [TMDB](https://www.themoviedb.org/).

> This product uses the TMDB API but is not endorsed or certified by TMDB.

## Data model (why it's built this way)

The **catalog** (`MediaItem` / `Season` / `Episode`) mirrors TMDB and is refreshable at any time. **User state** is kept entirely separate and is never touched by a refresh: `UserMediaState` holds intent (a single `wantToWatch` flag + favorite), and `SeenEvent` is an append-only watch log. The display buckets (behind / up-to-date / planned / stopped / finished) and unwatched counts are **derived** from that flag plus the log, never stored — the rules live in one tested module (`src/lib/progress.ts`). Every entity keeps its external IDs (tmdb / tvdb / imdb) so the data can outlive TMDB. The schema is written so adding accounts later is an addition, not a rewrite (see the multi-user rules in the implementation brief).

## Development

Requires Node 24 (`.nvmrc`). Secrets are managed with [Doppler](https://www.doppler.com/) (project `whats-next`, config `dev`); the npm scripts wrap commands in `doppler run`. To run without Doppler, copy `.env.example` to `.env` and drop the `doppler run --` prefixes.

```bash
npm install
npm run db:migrate      # apply migrations
npm run db:seed         # seed the single owner
npm run dev             # http://localhost:3000
```

Sign in at `/login` with `ADMIN_PASSWORD` to unlock editing; without it you get the read-only view.

Quality gates:

```bash
npm run lint
npm run test
```

## Deploy (Docker)

The app runs from a single Ubuntu 24 + Node 24 image built to Next's standalone output. `docker compose up` runs migrations + seed once (a one-shot `migrate` service), then starts the app.

```bash
cp .env.example .env    # fill in ADMIN_PASSWORD, SESSION_SECRET, TMDB_API_TOKEN
docker compose up -d --build
```

The SQLite database and nightly backups live on the `data` volume at `/data` (`DATABASE_URL=file:/data/whats-next.db`, set in `docker-compose.yml`). Migrations run on start (`prisma migrate deploy`). Put a reverse proxy in front for TLS.

### Environment

Media-server connections (URL, token, libraries, Jellyfin account) live in the **database** and are edited on the Settings page — the `PLEX_*` / `JELLYFIN_*` variables below only **seed** that row on first run and are ignored afterwards, so editing a token in the UI isn't overwritten on the next boot.

| Var                     | Required | Default                  | Notes                                                                                            |
| ----------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | yes      | —                        | `file:/data/whats-next.db` in Docker; `file:./prisma/dev.db` in dev                              |
| `ADMIN_PASSWORD`        | yes      | —                        | owner login password                                                                             |
| `SESSION_SECRET`        | yes      | —                        | signs the owner session cookie **and** derives the key that encrypts stored server tokens — `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `TMDB_API_TOKEN`        | yes      | —                        | TMDB v4 Read Access Token (Bearer)                                                               |
| `OMDB_API_KEY`          | no       | —                        | OMDb API key; adds the IMDb rating (★) shown on cards (hidden when unset)       |
| `PUBLIC_ACCESS`         | no       | `readonly`               | `off` makes the whole site owner-only                                                            |
| `REFRESH_CRON`          | no       | `0 11 * * *`             | nightly refresh + backup schedule (UTC)                                                          |
| `TZ`                    | no       | host                     | timezone for "has it aired" / "this week"                                                        |
| `PLEX_URL`              | no       | `http://localhost:32400` | seed only — Plex server base URL                                                                 |
| `PLEX_TOKEN`            | no       | —                        | seed only — Plex `X-Plex-Token`; present at first run ⇒ Plex starts enabled                      |
| `PLEX_LIBRARIES`        | no       | all TV+movie             | seed only — comma-separated Plex library titles to sync (e.g. `TV Shows,Movies`)                 |
| `JELLYFIN_URL`          | no       | `http://localhost:8096`  | seed only — Jellyfin server base URL (a bare host gets `http://` + `:8096`)                      |
| `JELLYFIN_API_KEY`      | no       | —                        | seed only — Jellyfin API key; present at first run ⇒ Jellyfin starts enabled                     |
| `MEDIA_VIEW_TTL_SECONDS`| no       | `60`                     | seconds before browsing the app re-syncs; also sets the header freshness-dot thresholds          |
| `TVDB_API_KEY`          | no       | —                        | TVDB v4 API key; enables the fallback that hydrates titles TMDB can't resolve                    |
| `TVDB_PIN`              | no       | —                        | TVDB subscriber PIN — only for a "user-supported" key; omit for a licensed key                   |

## Ops

- **Nightly job** (registered in `src/instrumentation.ts`): refreshes TMDB metadata for still-airing shows and future/undated movies, backs up the SQLite file to `/data/backups` (14-day retention), and refreshes presence + imports new watch history from every connected media server. One server being down doesn't stop the others. Trigger the refresh manually — globally or per-show — from `/admin`.
- **Media servers** (Plex, Jellyfin, or both): connect them on the Settings page, then run a sync and review/add library-only titles from `/admin`. Each server syncs independently — its own cursors, its own presence rows — so neither can clobber the other's data. Every sync (nightly + manual) refreshes presence and imports watch history, and flags items it can't identify (no external id) so you can fix the match on that server. The owner's browsing also triggers a throttled sync (at most once per `MEDIA_VIEW_TTL_SECONDS`), so what you're looking at stays current without waiting for the nightly job; the **Synced** pill in the nav follows whichever server is *lagging* and turns yellow/red (Stale) as it ages. Adding _new titles_ to tracking is always a manual, reviewed action.
  - With both connected, presence is the union (having an episode on either server means you can watch it) and a play button opens Plex when it has the title, else Jellyfin.
  - Jellyfin watch state is per account, so pick which account to read; a server with more than one account reports the available names instead of guessing.
  - **Credentials are encrypted at rest.** Server tokens are stored AES-256-GCM-encrypted in the database, with the key derived from `SESSION_SECRET`, so a database copy — a nightly backup, a downloaded snapshot — carries no usable credential. Rotating `SESSION_SECRET` makes stored tokens unreadable: each affected server reports as disconnected until you paste its token again (nothing else is encrypted, so no history is ever at risk).
- **Settings** (the gear → `/admin`): connect your media servers, and toggle the manual "mark watched" controls — off by default, since watch state comes from the sync. You can also configure **download search links**: per-source URL templates (stored in the database, never in the repo) that add a search link to each movie and show in the Download view.
- **TVDB fallback** (when `TVDB_API_KEY` is set): the refresh also hydrates catalog rows TMDB can't resolve (fan/web titles the import left as bare stubs) from TheTVDB, keyed by their TVDB id. `/admin` shows how many such titles remain.
- **Backups** are consistent online SQLite snapshots; copy them off the volume periodically.
