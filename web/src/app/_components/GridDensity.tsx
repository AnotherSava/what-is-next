"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { clampCols, COLS_COOKIE, DEFAULT_COLS, MAX_COLS, MIN_COLS } from "@/lib/gridDensity";

// Poster-grid density (columns per row), shared by every grid via the --wn-cols CSS variable and driven by the
// slider in the nav. The chosen value is persisted in a cookie so the server renders the same column count on the
// next load (no flash): the layout reads the cookie and seeds `initialCols`, and the provider writes it back on
// change. Range mirrors the reference: 3–8 columns.

type Ctx = { cols: number; setCols: (n: number) => void };
const GridDensityContext = createContext<Ctx>({ cols: DEFAULT_COLS, setCols: () => {} });

export function useGridDensity(): Ctx {
  return useContext(GridDensityContext);
}

export function GridDensityProvider({ initialCols, children }: { initialCols: number; children: React.ReactNode }) {
  const [cols, setColsState] = useState(() => clampCols(initialCols));

  const setCols = useCallback((n: number) => setColsState(clampCols(n)), []);

  useEffect(() => {
    document.cookie = `${COLS_COOKIE}=${cols}; path=/; max-age=31536000; samesite=lax`;
  }, [cols]);

  return (
    <GridDensityContext.Provider value={{ cols, setCols }}>
      <div className="flex min-h-dvh flex-col" style={{ ["--wn-cols" as string]: String(cols) }}>
        {children}
      </div>
    </GridDensityContext.Provider>
  );
}

// The nav's density control: a grid icon that reveals a range slider on hover. Higher slider value → fewer, larger
// posters (value = MIN+MAX − cols), matching the reference's "zoom" feel.
export function GridDensitySlider() {
  const { cols, setCols } = useGridDensity();
  const sliderVal = MIN_COLS + MAX_COLS - cols;
  return (
    <span className="wn-zoom flex items-center gap-2">
      <span className="wn-zoom-panel flex items-center">
        <input
          type="range"
          min={MIN_COLS}
          max={MAX_COLS}
          value={sliderVal}
          onChange={(e) => setCols(MIN_COLS + MAX_COLS - Number(e.target.value))}
          aria-label="Poster grid density"
          className="w-[104px] cursor-pointer"
          style={{ accentColor: "var(--color-accent)" }}
        />
      </span>
      <svg
        className="wn-zoom-trigger"
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-faint)"
        strokeWidth="1.8"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    </span>
  );
}
