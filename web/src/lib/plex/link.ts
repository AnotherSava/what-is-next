// Build a Plex web-app deep link to an item's details page (Plex integration). The app.plex.tv link routes to
// the user's own server via its machineIdentifier and opens the show/movie preplay page — where Plex's Play
// button honors the saved playback offset, i.e. it resumes a partly-watched episode/movie from your spot rather
// than restarting. The `#!/…?key=…` fragment is the Plex web app's own routing convention (same as its share
// links); `key` is the URL-encoded metadata path.
export function plexWebUrl(machineIdentifier: string, ratingKey: string): string {
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${encodeURIComponent(machineIdentifier)}/details?key=${key}`;
}

// Convenience for the common "I may or may not have both pieces" case: returns a watch URL only when the server
// id and the item's ratingKey are both known, else null (so the UI shows a plain badge instead of a link).
export function plexWatchUrl(machineIdentifier: string | null, ratingKey: string | null | undefined): string | null {
  if (!machineIdentifier || !ratingKey) return null;
  return plexWebUrl(machineIdentifier, ratingKey);
}
