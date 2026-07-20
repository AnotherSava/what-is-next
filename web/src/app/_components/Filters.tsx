import type { ReactNode } from "react";

// Shared filter controls for the list views (design reference): the bordered search box that live-filters a grid,
// and the pill chips (status / type filters) above it. Presentational — the owning client view holds the state.

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex w-[250px] items-center gap-[9px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="var(--color-faint)" strokeWidth="1.7" aria-hidden>
        <circle cx="9" cy="9" r="6" />
        <path d="M17 17 l-4-4" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Esc clears the box (keeping focus, so you can keep typing).
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        className="w-full border-none bg-transparent text-[13px] text-[var(--color-text)] outline-none"
      />
    </div>
  );
}

// A filter chip: an optional colour dot, a label, and an optional count. `active` lights the pill (data-on drives
// the .wn-chip active styling in globals.css).
export function FilterChip({
  active,
  onClick,
  color,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  label: ReactNode;
  count?: number;
}) {
  return (
    <button type="button" className="wn-chip" data-on={active} onClick={onClick}>
      {color && <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: color }} />}
      {label}
      {count != null && <span className="opacity-60">{count}</span>}
    </button>
  );
}
