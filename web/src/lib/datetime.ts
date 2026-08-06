// Date helpers. One display timezone (TZ env, brief §9) governs all three directions, and they must agree or a
// date shifts by a day: "has it aired?" / "what's due this week?" compare against *today* there rather than in UTC
// (else an evening episode flips a day early/late); every watched stamp is FORMATTED there; and a calendar date
// picked in the UI is ANCHORED to an instant there by parseWatchDate before it's stored.

// The current time as epoch ms. Wrapped so components can read "now" for request-time relative labels without
// tripping the React purity lint (Date.now() is flagged in a render body; a lib call is not — same as todayISO).
export function nowMs(): number {
  return Date.now();
}

// A timezone Intl will accept: the given one, or undefined (the system zone) when it's invalid. Every formatter
// below routes its timeZone through this, so none of them needs a try/catch that repeats its whole options object
// in the fallback — two copies of one options literal is exactly the pair that drifts when only one is edited.
// Results are memoized because the callers construct a DateTimeFormat per call already, and the set of distinct
// zones asked for is effectively one (the TZ env var).
const zoneCache = new Map<string | undefined, string | undefined>();
function safeZone(timeZone: string | undefined): string | undefined {
  if (zoneCache.has(timeZone)) return zoneCache.get(timeZone);
  let resolved: string | undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    resolved = timeZone;
  } catch {
    resolved = undefined; // invalid TZ → the system zone
  }
  zoneCache.set(timeZone, resolved);
  return resolved;
}

// A given moment's calendar date as "YYYY-MM-DD" in the given timezone (defaults to the TZ env var, else the
// system zone). The machine form for date logic ("has it aired" comparisons, today's date); displayDate is the
// human/UI form.
export function isoDate(date: Date, timeZone: string | undefined = process.env.TZ): string {
  // en-CA formats as YYYY-MM-DD.
  const opts = { timeZone: safeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" } as const;
  return new Intl.DateTimeFormat("en-CA", opts).format(date);
}

// A moment's calendar date in a human, UI-facing form: "Jun 2, 2026" (in the given timezone, default TZ env).
// The single source for rendering watch dates across the app; isoDate stays the machine form for date logic.
export function displayDate(date: Date, timeZone: string | undefined = process.env.TZ): string {
  const opts = { timeZone: safeZone(timeZone), year: "numeric", month: "short", day: "numeric" } as const;
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

// Today's date as "YYYY-MM-DD" in the given timezone (defaults to the TZ env var, else the system zone).
export function todayISO(now: Date = new Date(), timeZone: string | undefined = process.env.TZ): string {
  return isoDate(now, timeZone);
}

// A moment's month and year: "Jun 2026" (in the given timezone, default TZ env). For compact date stamps where
// the day would be noise — e.g. the movie detail poster's "WATCHED · JUN 2026".
export function displayMonthYear(date: Date, timeZone: string | undefined = process.env.TZ): string {
  const opts = { timeZone: safeZone(timeZone), month: "short", year: "numeric" } as const;
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A plain "YYYY-MM-DD" calendar date as "Mon YYYY" ("2026-07-15" → "Jul 2026"). PURE string transform — no Date,
// no timezone: release dates are calendar dates, not moments, so parsing them through a Date would risk a TZ
// day-shift. Returns the input unchanged when it isn't an ISO date. Used for episode "airs Mon YYYY" labels.
export function monthYearISO(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTH_ABBR[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

// A plain "YYYY-MM-DD" calendar date as a human "Mon D, YYYY" ("2026-07-15" → "Jul 15, 2026"). PURE string
// transform — no Date, no timezone (same rationale as monthYearISO): a stored watch date shouldn't be re-parsed
// through a Date and risk a TZ day-shift. Returns the input unchanged when it isn't an ISO date. Used for the
// watched stamps' hover tooltip, which reveals the exact day the compact "Mon YYYY" label hides.
export function displayDateISO(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTH_ABBR[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

// A watch date from the client (a date picker's "YYYY-MM-DD", or any Date-parseable string) as the instant to
// store, or null when absent/invalid — callers fall back to `new Date()`. A DATE-ONLY string is anchored at NOON
// in the display timezone: `new Date("2026-08-06")` parses as UTC midnight per spec, which in any negative UTC
// offset is the *previous* local day, so the picked date would render a day early. Noon rather than midnight
// because some zones skip 00:00 on a DST-transition day. Strings that already carry a time pass through as-is —
// media-server imports (Plex epochs, Jellyfin ISO timestamps) are true instants and must not be re-anchored.
export function parseWatchDate(iso: string | undefined, timeZone: string | undefined = process.env.TZ): Date | null {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T${noonOffset(iso, timeZone)}`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The "12:00:00±HH:MM" suffix that pins a calendar date to local noon in `timeZone`. Built explicitly rather than
// relying on `new Date("…T12:00:00")`'s local-time parsing, which follows the *process* zone — that matches TZ
// today, but silently diverges the moment a caller passes an explicit zone (and under vitest, which pins its own).
function noonOffset(isoDay: string, timeZone: string | undefined): string {
  const minutes = tzOffsetMinutes(new Date(`${isoDay}T12:00:00Z`), safeZone(timeZone));
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `12:00:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

// A zone's UTC offset in minutes at a given moment, via the parts of an en-CA format (no Date-arithmetic guesswork).
function tzOffsetMinutes(at: Date, timeZone: string | undefined): number {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const n = (part: string): number => Number(p[part]);
  const asUTC = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUTC - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

// Date N days from `from`, as "YYYY-MM-DD" in the given timezone. Used for the "next 2 weeks" upcoming window.
export function isoDatePlusDays(days: number, from: Date = new Date(), timeZone?: string): string {
  const shifted = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return todayISO(shifted, timeZone);
}
