// A label/value row in a detail page's hero identity block (the Director / Stars / Creator lines): a fixed-width
// faint label + a wider Archivo Narrow value. Shared by the movie and show detail pages and their non-library
// previews so the four can't drift (single source of logic). `muted` dims the value (the movie hero's Plex source
// rows); `more` appends a dim "+N more" overflow tail.
export function HeroSpecRow({
  label,
  value,
  more = 0,
  muted = false,
}: {
  label: string;
  value: string;
  more?: number;
  muted?: boolean;
}) {
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
