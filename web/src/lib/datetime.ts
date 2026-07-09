// Date helpers. "Has an episode aired?" and "what's due this week?" compare against *today* in the owner's
// display timezone (TZ env, brief §9), not UTC — otherwise an evening episode flips a day early/late.

// Today's date as "YYYY-MM-DD" in the given timezone (defaults to the TZ env var, else the system zone).
export function todayISO(now: Date = new Date(), timeZone: string | undefined = process.env.TZ): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      now,
    );
  } catch {
    // Invalid TZ → fall back to the system zone.
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

// Date N days from `from`, as "YYYY-MM-DD" in the given timezone. Used for the "next 2 weeks" upcoming window.
export function isoDatePlusDays(days: number, from: Date = new Date(), timeZone?: string): string {
  const shifted = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return todayISO(shifted, timeZone);
}
