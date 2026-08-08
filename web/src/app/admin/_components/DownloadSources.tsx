"use client";

import { useState, useTransition } from "react";
import {
  cleanDownloadSources,
  DEFAULT_SEASON_PATTERN,
  type DownloadSource,
  type LanguageOption,
  sourceLabel,
} from "@/lib/downloadSources";
import { setDownloadSources } from "../actions";
import { ACTION_BUTTON_CLASS } from "./buttonStyle";

// Owner editor for the Download view's source links. Saved sources render as compact read-only rows (label,
// movies/shows state, search language, the start of the URL) with Edit/Delete; adding or editing opens the row's
// form. Each save and delete persists the whole list via the server action, so there's no separate "unsaved
// changes" step. The templates hold the download-source URLs; they live only in the DB, never the repo.

const EMPTY: DownloadSource = {
  label: "",
  template: "",
  movies: true,
  shows: false,
  language: "en",
  seasonPattern: DEFAULT_SEASON_PATTERN,
};

// A language code's display name. A stored code we don't recognise is shown as-is rather than silently reading as
// English. Shared by the read row's language cell and the edit form's native-season label so the two always agree.
function languageLabelOf(languages: LanguageOption[], code: string): string {
  return languages.find((l) => l.code === code)?.name ?? code;
}

// Compact label-input padding matching the design reference (padding: 4px 8px). Kept separate from FIELD_CLASS
// (used by the taller URL textarea).
const LABEL_INPUT_PADDING = "4px 8px";
// The edit label input is pulled LEFT by its own padding+border (8px + 1px = 9px) so its TEXT starts exactly where a
// read row's plain label text does. Vertical alignment is handled by ROW_MIN_HEIGHT instead (see below).
const INPUT_PULL_X = 9;
// Right padding on the language select, leaving room for the chevron we draw over it (14px icon at right: 8px).
const SELECT_ARROW_ROOM = 24;
// Vertical padding on both read and edit rows. 9px so the edit box's highlight has the SAME gap above the label
// input as it does to its left (also 9px) — symmetric background padding around the input box.
const ROW_PAD_Y = 9;
// A fixed top-line height for BOTH read and edit rows (≥ the label input's height). The read row's height is
// otherwise driven by its URL column and the edit row's by its input, so without a shared height the label centers
// at a different y and appears to jump when editing. Pinning both keeps the label + pills at the same y.
const ROW_MIN_HEIGHT = 30;

const FIELD_CLASS =
  "min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]";

// Shared row grid so the label and the Movies/Shows pills sit in the SAME place whether a row is read-only or being
// edited. INLINE styles (not Tailwind arbitrary classes) so the alignment can't be broken by a stale CSS rebuild —
// the exact column geometry must match byte-for-byte between the read and edit rows.
const ROW_GRID_STYLE: React.CSSProperties = {
  display: "grid",
  // The language column is sized to the longest name in the picker — "Norwegian Nynorsk", measured at 108px in
  // Instrument Sans 12px — plus a hair, so the read row never truncates one. (The edit row's select spends ~34px
  // of that on its padding + arrow, so the handful of names past ~76px do truncate while editing; the open
  // dropdown still shows them in full.)
  gridTemplateColumns: "150px 110px 118px minmax(0,1fr) auto",
  columnGap: 14,
  alignItems: "center",
  minHeight: ROW_MIN_HEIGHT,
};
// The edit row's highlight box extends 10px each side; its 18px padding pulls the inner grid back to the read rows'
// left edge (read rows sit at px-2 = 8px; -10 + 18 = 8), so read↔edit content columns line up exactly.
const EDIT_BOX_STYLE: React.CSSProperties = {
  marginLeft: -10,
  marginRight: -10,
  paddingTop: ROW_PAD_Y,
  paddingBottom: ROW_PAD_Y,
  paddingLeft: 18,
  paddingRight: 18,
  borderRadius: 10,
  background: "rgba(125,149,255,0.05)",
};

// The row currently open in the form: its slot (an existing index, or list length for a new row) plus a working
// copy so Cancel can discard it without touching the saved list.
type Editing = { index: number; draft: DownloadSource };

export function DownloadSourcesEditor({
  sources,
  languages,
}: {
  sources: DownloadSource[];
  languages: LanguageOption[];
}) {
  const [list, setList] = useState<DownloadSource[]>(sources);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, start] = useTransition();

  // Persist the full list (the authoritative write); the server action cleans, validates, and revalidates.
  function persist(next: DownloadSource[], after: () => void) {
    start(async () => {
      await setDownloadSources(next);
      setList(cleanDownloadSources(next));
      after();
    });
  }

  function saveEditing() {
    if (!editing) return;
    const draft = { ...editing.draft, label: editing.draft.label.trim(), template: editing.draft.template.trim() };
    if (!draft.template) return; // also guarded by the disabled Save button
    const next = editing.index < list.length ? list.map((r, i) => (i === editing.index ? draft : r)) : [...list, draft];
    persist(next, () => setEditing(null));
  }

  function remove(i: number) {
    if (!window.confirm(`Remove ${sourceLabel(list[i])}?`)) return;
    persist(
      list.filter((_, j) => j !== i),
      () => {},
    );
  }

  const patch = (p: Partial<DownloadSource>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e));
  const addingNew = editing?.index === list.length;

  return (
    <div className="space-y-3">
      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((row, i) =>
            editing?.index === i ? (
              <EditRow
                key={i}
                draft={editing.draft}
                languages={languages}
                patch={patch}
                onSave={saveEditing}
                onCancel={() => setEditing(null)}
                pending={pending}
              />
            ) : (
              <ReadRow
                key={i}
                row={row}
                languageLabel={languageLabelOf(languages, row.language)}
                onEdit={() => setEditing({ index: i, draft: { ...row } })}
                onDelete={() => remove(i)}
                disabled={pending || editing !== null}
              />
            ),
          )}
        </ul>
      )}

      {addingNew && editing && (
        <ul className="space-y-2">
          <EditRow
            draft={editing.draft}
            languages={languages}
            patch={patch}
            onSave={saveEditing}
            onCancel={() => setEditing(null)}
            pending={pending}
          />
        </ul>
      )}

      {!editing && (
        <button
          type="button"
          onClick={() => setEditing({ index: list.length, draft: { ...EMPTY } })}
          className={ACTION_BUTTON_CLASS}
        >
          Add source
        </button>
      )}
    </div>
  );
}

// Compact summary of a saved source: label, movies/shows state, search language, and the start of the URL
// (truncated to fit).
function ReadRow({
  row,
  languageLabel,
  onEdit,
  onDelete,
  disabled,
}: {
  row: DownloadSource;
  languageLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  // Structure mirrors EditRow exactly (li > div.grid) so the top line has identical geometry in both states and the
  // label + pills stay at the same x AND y when editing.
  return (
    <li
      style={{ paddingTop: ROW_PAD_Y, paddingBottom: ROW_PAD_Y }}
      className="rounded-md border-b border-[#1c1c22] px-2 hover:bg-[rgba(255,255,255,0.025)]"
    >
      <div style={ROW_GRID_STYLE}>
        <span className="truncate text-sm font-semibold">{sourceLabel(row)}</span>
        <span className="truncate text-xs text-[var(--color-muted)]">{languageLabel}</span>
        <span className="flex items-center gap-1.5">
          <StatePill active={row.movies} label="Movies" />
          <StatePill active={row.shows} label="Shows" />
        </span>
        <code className="min-w-0 truncate font-mono text-xs text-[var(--color-faint)]" title={row.template}>
          {row.template}
        </code>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            title="Edit"
            aria-label="Edit source"
            className="rounded-md p-1.5 text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            <PenIcon />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            title="Delete"
            aria-label="Delete source"
            className="rounded-md p-1.5 text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-behind)] disabled:opacity-40"
          >
            <XIcon />
          </button>
        </div>
      </div>
    </li>
  );
}

// A Movies/Shows scope pill (design reference): accent-tinted when the source targets that card kind, muted when
// not. Static in the read-only row; pass `onClick` to make it a toggle in the edit form.
function StatePill({ active, label, onClick }: { active: boolean; label: string; onClick?: () => void }) {
  const className = "rounded-[5px] px-2 py-0.5 text-[11px] font-semibold";
  const style = active
    ? { color: "#b9c4ff", background: "rgba(125,149,255,0.14)" }
    : { color: "#3a3a44", background: "transparent" };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} cursor-pointer`} style={style} aria-pressed={active}>
        {label}
      </button>
    );
  }
  return (
    <span className={className} style={style}>
      {label}
    </span>
  );
}

// The season-marker field: its name, then the pattern itself in mono (it's a format string, like the URL template
// below it).
function SeasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs text-[var(--color-muted)]">Season format</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_SEASON_PATTERN}
        spellCheck={false}
        style={{ padding: LABEL_INPUT_PADDING, width: 92 }}
        className={`${FIELD_CLASS} font-mono text-xs`}
      />
    </label>
  );
}

// Inline stroke icons (matching the project's SVG style) for the read-only row's Edit/Delete actions.
function PenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

// The language select's drop-down arrow. Ours because the select is `appearance: none` (see its comment) — that
// switch takes the native arrow with it. Non-interactive: clicks fall through to the select underneath.
function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <path d="M21 3 3 21M3 3l18 18" />
    </svg>
  );
}

// The add/edit form for a single source.
function EditRow({
  draft,
  languages,
  patch,
  onSave,
  onCancel,
  pending,
}: {
  draft: DownloadSource;
  languages: LanguageOption[];
  patch: (p: Partial<DownloadSource>) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    // The highlight box widens outward while its padding pulls the inner content back to the read rows' left edge,
    // so the top line lines up with the read rows above/below. Inline styles → immune to stale CSS rebuilds. py-2
    // matches the read rows' vertical padding so the top line starts at the same y.
    <li style={EDIT_BOX_STYLE}>
      {/* Top line — same grid + min-height as the read row, so the label + pills don't move (x or y) when editing. */}
      <div style={ROW_GRID_STYLE}>
        <input
          type="text"
          value={draft.label}
          onChange={(e) => patch({ label: e.target.value })}
          placeholder="Label"
          // Compact padding (reference) + a left pull by its own padding+border so its TEXT lands exactly on the
          // read label's position.
          style={{ padding: LABEL_INPUT_PADDING, marginLeft: -INPUT_PULL_X }}
          className={`${FIELD_CLASS} w-full text-sm font-semibold`}
          aria-label="Source label"
        />
        {/* Which language's title the search runs on: the native title when the item is in this language, else the
            English one. A stored code that isn't in the list is kept as an extra option so editing can't drop it.
            The same left pull as the label input, for the same reason — but a themed select ALSO carries 4px of
            Chromium-internal inline-start padding on top of the author's (LayoutThemeDefault::PopupInternalPadding-
            Start), which no negative margin can account for. `appearance: none` zeroes it, so the text sits at
            exactly border+padding and lines up with the read row's plain label; the arrow is then ours to draw. */}
        <span className="relative block" style={{ marginLeft: -INPUT_PULL_X }}>
          <select
            value={draft.language}
            onChange={(e) => patch({ language: e.target.value })}
            style={{ padding: `4px ${SELECT_ARROW_ROOM}px 4px 8px` }}
            className={`${FIELD_CLASS} w-full appearance-none text-xs`}
            aria-label="Search title language"
          >
            {!languages.some((l) => l.code === draft.language) && (
              <option value={draft.language}>{draft.language}</option>
            )}
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <ChevronIcon />
        </span>
        <span className="flex items-center gap-1.5">
          <StatePill active={draft.movies} label="Movies" onClick={() => patch({ movies: !draft.movies })} />
          <StatePill active={draft.shows} label="Shows" onClick={() => patch({ shows: !draft.shows })} />
        </span>
        {/* The season marker shares the top line, in the column the read row gives the URL. Only for a source that
            targets shows — it's how THAT tracker indexes seasons, so it applies to every show on it whichever
            title the query used. */}
        <span className="flex items-center">
          {draft.shows && (
            <SeasonField value={draft.seasonPattern} onChange={(seasonPattern) => patch({ seasonPattern })} />
          )}
        </span>
        <span />
      </div>
      <textarea
        value={draft.template}
        onChange={(e) => patch({ template: e.target.value })}
        placeholder="https://example.com/search?nm={query}"
        spellCheck={false}
        rows={5}
        // Explicit width that overhangs the content box by INPUT_PULL_X on each side, then a left pull of the same
        // amount — so the textarea's left edge lines up with the label input and its right edge leaves the SAME gap
        // to the box as the left (symmetric). `w-full` alone would only reach the content edge → uneven right gap.
        style={{ width: `calc(100% + ${2 * INPUT_PULL_X}px)`, marginLeft: -INPUT_PULL_X }}
        className={`${FIELD_CLASS} mt-2.5 resize-y font-mono text-xs leading-relaxed`}
        aria-label="Source URL template"
      />
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="wn-btn font-display disabled:opacity-50"
          style={{ background: "transparent", borderColor: "#34343e", color: "var(--color-muted)" }}
        >
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={pending || !draft.template.trim()} className={ACTION_BUTTON_CLASS}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}
