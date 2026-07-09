# What's next

A personal, self-hosted tracker for TV series and movies — what I've watched, what I'm behind on, what's planned, and when new episodes air. Built to replace TV Time. One **owner** can edit; anyone with the link can browse it read-only as a showcase.

- **Watch next** dashboard: behind shows with the exact next episode to watch (one-tap done), airings in the next two weeks, movie watchlist.
- **Shows** grouped Behind / Up to date / Planned / Finished / Stopped, with per-episode checklists.
- **Movies** watched + watchlist, mark-watched with a date.
- **Search** TMDB and add titles; details hydrate in the background.
- **Lists** for manual curation.
- **Plex** library sync: badges the shows/seasons you have in Plex, an "In Plex" filter, and a review-then-add flow that pulls Plex-only titles into tracking (with their Plex watch state).
- Nightly TMDB metadata refresh + SQLite backups; a JSON export as the escape hatch.

## Stack

Next.js 16 (App Router, RSC) · React 19 · TypeScript strict · Prisma 7 + SQLite (better-sqlite3 adapter) · Tailwind 4 · zod 4 · vitest. Metadata comes from [TMDB](https://www.themoviedb.org/).

> This product uses the TMDB API but is not endorsed or certified by TMDB.

## Data model (why it's built this way)

The **catalog** (`MediaItem` / `Season` / `Episode`) mirrors TMDB and is refreshable at any time. **User state** is kept entirely separate and is never touched by a refresh: `UserMediaState` holds intent (planned / watching / stopped / finished + favorite), and `SeenEvent` is an append-only watch log. Behind / up-to-date / finished and unwatched counts are **derived**, never stored — the rules live in one tested module (`src/lib/progress.ts`). Every entity keeps its external IDs (tmdb / tvdb / imdb) so the data can outlive TMDB. The schema is written so adding accounts later is an addition, not a rewrite (see the multi-user rules in the implementation brief).

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

## Import from TV Time

Point the importer at a directory holding the "TV Time Out" export files (`tvtime-series-*.json`, `tvtime-movies-*.json`, `tvtime-lists-*.json`). It's idempotent and provenance-tagged, so it's safe to re-run.

```bash
npm run import -- <export-dir>
```

It resolves external IDs to TMDB (throttled, cached), hydrates the catalog, matches watch history, and prints a reconciliation report. The full report and any unresolved items are written to `scripts/out/`, and a summary shows on `/admin`. **Back up the resulting DB before iterating further.**

## Export

```bash
npm run export          # → scripts/out/export-<timestamp>.json
```

Dumps all user state keyed by external IDs — the app's own escape hatch.

## Deploy (Docker)

The app runs from a single Ubuntu 24 + Node 24 image built to Next's standalone output. `docker compose up` runs migrations + seed once (a one-shot `migrate` service), then starts the app.

```bash
cp .env.example .env    # fill in ADMIN_PASSWORD, SESSION_SECRET, TMDB_API_TOKEN
docker compose up -d --build
```

The SQLite database and nightly backups live on the `data` volume at `/data` (`DATABASE_URL=file:/data/whats-next.db`, set in `docker-compose.yml`). Migrations run on start (`prisma migrate deploy`). Put a reverse proxy in front for TLS.

### Environment

| Var              | Required | Default                  | Notes                                                                                            |
| ---------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`   | yes      | —                        | `file:/data/whats-next.db` in Docker; `file:./prisma/dev.db` in dev                              |
| `ADMIN_PASSWORD` | yes      | —                        | owner login password                                                                             |
| `SESSION_SECRET` | yes      | —                        | signs the owner session cookie — `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `TMDB_API_TOKEN` | yes      | —                        | TMDB v4 Read Access Token (Bearer)                                                               |
| `PUBLIC_ACCESS`  | no       | `readonly`               | `off` makes the whole site owner-only                                                            |
| `REFRESH_CRON`   | no       | `0 11 * * *`             | nightly refresh + backup schedule (UTC)                                                          |
| `TZ`             | no       | host                     | timezone for "has it aired" / "this week"                                                        |
| `PLEX_URL`       | no       | `http://localhost:32400` | Plex server base URL                                                                             |
| `PLEX_TOKEN`     | no       | —                        | Plex `X-Plex-Token`; the whole Plex feature is hidden when unset                                 |
| `PLEX_LIBRARIES` | no       | all TV+movie             | comma-separated Plex library titles to sync (e.g. `TV Shows,Movies`)                             |

## Ops

- **Nightly job** (registered in `src/instrumentation.ts`): refreshes TMDB metadata for still-airing shows and future/undated movies, backs up the SQLite file to `/data/backups` (14-day retention), and — when Plex is configured — refreshes the Plex presence badges. Trigger the refresh manually — globally or per-show — from `/admin`.
- **Plex** (when `PLEX_TOKEN` is set): run a sync and review/add Plex-only titles from `/admin/plex`. The nightly job only refreshes presence; adding titles to tracking is always a manual, reviewed action.
- **Backups** are consistent online SQLite snapshots; copy them off the volume periodically.
