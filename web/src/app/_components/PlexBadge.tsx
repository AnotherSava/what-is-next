// Small "in your Plex library" marker (Plex integration). Plex brand gold (#e5a00d). `dot` is a compact
// variant for per-season use; the default pill is for show cards/headers.
export function PlexBadge({ dot = false, className = "" }: { dot?: boolean; className?: string }) {
  if (dot) {
    return (
      <span
        title="In your Plex library"
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#e5a00d] ${className}`}
        aria-label="In Plex"
      />
    );
  }
  return (
    <span
      title="In your Plex library"
      className={`inline-flex items-center rounded bg-[#e5a00d] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black ${className}`}
    >
      Plex
    </span>
  );
}
