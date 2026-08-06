"use server";

import { revalidatePath } from "next/cache";
import { runBackup } from "@/lib/backup";
import { cleanDownloadSources, type DownloadSource } from "@/lib/downloadSources";
import {
  addLibraryItems,
  buildScanner,
  fetchConnectionOptions,
  getMediaServer,
  isUsable,
  MEDIA_PROVIDERS,
  PROVIDER_LABEL,
  setMediaServer,
  syncMediaServers,
  syncProvider,
  type ConnectionOptions,
  type MediaProvider,
  type MediaServerConfig,
} from "@/lib/media";
import { refreshOne } from "@/lib/refresh";
import { requireOwner } from "@/lib/session";
import { getSetting, setSetting, SYNC_KEYS } from "@/lib/settings";

// Admin operations (brief §7, §8.7). Owner-gated (role "owner", re-checked server-side). Refresh/backup touch
// only catalog + bookkeeping, never user state. The manual full refresh streams from /api/admin/refresh (for the
// progress bar); per-show refresh and backup stay plain server actions here.

export async function backupNow(): Promise<void> {
  await requireOwner();
  await runBackup();
  revalidatePath("/admin");
}

export async function refreshShow(mediaItemId: string): Promise<void> {
  await requireOwner();
  await refreshOne(mediaItemId);
  revalidatePath("/shows/[slug]", "page"); // detail lives at /shows/<slug> now — revalidate the dynamic route
  revalidatePath("/shows");
  revalidatePath("/");
}

// Toggle whether the manual "mark watched" controls are shown across the app.
export async function setManualWatched(enabled: boolean): Promise<void> {
  await requireOwner();
  await setSetting("settings:manualWatched", { enabled });
  // Every surface that renders watched controls re-reads the flag.
  for (const p of ["/admin", "/", "/shows", "/movies"]) revalidatePath(p);
}

// Toggle whether a still-airing season is held back until every episode has aired before a show counts as Behind
// or appears in the Download view.
export async function setWaitForFullSeason(enabled: boolean): Promise<void> {
  await requireOwner();
  await setSetting("settings:waitForFullSeason", { enabled });
  // The grouping (Behind), the home dashboard, the Download view, and the show detail page all re-derive from it.
  for (const p of ["/admin", "/", "/shows", "/download"]) revalidatePath(p);
  revalidatePath("/shows/[slug]", "page");
}

// Replace the Download view's list of download-source links. Stored in the DB, not the repo, so the sources stay
// out of version control. Blank rows (no template) are dropped and text is trimmed; the Download page re-reads the
// list to render each card's chips.
export async function setDownloadSources(sources: DownloadSource[]): Promise<void> {
  await requireOwner();
  await setSetting("settings:downloadSources", { sources: cleanDownloadSources(sources) });
  revalidatePath("/admin");
  revalidatePath("/download");
}

// ── Media servers (Plex + Jellyfin) ────────────────────────────────────────
// Owner-gated. Scanning updates presence badges + refreshes the review/unmatched lists; adding hydrates the
// selected library-only titles into tracking. Both re-verify the owner session.
function revalidateMedia(): void {
  for (const p of ["/admin", "/shows", "/movies", "/download", "/"]) revalidatePath(p);
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// What the connection form submits. A BLANK token means "keep the stored one" — the form never round-trips the
// secret just to save an unrelated field (see revealMediaServerToken).
export interface MediaServerForm {
  enabled: boolean;
  url: string;
  token: string;
  libraries: string;
  user: string;
}

// The stored address comes back with the result: the server normalizes what was typed (a bare host gains a scheme
// and port), and the form shows that rather than leaving the raw input on screen as if it were what's saved.
export type SaveResult = { url: string } & ActionResult;

export async function saveMediaServer(provider: MediaProvider, form: MediaServerForm): Promise<SaveResult> {
  await requireOwner();
  const current = await getMediaServer(provider);
  const next: MediaServerConfig = {
    enabled: form.enabled,
    url: form.url,
    token: form.token.trim() || current.token, // blank = unchanged
    libraries: form.libraries,
    user: form.user,
  };
  await setMediaServer(provider, next);
  revalidateMedia();

  // Storing always succeeds; the connection check is advisory, so a typo is reported without losing the input.
  const saved = await getMediaServer(provider);
  const url = saved.url;
  if (!saved.enabled) return { ok: true, url };
  if (!isUsable(saved))
    return { ok: false, url, error: `Enter the server URL and ${tokenLabel(provider)} to connect.` };
  try {
    await buildScanner(provider, saved).getServerId();
    return { ok: true, url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : `${PROVIDER_LABEL[provider]} did not respond.`;
    return { ok: false, url, error: `Saved, but ${PROVIDER_LABEL[provider]} didn't answer: ${hint(msg, provider)}` };
  }
}

// What the connected server offers the form's pickers: its real library names, and (Jellyfin) its accounts. A
// failure isn't an error state — the form just keeps its plain text inputs, so the connection stays editable even
// when the server is unreachable, which is exactly when you might need to fix its address.
export async function loadConnectionOptions(provider: MediaProvider): Promise<ConnectionOptions | null> {
  await requireOwner();
  const config = await getMediaServer(provider);
  if (!isUsable(config)) return null;
  try {
    return await fetchConnectionOptions(provider, config);
  } catch {
    return null;
  }
}

// Hand the stored token back for the form's "show" control. Deliberately a separate, owner-gated call rather than
// a value rendered into the page: the secret then only crosses the wire when the owner explicitly asks to see it,
// instead of sitting in every admin-page payload.
export async function revealMediaServerToken(provider: MediaProvider): Promise<string> {
  await requireOwner();
  return (await getMediaServer(provider)).token;
}

// A failing call (bad/expired token, server unreachable) must not crash the admin page — catch it and hand the
// reason back to the button to show inline. On success the route is revalidated, so the card's "Synced <when>"
// result re-renders itself from the stored last-sync bookkeeping.
export async function syncMediaServerNow(provider: MediaProvider): Promise<ActionResult> {
  const owner = await requireOwner();
  // Routed through syncMediaServers (rather than syncProvider directly) so a success also clears this provider's
  // automatic-sync failure backoff — otherwise fixing a token here would leave background syncs paused for it.
  const { failures } = await syncMediaServers(owner.id, "manual", [provider]);
  if (failures.length > 0) return { ok: false, error: hint(failures[0].error, provider) };
  revalidateMedia();
  return { ok: true };
}

function tokenLabel(provider: MediaProvider): string {
  return provider === "plex" ? "token" : "API key";
}

// Add the one actionable hint we can infer: an auth rejection almost always means a stale token.
function hint(message: string, provider: MediaProvider): string {
  const stale = /\b40[13]\b/.test(message) ? ` — check that the ${tokenLabel(provider)} is valid and current.` : "";
  return message + stale;
}

// Adopt the reviewed library-only titles into tracking. The provider travels with the form because both servers
// can surface candidates and their item keys live in different spaces.
export async function addSelectedLibraryItems(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const provider = String(formData.get("provider") ?? "");
  if (!isProvider(provider)) return;
  const selected = new Set(formData.getAll("itemKey").map(String));
  if (selected.size === 0) return;
  const stored = await getSetting(SYNC_KEYS[provider].candidates);
  if (!stored) return;
  const toAdd = stored.items.filter((c) => selected.has(c.itemKey));
  if (toAdd.length > 0) await addLibraryItems(owner.id, provider, toAdd);
  // Re-scan so presence + the review/unmatched lists reflect the newly added items (which now match and drop off).
  await syncProvider(owner.id, provider, "manual");
  revalidateMedia();
}

function isProvider(value: string): value is MediaProvider {
  return (MEDIA_PROVIDERS as readonly string[]).includes(value);
}
