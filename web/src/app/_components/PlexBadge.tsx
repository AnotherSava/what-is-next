// Compact "in Plex" presence dot (Plex integration), Plex brand gold (#e5a00d). Used per-season in the episode
// checklist to mark which seasons are in your Plex library. The "watch in Plex" play affordance lives on posters
// (see PosterPlay), not here.
export function PlexBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="In your Plex library"
      aria-label="In Plex"
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#e5a00d] ${className}`}
    />
  );
}
