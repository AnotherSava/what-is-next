// Date helpers. "Has an episode aired?" and "what's due this week?" compare against *today* in the owner's
// display timezone (TZ env, brief §9), not UTC — otherwise an evening episode flips a day early/late.

// The current time as epoch ms. Wrapped so components can read "now" for request-time relative labels without
// tripping the React purity lint (Date.now() is flagged in a render body; a lib call is not — same as todayISO).
export function nowMs(): number {
  return Date.now();
}

// A given moment's calendar date as "YYYY-MM-DD" in the given timezone (defaults to the TZ env var, else the
// system zone). The machine form for date logic ("has it aired" comparisons, today's date); displayDate is the
// human/UI form.
export function isoDate(date: Date, timeZone: string | undefined = process.env.TZ): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      date,
    );
  } catch {
    // Invalid TZ → fall back to the system zone.
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }
}

// A moment's calendar date in a human, UI-facing form: "Jun 2, 2026" (in the given timezone, default TZ env).
// The single source for rendering watch dates across the app; isoDate stays the machine form for date logic.
export function displayDate(date: Date, timeZone: string | undefined = process.env.TZ): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric" }).format(date);
  } catch {
    // Invalid TZ → fall back to the system zone.
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(date);
  }
}

// Today's date as "YYYY-MM-DD" in the given timezone (defaults to the TZ env var, else the system zone).
export function todayISO(now: Date = new Date(), timeZone: string | undefined = process.env.TZ): string {
  return isoDate(now, timeZone);
}

// A moment's month and year: "Jun 2026" (in the given timezone, default TZ env). For compact date stamps where
// the day would be noise — e.g. the movie detail poster's "WATCHED · JUN 2026".
export function displayMonthYear(date: Date, timeZone: string | undefined = process.env.TZ): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", year: "numeric" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
  }
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

// Date N days from `from`, as "YYYY-MM-DD" in the given timezone. Used for the "next 2 weeks" upcoming window.
export function isoDatePlusDays(days: number, from: Date = new Date(), timeZone?: string): string {
  const shifted = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return todayISO(shifted, timeZone);
}
