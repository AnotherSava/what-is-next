"use client";

import { useState, useTransition } from "react";
import { cleanDownloadSources, type DownloadSource, sourceLabel } from "@/lib/downloadSources";
import { setDownloadSources } from "../actions";
import { ACTION_BUTTON_CLASS } from "./buttonStyle";

// Owner editor for the Download view's source links. Saved sources render as compact read-only rows (label,
// movies/shows state, the start of the URL) with Edit/Delete; adding or editing opens the row's form. Each save
// and delete persists the whole list via the server action, so there's no separate "unsaved changes" step. The
// templates hold the download-source URLs; they live only in the DB, never the repo.

const EMPTY: DownloadSource = { label: "", template: "", movies: true, shows: false };

const FIELD_CLASS =
  "min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]";

// The row currently open in the form: its slot (an existing index, or list length for a new row) plus a working
// copy so Cancel can discard it without touching the saved list.
type Editing = { index: number; draft: DownloadSource };

export function DownloadSourcesEditor({ sources }: { sources: DownloadSource[] }) {
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
                patch={patch}
                onSave={saveEditing}
                onCancel={() => setEditing(null)}
                pending={pending}
              />
            ) : (
              <ReadRow
                key={i}
                row={row}
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
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-2)]"
        >
          Add source
        </button>
      )}
    </div>
  );
}

// Compact summary of a saved source: label, movies/shows state, and the start of the URL (truncated to fit).
function ReadRow({
  row,
  onEdit,
  onDelete,
  disabled,
}: {
  row: DownloadSource;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-[var(--color-surface-2)]/40 px-3 py-2">
      <span className="font-medium">{sourceLabel(row)}</span>
      <span className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
        <ReadCheck checked={row.movies} label="Movies" />
        <ReadCheck checked={row.shows} label="Shows" />
      </span>
      <code
        className="min-w-0 flex-1 basis-48 truncate font-mono text-xs text-[var(--color-muted)]"
        title={row.template}
      >
        {row.template}
      </code>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          title="Edit"
          aria-label="Edit source"
          className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)] disabled:opacity-40"
        >
          <PenIcon />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          title="Delete"
          aria-label="Delete source"
          className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-behind)] disabled:opacity-40"
        >
          <XIcon />
        </button>
      </div>
    </li>
  );
}

// A non-interactive checkbox that just shows a source's movie/show selection in the read-only row.
function ReadCheck({ checked, label }: { checked: boolean; label: string }) {
  return (
    <label className="flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        disabled
        readOnly
        className="h-4 w-4 accent-[var(--color-accent-strong)]"
      />
      {label}
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
  patch,
  onSave,
  onCancel,
  pending,
}: {
  draft: DownloadSource;
  patch: (p: Partial<DownloadSource>) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <li className="space-y-2 rounded-md bg-[var(--color-surface-2)]/40 p-2">
      <textarea
        value={draft.template}
        onChange={(e) => patch({ template: e.target.value })}
        placeholder="https://example.com/search?nm={query}"
        spellCheck={false}
        rows={3}
        className={`${FIELD_CLASS} w-full resize-y font-mono text-xs leading-relaxed`}
        aria-label="Source URL template"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft.label}
          onChange={(e) => patch({ label: e.target.value })}
          placeholder="Label"
          className={`${FIELD_CLASS} w-28`}
          aria-label="Source label"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={draft.movies}
            onChange={(e) => patch({ movies: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-accent-strong)]"
          />
          Movies
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={draft.shows}
            onChange={(e) => patch({ shows: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-accent-strong)]"
          />
          Shows
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !draft.template.trim()}
            className={ACTION_BUTTON_CLASS}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </li>
  );
}
