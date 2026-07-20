import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/app/_components/BackLink";
import { MovieHeroMenu } from "@/app/movies/_components/MovieHeroActions";
import { MovieHeroPoster } from "@/app/movies/_components/MovieHeroPoster";
import { displayMonthYear, todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { downloadLinksFor } from "@/lib/downloadSources";
import { formatRuntime } from "@/lib/format";
import { posterUrl } from "@/lib/images";
import { getMovieDetail } from "@/lib/movies";
import { formatAudio, formatResolution, formatSubtitles, isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getDownloadSources, getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = await getPrisma().mediaItem.findFirst({
    where: { mediaType: "movie", OR: [{ slug }, { id: slug }] },
    select: { title: true },
  });
  return { title: item?.title ?? "Movie" };
}

export default async function MovieDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [movie, manualWatched, plexServerId, sources] = await Promise.all([
    getMovieDetail(displayedUser.id, slug),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
    getDownloadSources(),
  ]);
  if (!movie) notFound();
  // Canonicalise: an id-based (or otherwise non-slug) URL 308-redirects to /movies/<slug> once a slug exists.
  if (movie.slug && movie.slug !== slug) redirect(`/movies/${movie.slug}`);

  const year = movie.releaseDate ? movie.releaseDate.slice(0, 4) : "";
  const meta = [year, formatRuntime(movie.runtime)].filter(Boolean).join(" · ");
  const watchUrl = movie.inPlex ? plexWatchUrl(plexServerId, movie.plexRatingKey) : null;
  const stars = movie.cast.slice(0, 3).map((c) => c.name).join(" · ");
  const topCast = movie.cast.slice(0, 8);
  const watchedStamp = movie.watched
    ? `WATCHED${movie.watchedAt ? ` · ${displayMonthYear(movie.watchedAt).toUpperCase()}` : ""}`
    : null;
  const downloadLinks = downloadLinksFor(sources, "movies", movie.title);

  // Plex source spec rows (in-Plex movies only): resolution + HDR, audio-track languages, subtitle languages.
  const video = [formatResolution(movie.videoResolution), movie.hdrFormat].filter(Boolean).join(" ");
  const audio = formatAudio(movie.audioTracks);
  const subtitles = formatSubtitles(movie.subtitleLangs);
  const hasSource = movie.inPlex && (video || audio.text || subtitles.text);

  const canMarkWatched = canEdit && manualWatched;
  // The ⋯ menu only appears when it would have an item: watched → "Mark unwatched"; unwatched → "Mark watched"
  // (if enabled) and/or "Remove from tracking" (if tracked).
  const showMenu = canEdit && (movie.watched ? canMarkWatched : canMarkWatched || movie.tracked);

  return (
    <div>
      <BackLink
        fallbackHref="/movies"
        className="mb-[18px] inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      />

      <div className="relative">
        {showMenu && (
          <div className="absolute top-0 right-0 z-[6]">
            <MovieHeroMenu movieId={movie.id} watched={movie.watched} tracked={movie.tracked} canMarkWatched={canMarkWatched} today={todayISO()} />
          </div>
        )}

        <div className="flex flex-col gap-8 pt-2 md:min-h-[372px] md:flex-row md:items-start md:gap-[34px]">
          <MovieHeroPoster
            movieId={movie.id}
            title={movie.title}
            posterPath={movie.posterPath}
            inPlex={movie.inPlex}
            watchUrl={watchUrl}
            downloadLinks={downloadLinks}
            rating={movie.imdbRating}
            isFavorite={movie.isFavorite}
            canFavorite={canEdit}
            watchedStamp={watchedStamp}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="font-display text-[28px] leading-[1.03] font-bold tracking-[-0.02em] text-balance md:text-[40px]">{movie.title}</h1>
            {movie.originalTitle && movie.originalTitle !== movie.title && (
              <p className="font-narrow mt-1.5 text-[14px] text-[var(--color-muted)]">{movie.originalTitle}</p>
            )}
            {meta && <div className="font-num mt-3.5 text-[14px] tabular-nums text-[var(--color-muted)]">{meta}</div>}

            {(movie.director || stars || hasSource) && (
              <div className="mt-[18px] flex max-w-[600px] flex-col gap-2">
                {movie.director && <SpecRow label="Director" value={movie.director} />}
                {stars && <SpecRow label="Stars" value={stars} />}
                {hasSource && (
                  <>
                    {(movie.director || stars) && <div className="my-[5px] h-px bg-[#1c1c22]" />}
                    {video && <SpecRow label="Video" value={video} muted />}
                    {audio.text && <SpecRow label="Audio" value={audio.text} more={audio.more} muted />}
                    {subtitles.text && <SpecRow label="Subtitles" value={subtitles.text} more={subtitles.more} muted />}
                  </>
                )}
              </div>
            )}

            {movie.overview && <p className="mt-5 max-w-[600px] text-[14px] leading-[1.6] text-[var(--color-bright)] text-pretty">{movie.overview}</p>}
          </div>
        </div>
      </div>

      {topCast.length > 0 && (
        <section className="mt-[34px]">
          <h2 className="font-display mb-[18px] text-[18px] font-bold">Top cast</h2>
          <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {topCast.map((c, i) => {
              const photo = posterUrl(c.profilePath, "w185");
              return (
                <div key={`${c.name}-${i}`} className="flex min-w-0 items-center gap-4">
                  {photo ? (
                    <Image src={photo} alt={c.name} width={72} height={72} className="h-[72px] w-[72px] shrink-0 rounded-full border object-cover" style={{ borderColor: "var(--color-border-elevated)" }} />
                  ) : (
                    <span
                      className="font-display flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full border bg-[var(--color-surface-2)] text-[16px] font-semibold text-[var(--color-muted)]"
                      style={{ borderColor: "var(--color-border-elevated)" }}
                      aria-hidden
                    >
                      {initials(c.name)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="font-display text-[15.5px] leading-[1.25] font-semibold text-pretty">{c.name}</div>
                    {c.character && <div className="font-narrow mt-[3px] truncate text-[14px] text-[var(--color-muted)]">{c.character}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// A label/value row in the hero's identity block (design 2a/2b/2c): a fixed-width faint label + a wider value.
// `muted` dims the value (the Video/Audio/Subtitles source rows); `more` appends a dim "+N more" overflow tail.
function SpecRow({ label, value, more = 0, muted = false }: { label: string; value: string; more?: number; muted?: boolean }) {
  return (
    <div className="flex items-baseline gap-3.5">
      <span className="font-num w-[74px] shrink-0 text-[12px] tracking-[0.02em] text-[var(--color-faint)]">{label}</span>
      <span className={`font-narrow min-w-0 flex-1 ${muted ? "text-[14px] text-[#9a9aa4]" : "text-[15px] text-[#d3d3da]"}`}>
        {value}
        {more > 0 && <span className="text-[#6f6f78]">{value ? " · " : ""}+{more} more</span>}
      </span>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
