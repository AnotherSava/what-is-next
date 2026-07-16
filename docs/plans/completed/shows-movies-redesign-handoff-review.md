# Review — *Shows & Movies redesign* handoff

Feedback on the `design_handoff_shows_movies_redesign` bundle, written for the design author. The reviewer implemented nothing; this is a build-readiness and codebase-accuracy check against the actual *What's Next* repo (Next.js App Router + Tailwind v4). Every claim below was verified against source — codebase references are `path:line`, design references are `FileName:line`.

## Bottom line

The **direction is strong and the codebase is a genuinely good fit** — the five-status show model, the shared card primitives, the Plex deep-link, and the URL-param view-state pattern are all real and reusable, so this is a recreate-in-place job, not a re-architecture.

But the bundle is **not build-ready as written**. An implementer following it today would have to guess on the two most important cards, would silently repaint unrelated screens, and would hit a handful of undesigned states. The issues fall into three buckets:

1. **The handoff contradicts itself** — the two "final" files disagree, and the README describes things the mocks don't render.
2. **Several claims about the codebase are inaccurate** — mostly "this already exists, just reuse it" where the column exists but the reader doesn't surface it.
3. **A set of states and behaviours are undesigned** — missing data, empty states, responsive rules, search.

None of this is fatal; it's a reconciliation pass plus ~7 explicit decisions. Details below.

---

## 1. The handoff contradicts itself (blocking)

### 1.1 The primary spec doesn't consider itself buildable
`Watchlist - Direction.dc.html:102-106` — the file's own "Where we are" board lists two items under **Open**:
- *"Diary: collapse a binge into one entry, or keep one row per episode?"*
- *"Turn these four screens into a buildable spec?"*

This directly contradicts the README's framing (§14-15: *"High-fidelity. … final. … Recreate them precisely"*). The design's own author flagged buildability as unresolved.

### 1.2 The two "final" files disagree on the home hero and the continue-watching card — and the README follows the *secondary* one
The README calls `Watchlist - Direction.dc.html` "**the primary spec**" (§18), then tells you to build the home cards from `Shows Card Options.dc.html` (§19/§98/§100). These render **materially different cards**:

| Element | README §98/§100 (from *Card Options* 4c/4f) | Primary spec (*Direction* 2d) |
|---|---|---|
| Hero poster inset | 100px portrait inset | none (`Direction:143-156`) |
| Hero title | 25px | 30px |
| Hero scrim angle | 90° | 105° |
| Hero heart / `+9` | yes | **neither** |
| Hero timestamp | "no timestamp" | shows "last watched 3d ago" (`Direction:152`) |
| Continue-watching card | heart, `NEXT UP` label, `S2 · E6 +9`, `IMDB 8.7`, `17d ago` | **none of those** — only "4 episodes ready" + "Watched 3d ago" (`Direction:164-179`) |

These are the highest-leverage cards on the home screen. Building to one contradicts the other, and a wrong guess is a full rebuild. **Please pick one file as authoritative for the hero and the continue-watching card and give a single field list for each.**

### 1.3 The "`S2 · E6` everywhere" rule is broken inside the primary file
The card spec (§2) mandates `S2 · E6` — unpadded, with **thin spaces** around the middot — as the universal format. But:
- The diary in the same primary file renders padded `S02E05` / `S03E07` (`Direction:523-531`, and `recently-watched-diary.png` shows `S02E05 · Trojan's Horse`).
- The design system legend and the "one card everywhere" sample both print `S02E06` (`Direction:52,73`).
- Where the readable form *is* built (`Direction:437`), it uses **regular** spaces, not the thin spaces the rule specifies.

So the format the README declares universal is contradicted three times within the primary spec. (For context: the codebase already has three divergent formatters — `page.tsx:121` → `S2 · E6`, `recent/page.tsx:12` and `EpisodeChecklist.tsx:11` → `S02E06` — so whichever you choose, it should be one shared helper.)

### 1.4 README field lists exceed / differ from what the mocks render
Building "to the README" produces a visibly different UI than building "to the mock":

| README says | Mock actually renders |
|---|---|
| Home is "two stacked zones" (§96) | **Three** zones — hero, Continue watching, **and a "Movies ready tonight" 5-up row** (`Direction:182-197`) the README never mentions |
| Diary rows: title+year, `director · genre`, rating, ♥ (§126) | One meta line only (episode: code·name; movie: director); **no year, genre, or rating** (`Direction:352-362`) |
| Recent has a "Liked-only filter" (§126) | Filter chips are **All / Episodes / Movies** — no Liked (`Direction:340-342`) |
| Shows header: "14 tracked · 4 behind · 3 caught up" (§104) | No count line — **jump-tab chips** instead (`Direction:226-230`) |
| Movies-watched badge: `★ 8.7` with star glyph (§78/§123) | Bare TMDB number, no star (`Direction:302`) |
| Nav: Shows · Movies · Recently watched · **Lists** (§93) | Only Shows · Movies · **Recent** — no Lists, label is "Recent" (`Direction:135,215,281`) |

Recommend treating the `.dc.html` as authoritative and rewriting the README screen specs to match it exactly — but that conflicts with §98/§100 pointing at the other file (see 1.2), which is why 1.2 must be resolved first.

### 1.5 README token values disagree with the `.dc.html`
"Recreate precisely" is impossible when the two sources give different numbers:
- Nav active pill background: README `rgba(…,0.06)` vs mock `rgba(…,0.16/0.18)` (`Direction:134,215`)
- Nav active pill: README specifies a `1px #3a3f52` border + `#ededf0` text + no weight; mock has **no border**, `#a9b9ff`/`#fff` text, weight 600
- Hero scrim `90°` vs `105°`; hero title `25px` vs `30px`; eyebrow `10px` vs `11px`

Also worth noting: the *Direction* caption (`:201`) describes the active nav state as a "blue underline" with other tabs "in amber", but the rendered mock shows blue **fill-pills**, no underline, no amber — the primary spec contradicts its own rendered nav.

### 1.6 Search is in every mock but absent from the written spec
Search fields appear on Shows, Movies, and Recent (`Direction:220,286,334`; intro `:119`), and the title annotations literally read "*was 1b · + search*" — i.e. added late. The README's screen specs and "State & data" section never mention search: no spec for what fields it searches, client-filter vs server-search, or the no-results state. Either specify it or drop it.

---

## 2. Inaccurate claims about the codebase

These aren't design flaws, but the README's "just reuse what's there" framing will cause under-scoping. Correcting them makes the next handoff accurate.

### 2.1 "Already using next/font — swap families" is false (§57)
There is **no font pipeline at all**: `layout.tsx` imports no font, no `next/font` anywhere, no font dependency, and `globals.css:29-42` uses a system stack. All three families are greenfield, and JetBrains Mono — which the design leans on heavily (codes, ratings, labels, timestamps) — would be the app's **first monospace**. This is the largest single piece of new setup, not a trivial swap.

### 2.2 "Extend the existing token layer" collides with the proposed values (§26)
`globals.css:5-17` is a real Tailwind v4 `@theme` layer, but:
- **The app reads tokens as raw `var(--color-*)` in 170 places across 31 files** (not via generated utilities). Folding the design's new *values* into the existing names silently repaints **every** screen, including non-redesigned ones (login, admin, lists, credits): `--color-bg` `#0a0a0b`→`#08080a`, `--color-accent` `#6d8bff`→`#7d95ff`, `--color-border` `#2a2a31`→`#26262e`, `--color-muted` `#9a9aa6`→`#8b8b96`.
- **Names differ**: design tokens are unprefixed (`--bg`, `--accent`) vs the app's `--color-*`. Keeping them unprefixed creates two parallel token systems that drift — undermining the README's own "single source of truth" goal.
- **The surface scale is renumbered and collides**: design `--surface-2` (`#121216`, "Cards") ≠ existing `--color-surface-2` (`#1c1c21`); design `--surface-3` (`#141417`) = existing `--color-surface`.
- `--color-bad` (the app's error red) has **no equivalent** in the design table — a "replace the set" reading would drop error/destructive UI.

A concrete naming/migration convention needs to be part of the handoff; "fold them in" is under-specified.

### 2.3 "All the fields already exist in the schema and lib/ readers" overstates it (§137-142)
The schema *columns* exist, but the **readers that feed the cards don't surface** several of them:
- `runtime` — on `MediaItem` and `getMovieDetail`, but **not** on `MovieSummary` (the list/card reader).
- `genres` — stored as a **raw JSON string never parsed** by any reader.
- `backdropPath` — returned by `getShowDetail` only, **not** by the home/dashboard readers the hero would consume.
- The "N episodes ready" downloaded count and every extra **diary field** (year, director, genre, rating, liked) are not on their respective readers.

**Good news, though — the *derivations* mostly already exist**, so this is plumbing, not new logic: `unwatchedInPlexCount()` (`download.ts:73`) is exactly the "N episodes ready" figure; `hasAired()` (`progress.ts:48`) already backs the availability split and is applied to watchlist movies in `download.ts:97`; and `dashboard.ts:80-86,113-115` already computes last-watched and sorts by it, so the hero's "most-recently-watched" candidate is half-derived. The handoff can safely promise these as reusable.

### 2.4 `released` is described as a flag but isn't stored (§141)
There is no `released` boolean — only `MediaItem.releaseDate`. The "Coming soon" availability group depends on a `releaseDate <= today` derivation (i.e. `hasAired`), not a stored field.

### 2.5 "Favourite heart" and "Liked filter" are conflated, but they're two different fields
- `UserMediaState.isFavorite` (surfaced, drives the current ♥) vs `Rating.liked` (imported from TV Time, **read by nothing**). The README uses "favourite heart" and "Liked filter/liked heart" interchangeably without saying which bit backs them. Please state which is the source of truth. (Reusing `isFavorite` matches the current amber ♥ but abandons the imported `liked` data.) Also note `isFavorite` is presently only shown/settable for **watched** movies — the redesign puts hearts on watchlist cards and the show hero, which is a behavioural extension.

### 2.6 The nav merge drops real items, and the header is a server component
- Merging the wordmark with "Watch next" is correct — they're genuinely redundant (both → `/`). But the mock nav (Shows/Movies/Recent) drops **Lists** (which the README then re-invents in §93) and, critically, the **owner-only Download / Search / Admin items + the FreshnessDot** that live in the header today (`SiteHeader.tsx:18-27,46`). The merge must preserve those.
- The active-pill treatment needs `usePathname`, which turns the currently-static **server** `SiteHeader` into a client boundary — worth calling out as an architectural note.

### 2.7 "Reuse PosterPlay for the hero Play button" is imprecise (§131)
`PosterPlay.tsx` is a **poster-shaped anchor**, not a pill button. The hero's amber "▶ Play in Plex" button shares only the `plexWatchUrl` computation, not the component. In-Plex *posters* can reuse `PosterPlay` directly; the button can't.

### 2.8 Minor: `EmptyColumn` is mischaracterized (§135)
`EmptyColumn` is explicitly a per-column placeholder for the two-column grids, not a whole-screen empty state (whole-screen empties are inline `<p>` blocks today). "Reuse EmptyColumn conventions for whole-screen empties" inverts its purpose; there is no shared whole-screen empty component to reuse.

---

## 3. Undesigned states & decisions the handoff still needs

Every screen depends on these and none are drawn:

- **Missing-data cards.** No mock shows a card with no rating (the sample data itself has null ratings — Mickey 17, Dune: Prophecy), no backdrop for the hero, a movie with no director, or a show with no next-up episode.
- **Empty states.** No visual for "no shows", "no watch history", or an empty Watched gallery. (§135 only covers hiding empty *groups*.)
- **Responsive rules.** Grids are "`repeat(5,1fr)` (responsive down on narrow)" with no breakpoints; all mocks are fixed 1040px. The app wraps every page in `max-w-4xl`, so the 5-across poster shelves and wide hero need explicit reflow rules.
- **`+9` semantics.** The same show (Severance) is "+9", "4 to watch", and "4 episodes ready" across the mocks. Define exactly what `+9` counts (downloaded-and-waiting beyond next? total unwatched? full queue?) and reconcile the sample numbers.
- **Diary granularity.** Your own Open list asks it: collapse a binge into one entry, or one row per episode? This changes both the data derivation and the row layout.
- **Search behaviour** (see 1.6).

---

## 4. What's accurate and reusable (so the next pass can lean on it)

Credit where due — these README claims check out and are directly reusable:
- **Five-status show grouping** (Behind → Up to date → Planned → Finished → Stopped) is derived exactly as described in `lib/progress.ts` + `lib/shows.ts`, in the same order. Shows is already grouped by status today (not a "flat undifferentiated grid" — it just uses horizontal cards instead of a poster wall).
- **`/recent` already combines episodes and movies** (`recent.ts:19` tags each entry `episode`/`movie`), matching the "episodes + films together" intent.
- **`PosterPlay` / `posterUrl()` / the Plex presence helpers** (`getPlexPresenceKeys`, `isPlexConfigured`) exist and are already used across the app.
- **The URL-param view-state pattern** is established (`?tab=` on Movies, `?plex=` on Shows) — a good fit for sort/filter/group state, though note the existing `"use client"` islands are all *mutation* controls; the sort/filter/jump-tab islands the redesign needs would be the first *view-state* islands.
- **`Poster.tsx` and `MovieText.tsx` are the right extension points** for the one-card spec — they're the shared primitives, even though today they render only a bare image + title/director/rating (no 2:3 enforcement, episode code, `+9`, chip, or progress bar yet).

---

## 5. Open questions to resolve before build

A checklist the handoff could answer to become build-ready:

1. **Hero + continue-watching card:** which file is authoritative — *Direction* 2d (simpler: "N episodes ready" + timestamp, no heart/`+9`/IMDB) or *Card Options* 4c/4f (inset, heart, `+9`, IMDB)? One field list each.
2. **Episode-code format:** `S2 · E6` or `S02E06`? Thin spaces or regular? (Applies to the diary too — route it through the same formatter.)
3. **Nav:** confirm final item set including the owner-only Download / Search / Admin + FreshnessDot, and whether "Lists" stays (mock omits it).
4. **`+9`:** exact definition, and reconcile the sample numbers.
5. **Diary:** binge-collapse vs one-row-per-episode; and the per-row fields for the **episode** case (episodes have no director/genre/year).
6. **Favourite vs Liked:** which underlying field backs the heart and the "Liked" filter.
7. **Search:** ship it or drop it; if shipping, the fields/scope/empty-result behaviour.
8. **Token strategy:** prefixed (`--color-*`, app-wide) vs a parallel scoped layer, plus the surface-scale reconciliation — and confirm whether the base-value changes (`--bg`, `--accent`, `--border`, `--muted`) are an intentional full-app reskin or should be scoped to the new screens only.
9. **Missing-data / empty / responsive** states for all four screens.

---

*Scope note: the design touches home/shows/movies/recent, but the token and font changes ripple app-wide. With the decisions above settled, this is a medium–large project — the backend is mostly plumbing existing helpers into readers, and the bulk of the effort is the new card/overlay components, the two contested home cards, the Shows poster-wall + jump-tabs, the Movies gallery+split, and the diary rebuild.*
