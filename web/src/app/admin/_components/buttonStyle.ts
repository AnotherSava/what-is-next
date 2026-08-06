// Shared styling for the owner-console action buttons. Uses the design reference's soft-accent `.wn-btn` look
// (Space Grotesk, tinted fill) — see globals.css.

// Plain action buttons (e.g. "Add selected to tracking").
export const ACTION_BUTTON_CLASS = "wn-btn font-display disabled:pointer-events-none disabled:opacity-50";

// The job "run now" buttons (Refresh / Sync / Back up): larger, sitting in each job card's header beside the
// freshness badge, which is what carries the status colour. Pair with JOB_BUTTON_STYLE for the reference's 15px size.
export const JOB_BUTTON_CLASS =
  "wn-btn font-display inline-flex items-center disabled:pointer-events-none disabled:opacity-50";
export const JOB_BUTTON_STYLE: React.CSSProperties = { fontSize: 15, padding: "8px 14px" };
