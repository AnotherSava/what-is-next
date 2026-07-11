import { Poster } from "./Poster";

// A poster that acts as a single "watch in Plex" play button. When `watchUrl` is set, the ENTIRE poster is the
// click target: hovering (or focusing) zooms the artwork, dims it evenly, and reveals a large centred play
// triangle, then opens the item in the Plex web app. With no `watchUrl` it's a plain, inert poster.
// (Design: docs "Interactive play button design v2" — Option 1e/2c, zoom + big triangle on a dark scrim.)
export function PosterPlay({
  path,
  alt,
  width,
  height,
  size,
  watchUrl,
  className = "",
}: {
  path: string | null | undefined;
  alt: string;
  width: number;
  height: number;
  size?: string;
  watchUrl?: string | null;
  className?: string;
}) {
  // No stream link → plain poster, unchanged.
  if (!watchUrl) {
    return (
      <div className={`relative shrink-0 leading-none ${className}`} style={{ width, height }}>
        <Poster path={path} alt={alt} width={width} height={height} size={size} className="block" />
      </div>
    );
  }

  return (
    <a
      href={watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Play ${alt} in Plex`}
      aria-label={`Play ${alt} in Plex`}
      className={`group relative block shrink-0 overflow-hidden rounded-lg leading-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] ${className}`}
      style={{ width, height }}
    >
      {/* 1 · artwork zoom (overflow-hidden on the anchor crops the scaled image to the rounded corners) */}
      <Poster
        path={path}
        alt={alt}
        width={width}
        height={height}
        size={size}
        className="block h-full w-full transition-transform duration-200 ease-out group-hover:scale-[1.09] group-focus-visible:scale-[1.09] motion-reduce:transform-none motion-reduce:transition-none"
      />

      {/* 2 · even dark scrim — flat dim so the big white triangle has contrast on ANY poster */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-lg bg-black/50 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
      />

      {/* 3 · big play triangle — the viewBox is tightened to the triangle's exact bounds (x 8.5→19, y 5.94→18.06)
             so w-[…] maps directly to the triangle's rendered width and it stays truly centred (no blank margins).
             w-[30%] = a triangle 30% of the poster's width; scales with the poster; strong shadow for separation. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <svg
          viewBox="8.5 5.94 10.5 12.12"
          fill="#fff"
          focusable="false"
          className="w-[30%] scale-90 opacity-0 drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)] transition duration-200 ease-out group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          <path d="M19 12 8.5 18.06 8.5 5.94Z" />
        </svg>
      </span>
    </a>
  );
}
