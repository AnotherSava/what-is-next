# What's next

A personal, self-hosted tracker for TV series and movies — what I've watched, what I'm behind on, what's planned, and when new episodes air. Built to replace TV Time. One **owner** can edit; anyone with the link can browse it read-only as a showcase.

- **Watch next** dashboard: two columns of what you can play right now from Plex — unwatched watchlist movies you own, and behind shows whose next episode is already in your library.
- **Download** view: what to grab that isn't in Plex yet — released watchlist movies you don't own, and behind/not-started shows with aired episodes missing (shows grouped into "Get back", "More of", and "Not started").
- **Shows** grouped Behind / Up to date / Planned / Finished / Stopped, with per-episode checklists.
- **Movies** watched + watchlist, mark-watched with a date.
- **Search** TMDB and add titles; details hydrate in the background.
- **Lists** for manual curation.
- **Plex** library sync: badges the shows/seasons you have in Plex, an "In Plex" filter, continuous import of your Plex watch history, and a review-then-add flow for Plex-only titles. In-app "unwatch" is durable — a later sync won't re-add it. While you browse, watch state auto-refreshes from Plex, and a dot beside _Admin_ shows how current it is.
- **Recently watched** feed: your watch history across sources (TV Time / Plex / app), newest first.
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

| Var                     | Required | Default                  | Notes                                                                                            |
| ----------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | yes      | —                        | `file:/data/whats-next.db` in Docker; `file:./prisma/dev.db` in dev                              |
| `ADMIN_PASSWORD`        | yes      | —                        | owner login password                                                                             |
| `SESSION_SECRET`        | yes      | —                        | signs the owner session cookie — `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `TMDB_API_TOKEN`        | yes      | —                        | TMDB v4 Read Access Token (Bearer)                                                               |
| `PUBLIC_ACCESS`         | no       | `readonly`               | `off` makes the whole site owner-only                                                            |
| `REFRESH_CRON`          | no       | `0 11 * * *`             | nightly refresh + backup schedule (UTC)                                                          |
| `TZ`                    | no       | host                     | timezone for "has it aired" / "this week"                                                        |
| `PLEX_URL`              | no       | `http://localhost:32400` | Plex server base URL                                                                             |
| `PLEX_TOKEN`            | no       | —                        | Plex `X-Plex-Token`; the whole Plex feature is hidden when unset                                 |
| `PLEX_LIBRARIES`        | no       | all TV+movie             | comma-separated Plex library titles to sync (e.g. `TV Shows,Movies`)                             |
| `PLEX_VIEW_TTL_SECONDS` | no       | `60`                     | seconds before browsing the app re-syncs Plex; also sets the header freshness-dot thresholds     |
| `TVDB_API_KEY`          | no       | —                        | TVDB v4 API key; enables the fallback that hydrates titles TMDB can't resolve                    |
| `TVDB_PIN`              | no       | —                        | TVDB subscriber PIN — only for a "user-supported" key; omit for a licensed key                   |

## Ops

- **Nightly job** (registered in `src/instrumentation.ts`): refreshes TMDB metadata for still-airing shows and future/undated movies, backs up the SQLite file to `/data/backups` (14-day retention), and — when Plex is configured — refreshes the Plex presence badges and imports new watch history. Trigger the refresh manually — globally or per-show — from `/admin`.
- **Plex** (when `PLEX_TOKEN` is set): run a sync and review/add Plex-only titles from `/admin`. Every sync (nightly + manual) refreshes presence and imports your Plex watch history. It also flags items in Plex it can't identify (no external id) so you can fix the match on the Plex side. The owner's browsing also triggers a throttled sync (at most once per `PLEX_VIEW_TTL_SECONDS`), so what you're looking at stays current without waiting for the nightly job; the freshness dot next to _Admin_ turns yellow/red as it ages. Adding _new titles_ to tracking is always a manual, reviewed action.
- **Settings** (`/admin`): the manual "mark watched" controls are off by default — watch state comes from the Plex sync — and a checkbox re-enables them.
- **TVDB fallback** (when `TVDB_API_KEY` is set): the refresh also hydrates catalog rows TMDB can't resolve (fan/web titles the import left as bare stubs) from TheTVDB, keyed by their TVDB id. `/admin` shows how many such titles remain.
- **Backups** are consistent online SQLite snapshots; copy them off the volume periodically.
