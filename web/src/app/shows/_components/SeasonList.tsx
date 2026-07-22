"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";
import type { DownloadLink } from "@/lib/downloadSources";
import {
  markSeasonWatched,
  markWatchedUpTo,
  setEpisodeWatchedAt,
  setSeasonWatchedAt,
  unmarkEpisodeWatched,
  unmarkSeasonWatched,
} from "../actions";

// The show detail page's left column (design: "Shows Page - Seasons"): an accordion of seasons, each expanding to
// its episode list. Seasons in Plex show a source pill (quality + English audio/subtitle warnings); seasons that
// aren't show a per-season Download picker. When manual watched-editing is on (canEdit), unwatched aired episodes
// reveal "Set watched" / "up to here" on hover, and every watched episode/season shows a click-to-edit watched date
// with a date picker and a trash to unmark. The next-up episode gets an accent rail. All owner actions re-verify
// server-side; this component only wires the affordances. In view-only mode dates are plain, non-editable text.

export interface SeasonListEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  aired: boolean;
  watched: boolean;
  watchedISO: string | null; // "YYYY-MM-DD" for the date-editor input; null = watched-but-undated / unwatched
  watchedLabel: string | null; // "Mon YYYY" stamp; null = watched-but-undated / unwatched
  airsLabel: string | null; // "airs Mon YYYY" / "unaired" for episodes that haven't aired; null once aired
}

export interface SeasonListSeason {
  seasonNumber: number;
  label: string; // "Season 3" | "Specials"
  year: number | null;
  airedCount: number;
  watchedCount: number;
  fullyWatched: boolean;
  inPlex: boolean;
  videoLabel: string | null; // source pill text ("4K Dolby Vision", "1080p", …); null → no video info
  noEnglishAudio: boolean; // season is in Plex with audio tracks but none in English
  noEnglishSubtitles: boolean; // season is in Plex with subtitle tracks but none in English
  downloadLinks: DownloadLink[]; // per-season search links, only when the season isn't in Plex
  latestWatchedISO: string | null; // season date-editor input value (its most recent episode watch)
  latestWatchedLabel: string | null; // "Mon YYYY" shown when the season is folded + fully watched
  episodes: SeasonListEpisode[];
}

export function SeasonList({
  showId,
  seasons,
  canEdit,
  nextUpEpisodeId,
  initialOpenSeason,
  today,
}: {
  showId: string;
  seasons: SeasonListSeason[];
  canEdit: boolean; // owner AND manual watched-editing enabled — gates every watch-state control
  nextUpEpisodeId: string | null; // first aired-unwatched episode → accent rail + auto-open its season
  initialOpenSeason: number | null; // season expanded on load (holds next-up, else the latest season)
  today: string; // todayISO() — the default date for "Set watched"
}) {
  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    initialOpenSeason != null ? { [initialOpenSeason]: true } : {},
  );
  const [editing, setEditing] = useState<string | null>(null); // "ep:<id>" | "sea:<num>"
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [dlOpen, setDlOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({}); // editor key → in-progress ISO date
  const [, start] = useTransition();

  // Escape closes whichever transient surface is open (date editor or a season's download menu).
  useEffect(() => {
    if (!editing && dlOpen == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setEditing(null);
      setConfirmDel(null);
      setDlOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, dlOpen]);

  const closeEditor = () => {
    setEditing(null);
    setConfirmDel(null);
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-4 flex items-baseline justify-between pr-2">
        <h2 className="font-display text-[18px] font-bold">Seasons</h2>
        <span className="font-num text-[10.5px] font-semibold tracking-[0.09em] text-[var(--color-faint)] uppercase">Progress</span>
      </div>

      {seasons.map((s, si) => {
        const isOpen = !!open[s.seasonNumber];
        const seaKey = `sea:${s.seasonNumber}`;
        const showPill = s.inPlex && (s.videoLabel || s.noEnglishAudio || s.noEnglishSubtitles);
        return (
          <div key={s.seasonNumber}>
            <div
              className="se-sum flex items-center gap-3 rounded-[7px] px-2 py-3"
              style={{ borderTop: si === 0 ? undefined : "1px solid #1e1e24", marginTop: si === 0 ? undefined : 14 }}
            >
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [s.seasonNumber]: !o[s.seasonNumber] }))}
                aria-expanded={isOpen}
                className="flex min-w-0 items-center gap-3 text-left"
              >
                <svg
                  className="se-chev shrink-0"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-faint)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ transform: isOpen ? "rotate(90deg)" : undefined }}
                  aria-hidden
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <span className="font-display text-[15px] font-semibold whitespace-nowrap tabular-nums">
                  {s.label}
                  {s.year != null && <span className="ml-1.5 font-medium text-[#6a6a74]">({s.year})</span>}
                </span>
              </button>

              {showPill && (
                <span
                  className="inline-flex h-6 min-w-0 shrink items-center overflow-hidden rounded-[7px] border px-[10px] font-num text-[11.5px] whitespace-nowrap"
                  style={{ borderColor: "var(--color-border-elevated)", background: "rgba(255,255,255,0.04)", textOverflow: "ellipsis" }}
                >
                  {s.videoLabel && <span className="text-[#a2a2ac]">{s.videoLabel}</span>}
                  {s.noEnglishAudio && (
                    <>
                      <span className="text-[var(--color-faint)]">&ensp;·&ensp;</span>
                      <span className="text-[#cf6f6b]">No English audio</span>
                    </>
                  )}
                  {s.noEnglishSubtitles && (
                    <>
                      <span className="text-[var(--color-faint)]">&ensp;·&ensp;</span>
                      <span className="text-[#cf6f6b]">No English subtitles</span>
                    </>
                  )}
                </span>
              )}

              {!s.inPlex && s.downloadLinks.length > 0 && (
                <span className="relative inline-flex min-w-0 items-center">
                  <button
                    type="button"
                    className="se-dl"
                    title="Find download sources"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDlOpen((d) => (d === s.seasonNumber ? null : s.seasonNumber));
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                    <svg className="se-dl-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {dlOpen === s.seasonNumber && (
                    <>
                      <div className="fixed inset-0 z-[29]" onClick={() => setDlOpen(null)} aria-hidden />
                      <div className="absolute top-[calc(100%+7px)] left-0 z-30 min-w-[200px] rounded-[11px] border p-1.5" style={POPOVER}>
                        <div className="wn-menu-head">Download source</div>
                        {s.downloadLinks.map((l) => (
                          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="wn-menu-item block" onClick={() => setDlOpen(null)}>
                            {l.label}
                          </a>
                        ))}
                      </div>
                    </>
                  )}
                </span>
              )}

              <div className="relative ml-auto flex items-center gap-[14px]">
                <span
                  className="w-[46px] shrink-0 text-right font-num text-[13px] tabular-nums"
                  style={{ visibility: isOpen ? "hidden" : "visible", color: s.fullyWatched ? "#8b9be0" : "var(--color-faint)" }}
                >
                  {s.watchedCount}/{s.airedCount}
                </span>
                <span className="flex w-[104px] shrink-0 items-center justify-end">
                  {!isOpen && canEdit && !s.fullyWatched && s.airedCount > 0 && (
                    <button
                      type="button"
                      className="se-ghost se-seasonset"
                      onClick={() => start(() => markSeasonWatched(showId, s.seasonNumber))}
                    >
                      Set watched
                    </button>
                  )}
                  {!isOpen && s.fullyWatched && (
                    <DateTrigger
                      canEdit={canEdit}
                      label={s.latestWatchedLabel ?? (canEdit ? "Set date" : "")}
                      onOpen={() => setEditing(seaKey)}
                    />
                  )}
                </span>
                {editing === seaKey && (
                  <DateEditor
                    title="Season watched on"
                    value={draft[seaKey] ?? s.latestWatchedISO ?? today}
                    confirming={confirmDel === seaKey}
                    onChange={(v) => {
                      setDraft((d) => ({ ...d, [seaKey]: v }));
                      if (v) start(() => setSeasonWatchedAt(showId, s.seasonNumber, v));
                    }}
                    onClose={closeEditor}
                    onReqDelete={() => setConfirmDel(seaKey)}
                    onCancelDelete={() => setConfirmDel(null)}
                    onConfirmDelete={() => {
                      start(() => unmarkSeasonWatched(showId, s.seasonNumber));
                      closeEditor();
                    }}
                  />
                )}
              </div>
            </div>

            {isOpen &&
              s.episodes.map((ep) => {
                const epKey = `ep:${ep.id}`;
                const titleColor = ep.aired ? (ep.watched ? "var(--color-bright)" : "var(--color-text)") : "#6a6a74";
                const isNext = ep.id === nextUpEpisodeId;
                return (
                  <div
                    key={ep.id}
                    className="se-ep flex items-center gap-[13px] rounded-[7px] py-2 pr-2.5 pl-[34px]"
                    style={{ background: isNext ? "rgba(125,149,255,0.06)" : undefined, boxShadow: isNext ? "inset 3px 0 0 var(--color-accent)" : undefined }}
                  >
                    <span className="w-5 shrink-0 text-right font-num text-[12.5px] tabular-nums text-[var(--color-faint)]">
                      {ep.episodeNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]" style={{ color: titleColor }}>
                      {ep.title}
                      {ep.airsLabel && <span className="ml-2.5 font-num text-[11.5px] text-[#7a7a86]">{ep.airsLabel}</span>}
                    </span>
                    <span className="relative flex shrink-0 items-center gap-2">
                      {canEdit && ep.aired && !ep.watched && (
                        <span className="se-epctl flex items-center gap-2">
                          <button type="button" className="se-ghost" onClick={() => start(() => setEpisodeWatchedAt(ep.id, today))}>
                            Set watched
                          </button>
                          <button type="button" className="se-ghost" onClick={() => start(() => markWatchedUpTo(ep.id))} title="Mark this and all earlier aired episodes watched">
                            up to here
                          </button>
                        </span>
                      )}
                      {ep.watched && (
                        <DateTrigger
                          canEdit={canEdit}
                          label={ep.watchedLabel ?? (canEdit ? "Set date" : "")}
                          onOpen={() => setEditing(epKey)}
                        />
                      )}
                      {editing === epKey && (
                        <DateEditor
                          title="Watched on"
                          value={draft[epKey] ?? ep.watchedISO ?? today}
                          confirming={confirmDel === epKey}
                          onChange={(v) => {
                            setDraft((d) => ({ ...d, [epKey]: v }));
                            if (v) start(() => setEpisodeWatchedAt(ep.id, v));
                          }}
                          onClose={closeEditor}
                          onReqDelete={() => setConfirmDel(epKey)}
                          onCancelDelete={() => setConfirmDel(null)}
                          onConfirmDelete={() => {
                            start(() => unmarkEpisodeWatched(ep.id));
                            closeEditor();
                          }}
                        />
                      )}
                    </span>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

// The floating surface shared by both the download menu and the date editor — kept off the .wn-menu class because
// the date editor needs a wider, more-padded body than that menu's defaults.
const POPOVER = {
  background: "#16161c",
  borderColor: "var(--color-border-elevated)",
  boxShadow: "0 20px 44px -16px rgba(0,0,0,0.9)",
} as const;

// The click-to-edit watched-date stamp. Owner → a button that opens the date editor; viewer → plain text (or
// nothing when there's no date to show).
function DateTrigger({ canEdit, label, onOpen }: { canEdit: boolean; label: string; onOpen: () => void }) {
  if (!label) return null;
  if (!canEdit) return <span className="font-num text-[12px] whitespace-nowrap text-[#8b9be0]">{label}</span>;
  return (
    <button type="button" className="se-datebtn font-num text-[12px] whitespace-nowrap text-[#8b9be0]" onClick={onOpen}>
      {label}
    </button>
  );
}

// The watched-date popover: a native date input (persists on pick) plus a trash that confirms, then unmarks.
function DateEditor({
  title,
  value,
  confirming,
  onChange,
  onClose,
  onReqDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  title: string;
  value: string;
  confirming: boolean;
  onChange: (v: string) => void;
  onClose: () => void;
  onReqDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}): ReactNode {
  return (
    <>
      <div className="fixed inset-0 z-[29]" onClick={onClose} aria-hidden />
      <div className="absolute top-[calc(100%+6px)] right-0 z-30 w-[210px] rounded-[11px] border p-3" style={POPOVER}>
        <div className="mb-2 font-num text-[10.5px] font-semibold tracking-[0.09em] text-[var(--color-faint)] uppercase">{title}</div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border px-2.5 py-2 font-num text-[13px] text-[var(--color-text)] outline-none"
            style={{ background: "var(--color-elevated)", borderColor: "var(--color-border-elevated)", colorScheme: "dark" }}
          />
          {!confirming && (
            <button
              type="button"
              className="se-trash flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border text-[var(--color-muted)]"
              style={{ borderColor: "var(--color-border-elevated)" }}
              title="Remove — mark unwatched"
              onClick={onReqDelete}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
          )}
        </div>
        {confirming && (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="flex-1 font-num text-[12px] text-[#cf6f6b]">Remove?</span>
            <button type="button" className="se-ghost" style={{ color: "#cf6f6b" }} onClick={onConfirmDelete}>
              Remove
            </button>
            <button type="button" className="se-ghost" onClick={onCancelDelete}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </>
  );
}
