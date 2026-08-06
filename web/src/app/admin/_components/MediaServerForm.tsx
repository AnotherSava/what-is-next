"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatLibraryList, parseLibraryList, type ConnectionOptions } from "@/lib/media/options";
import type { MediaProvider } from "@/lib/media/types";
import {
  loadConnectionOptions,
  revealMediaServerToken,
  saveMediaServer,
  type MediaServerForm as FormValues,
} from "../actions";

// Owner editor for one media-server connection (Plex or Jellyfin): an enable switch plus the address, the secret,
// an optional library allowlist, and — for Jellyfin — which account's watch state to read.
//
// There's no Save button: the switch saves the moment it's flipped, and each field saves when you leave it (blur,
// or Enter). Blur rather than keystroke on purpose — the server both normalizes what you type (a bare host becomes
// http://host:port) and pings it to confirm, neither of which should happen against a half-typed address. A save
// that wouldn't change anything is skipped, so tabbing through the fields costs nothing.
//
// A successful save shows as a tick beside the switch rather than a line of prose; a FAILED one keeps its full text
// below the fields, because that text is what tells you which thing to fix.
//
// The secret is never rendered into the page. When one is stored the field shows a masked placeholder and staying
// empty means "keep it"; "Show" fetches the real value through an owner-gated action, so the token only crosses
// the wire when the owner asks to see it.
//
// Libraries and the Jellyfin account are picked from what the server actually reports, not typed. Free text made
// a typo silently destructive: a misspelled library matches nothing, so the sync finds no libraries and wipes the
// presence rows it thinks are gone. If the server can't be reached the pickers fall back to plain text inputs, so
// a wrong address is still fixable — which is precisely when it can't be reached.
//
// The fields carry no help text or tooltips: every one is either named for exactly what it holds or picked from a
// list, so an explanation would only restate the label. The README covers what each connection setting means.

const FIELD_BASE =
  "min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed";
// Most controls are the flex child themselves; the token input is wrapped (so the reveal icon can sit inside its
// right edge), so there the wrapper takes the flex sizing and the input fills it.
const FIELD_CLASS = `${FIELD_BASE} flex-1`;
// Label beside its control rather than above it, in a fixed-width column — fixed so that every control in the form
// starts at the same x, which sizing to each label's own text would not do (they live in separate grid cells, so
// there's no shared column to size against).
const ROW_CLASS = "flex items-center gap-3";
const LABEL_CLASS = "w-[74px] shrink-0 text-[12px] font-medium text-[var(--color-muted)]";

export interface MediaServerFields {
  enabled: boolean;
  url: string;
  libraries: string;
  user: string;
  hasToken: boolean; // a secret is stored — the field can stay blank to keep it
}

export function MediaServerForm({
  provider,
  label,
  fields,
  urlPlaceholder,
}: {
  provider: MediaProvider;
  label: string; // "Plex" | "Jellyfin"
  fields: MediaServerFields;
  urlPlaceholder: string;
}) {
  const isPlex = provider === "plex";
  const tokenLabel = isPlex ? "Plex token" : "API key";
  const [enabled, setEnabled] = useState(fields.enabled);
  const [url, setUrl] = useState(fields.url);
  const [token, setToken] = useState("");
  const [libraries, setLibraries] = useState(fields.libraries);
  const [user, setUser] = useState(fields.user);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  // What the server reports it has. `undefined` = haven't asked yet, `null` = asked and it couldn't answer. The
  // three states are distinct on purpose: rendering the text fallback while the answer is still in flight would
  // flash an input that then turns into a picker.
  const [options, setOptions] = useState<ConnectionOptions | null | undefined>(undefined);

  // What the server already holds, so leaving a field untouched doesn't re-save (and re-ping) the same values.
  const saved = useRef(
    identity({ enabled: fields.enabled, url: fields.url, token: "", libraries: fields.libraries, user: fields.user }),
  );

  // Persist the form as it stands. `override` carries a value whose state update hasn't landed yet — the switch
  // saves in the same tick it's flipped.
  function persist(override: Partial<FormValues> = {}) {
    const values: FormValues = { enabled, url, token, libraries, user, ...override };
    if (identity(values) === saved.current) return;
    saved.current = identity(values);
    start(async () => {
      setStatus(null);
      const res = await saveMediaServer(provider, values);
      // Show the address as stored — the server completes a bare host with a scheme and port, and leaving the raw
      // input on screen would misrepresent what it will actually call.
      const stored: FormValues = { ...values, url: res.url, token: revealed ? values.token : "" };
      setUrl(stored.url);
      if (!revealed && values.token) setToken(""); // stored now — back to the "keep what's saved" resting state
      saved.current = identity(stored);
      if (res.ok) {
        setStatus({ ok: true, text: values.enabled ? `Connected to ${label}.` : "Saved." });
      } else {
        setStatus({ ok: false, text: res.error });
        // Let the owner retry by simply leaving the field again, rather than having to change something first.
        saved.current = "";
      }
    });
  }

  // "Show" pulls the stored secret into the field on demand; hiding again returns it to the untouched state so a
  // later save still means "keep the stored token" unless the owner actually edited it. Either way the saved
  // identity moves with it, so merely looking at the token doesn't count as an edit and re-save it on blur.
  const toggleReveal = () =>
    start(async () => {
      const next = revealed ? "" : await revealMediaServerToken(provider);
      setRevealed(!revealed);
      setToken(next);
      saved.current = identity({ enabled, url, token: next, libraries, user });
    });

  // Ask the server what it offers, on mount and after each save (a corrected address or token can be what makes
  // it reachable). Never throws: the action resolves to null when the server is unreachable or not yet connected.
  useEffect(() => {
    if (!enabled) return; // a server that's off isn't asked; `shown` below falls its fields back to plain inputs
    let cancelled = false;
    void loadConnectionOptions(provider).then((o) => {
      if (!cancelled) setOptions(o);
    });
    return () => {
      cancelled = true;
    };
    // `status` is in the deps so a save re-asks — its identity changes on every completed save.
  }, [provider, enabled, status]);

  // Enter commits a field the same way leaving it does, so the keyboard doesn't need the mouse to save.
  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  const field = (name: string) => `${provider}-${name}`;
  // Derived rather than stored: a switched-off server is never asked, so its fields show as plain (and disabled)
  // inputs without the effect having to write state to say so.
  const shown = enabled ? options : null;

  return (
    // A container so the fields below pair up based on how wide THIS form is, not the viewport — it renders
    // both full-width (stacked) and at half the card's width (side by side).
    <div className="@container">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={pending}
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            persist({ enabled: next });
          }}
          className="flex cursor-pointer items-center gap-[11px] text-sm disabled:opacity-50"
        >
          <span
            className="relative h-5 w-[34px] shrink-0 rounded-full transition-colors"
            style={{ background: enabled ? "var(--color-accent-strong)" : "var(--color-border)" }}
          >
            <span
              className="absolute top-[2px] h-4 w-4 rounded-full bg-white transition-[left]"
              style={{ left: enabled ? "16px" : "2px" }}
            />
          </span>
          <span>Sync with {label}</span>
        </button>
        <SaveMark pending={pending} status={status} />
      </div>

      {/* A fieldset so switching the server off disables every control inside it natively — including the reveal
          button — rather than each input having to remember to opt in. Tailwind's preflight resets button/input but
          NOT fieldset, so its default border, padding, margin and min-inline-size are cleared here or they'd box
          the fields. */}
      <fieldset
        disabled={!enabled}
        className="mx-0 mt-3 grid min-w-0 grid-cols-1 gap-3 border-0 p-0 transition-opacity disabled:opacity-45 @2xl:grid-cols-2"
      >
        <Field
          id={field("url")}
          label="Server URL"
          value={url}
          onChange={setUrl}
          onCommit={() => persist()}
          onKeyDown={commitOnEnter}
          placeholder={urlPlaceholder}
          type="url"
        />

        <div className={ROW_CLASS}>
          <label className={LABEL_CLASS} htmlFor={field("token")}>
            {tokenLabel}
          </label>
          <span className="relative flex flex-1 items-center">
            <input
              id={field("token")}
              type={revealed ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => persist()}
              onKeyDown={commitOnEnter}
              placeholder={fields.hasToken ? `Paste a new ${tokenLabel} to replace it` : `Paste your ${tokenLabel}`}
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD_BASE} w-full font-mono text-[12.5px] ${fields.hasToken ? "pr-9" : ""}`}
            />
            {/* Only offer to reveal what's actually there. The padding above keeps the value clear of the icon. */}
            {fields.hasToken && (
              <button
                type="button"
                onClick={toggleReveal}
                disabled={pending}
                title={revealed ? `Hide the ${tokenLabel}` : `Show the ${tokenLabel}`}
                aria-label={revealed ? `Hide the ${tokenLabel}` : `Show the ${tokenLabel}`}
                aria-pressed={revealed}
                className="wn-icobtn absolute right-[3px] flex items-center rounded-md p-1.5 disabled:opacity-50"
              >
                <EyeIcon off={revealed} />
              </button>
            )}
          </span>
          {/* Whether a secret is stored is STATE, so it's a badge — never placeholder text. The field renders empty
              (the token is never sent to the page), and grey text inside an input means "example" on every other
              field here; using it for "a value exists" made the two indistinguishable. */}
          {fields.hasToken && (
            <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
              saved
            </span>
          )}
        </div>

        {shown === undefined ? (
          <LoadingField label="Libraries" />
        ) : shown && shown.libraries.length > 0 ? (
          <LibraryPicker
            id={field("libraries")}
            libraries={shown.libraries.map((l) => l.name)}
            // Blank has always meant "every library", so an unconfigured server starts with everything ticked.
            selected={libraries.trim() ? parseLibraryList(libraries) : shown.libraries.map((l) => l.name)}
            onChange={(names) => {
              const next = formatLibraryList(names);
              setLibraries(next);
              persist({ libraries: next });
            }}
          />
        ) : (
          <Field
            id={field("libraries")}
            label="Libraries"
            value={libraries}
            onChange={setLibraries}
            onCommit={() => persist()}
            onKeyDown={commitOnEnter}
            placeholder="TV Shows, Movies"
          />
        )}

        {!isPlex &&
          (shown === undefined ? (
            <LoadingField label="Account" />
          ) : shown && shown.accounts.length > 0 ? (
            <AccountPicker
              id={field("user")}
              accounts={shown.accounts}
              value={user}
              onChange={(next) => {
                setUser(next);
                persist({ user: next });
              }}
            />
          ) : (
            <Field
              id={field("user")}
              label="Account"
              value={user}
              onChange={setUser}
              onCommit={() => persist()}
              onKeyDown={commitOnEnter}
              placeholder="Jellyfin username"
            />
          ))}
      </fieldset>

      {/* Only failures get prose. A rejected save names the thing to fix, which is too much to hide behind a hover
          or compress into an icon — and it can run to several lines, so it sits below rather than beside the switch. */}
      {status && !status.ok && <p className="mt-2 text-[12.5px] text-red-400">{status.text}</p>}
    </div>
  );
}

// The reveal control's icon: an open eye to show the value, a struck-through one while it's visible. Same
// stroked-line family as the console's other icons (the backup download, the error-list chevrons).
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="m14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <path d="m1 1 22 22" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

// A field's slot while the server is being asked what it offers — same height as the control that replaces it,
// so the form doesn't jump when the answer lands.
function LoadingField({ label }: { label: string }) {
  return (
    <div className={ROW_CLASS}>
      <span className={LABEL_CLASS}>{label}</span>
      <p className="py-1.5 text-sm text-[var(--color-faint)]">Reading from the server…</p>
    </div>
  );
}

// The libraries this server holds, as ticks. Selecting them by name from the server's own list means the stored
// allowlist can't contain a name that matches nothing, which is the failure free text allowed.
function LibraryPicker({
  id,
  libraries,
  selected,
  onChange,
}: {
  id: string;
  libraries: string[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  // Unticking the LAST library would store a blank allowlist, which means "sync everything" — the exact opposite
  // of what the boxes would be showing. Switching the server off is the control for "sync nothing", so the final
  // tick is held down instead of quietly inverting itself.
  const isLast = (name: string) => selected.length === 1 && selected[0] === name;

  const toggle = (name: string) => {
    if (isLast(name)) return;
    const on = new Set(selected);
    if (on.has(name)) on.delete(name);
    else on.add(name);
    // Emit in the server's own order, so the stored string doesn't churn with the order boxes were clicked in.
    onChange(libraries.filter((l) => on.has(l)));
  };
  return (
    <div className={ROW_CLASS}>
      <span className={LABEL_CLASS} id={`${id}-label`}>
        Libraries
      </span>
      <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1.5" role="group" aria-labelledby={`${id}-label`}>
        {libraries.map((name) => (
          <label
            key={name}
            className={`flex items-center gap-2 text-sm ${isLast(name) ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(name)}
              disabled={isLast(name)}
              onChange={() => toggle(name)}
              className="accent-[var(--color-accent-strong)]"
            />
            <span className={selected.includes(name) ? "" : "text-[var(--color-muted)]"}>{name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// The server's accounts, with how much each has watched — the thing that identifies which one is yours. Hidden and
// disabled accounts are left out, except the one already configured, so a saved choice can never silently vanish.
function AccountPicker({
  id,
  accounts,
  value,
  onChange,
}: {
  id: string;
  accounts: { name: string; hidden: boolean; movies: number; episodes: number }[];
  value: string;
  onChange: (name: string) => void;
}) {
  const shown = accounts.filter((a) => !a.hidden || a.name === value);
  return (
    <div className={ROW_CLASS}>
      <label className={LABEL_CLASS} htmlFor={id}>
        Account
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD_CLASS}>
        {!value && <option value="">Select an account…</option>}
        {shown.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name} — {a.movies} movies, {a.episodes} episodes watched
          </option>
        ))}
      </select>
    </div>
  );
}

// One labelled input.
function Field({
  id,
  label,
  value,
  onChange,
  onCommit,
  onKeyDown,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  type?: "text" | "url";
}) {
  return (
    <div className={ROW_CLASS}>
      <label className={LABEL_CLASS} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        className={FIELD_CLASS}
      />
    </div>
  );
}

// A stable string for "the values the server holds", used to skip a save that would change nothing.
function identity(v: FormValues): string {
  return JSON.stringify([v.enabled, v.url.trim(), v.token, v.libraries.trim(), v.user.trim()]);
}

// The outcome of the last save, beside the switch: a tick when it went through, a cross when it didn't (the reason
// itself is spelled out under the fields). Announced politely so it isn't only a visual cue.
function SaveMark({ pending, status }: { pending: boolean; status: { ok: boolean; text: string } | null }) {
  return (
    <span aria-live="polite" className="flex items-center">
      {pending ? (
        <span className="text-[11.5px] text-[var(--color-muted)]">Saving…</span>
      ) : status ? (
        <span
          title={status.text}
          className={`flex items-center ${status.ok ? "text-[var(--color-good)]" : "text-red-400"}`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {status.ok ? <polyline points="20 6 9 17 4 12" /> : <path d="M18 6 6 18M6 6l12 12" />}
          </svg>
          <span className="sr-only">{status.text}</span>
        </span>
      ) : null}
    </span>
  );
}
