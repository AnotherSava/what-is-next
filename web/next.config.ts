import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) for the production Docker image — runs `node server.js`
  // with only the traced runtime files. better-sqlite3 is externalized by default, so its native binary is
  // traced into the standalone output.
  output: "standalone",
  images: {
    // Posters/backdrops are hotlinked from TMDB by path (brief §4); we store paths, never URLs. TMDB already
    // serves the requested size (w342, w500, …), so we skip Next's optimizer (unoptimized) — that also means no
    // `sharp` dependency. A local poster-cache job is backlog (§10) — switching to it won't touch the schema.
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org", pathname: "/t/p/**" }],
  },
};

export default nextConfig;
