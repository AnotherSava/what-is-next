"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// One entry per rendered shelf on the Shows page. `count` is the *visible* item count (search narrows it), and
// `key` must match the `id="shows-group-<key>"` on the shelf so the selector can measure and jump to it.
export type WindowGroup = { key: string; label: string; count: number };

// Width of the closed window — a small port-hole onto the full strip of group names. The active group sits centred
// with its neighbours peeking in at the masked edges.
const WIN_W = 190;

// The sliding-window group selector (design reference "Shows Window Selector"). It lives in the site header via a
// portal into #wn-header-slot, so it's present only while the Shows page is mounted. All shelves render stacked on
// the page; this is navigation, not a filter:
//   • Scrolling the page pulls the strip left-to-right through the 190px window, keeping the current group centred
//     (continuous, tracking scroll position rather than snapping) — the header reads like a scrollbar made of names.
//   • Closed, it's frameless (design "accent underline"): no box — the current group is marked only by a 2px accent
//     rule riding under it.
//   • Hovering expands the window in place to the full list, with a highlight knob on the active group, for clicking.
//   • Clicking a group smooth-scrolls the page to that shelf.
// Paint is imperative (direct style writes on refs) so scroll stays at 60fps without re-rendering React on every
// frame; React only owns the static markup and re-runs the setup effect when the visible group set changes.
export function ShowsWindowSelector({ groups }: { groups: WindowGroup[] }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const winRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const stripRef = useRef<HTMLSpanElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const ruleRef = useRef<HTMLSpanElement>(null); // the 2px accent underline under the current group (closed state)
  const posRef = useRef(0); // fractional group index the strip is centred on (0 = first shelf, tracks scroll)
  const openRef = useRef(false);

  // The portal target is server-rendered in SiteHeader; grab it once after hydration.
  useEffect(() => {
    setSlot(document.getElementById("wn-header-slot"));
  }, []);

  useEffect(() => {
    if (!slot || groups.length === 0) return;
    const panel = panelRef.current;
    const strip = stripRef.current;
    const win = winRef.current;
    const knob = knobRef.current;
    const rule = ruleRef.current;
    if (!panel || !strip || !win) return;

    // Scroll position at which each shelf becomes "current": its top pulled up to just below the sticky header.
    // Recomputed each measure so it stays right as poster images load and shift the layout below.
    const starts = () => {
      const header = win.closest("header") as HTMLElement | null;
      const offset = (header ? header.offsetHeight : 100) + 24;
      return groups.map((g) => {
        const el = document.getElementById("shows-group-" + g.key);
        return el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset) : 0;
      });
    };

    const paint = () => {
      const pos = posRef.current;
      const open = openRef.current;
      const items = Array.from(strip.querySelectorAll<HTMLElement>("[data-seg]"));
      if (!items.length) return;
      const stripW = strip.scrollWidth;
      const active = Math.min(items.length - 1, Math.max(0, Math.round(pos)));

      items.forEach((el, i) => {
        const on = open ? i === active : Math.abs(i - pos) < 0.5;
        el.style.color = on ? "#ededf0" : "#8b8b96";
        const c = el.querySelector<HTMLElement>("[data-count]");
        if (c) c.style.color = on ? "#c4c4cc" : "#4a4a54";
      });

      if (open) {
        // Hover: expand in place to fit the whole strip (over the nav), clamped to the viewport and shifted left only
        // if it would run off the right edge; a knob highlights the active group.
        const margin = 16;
        const wr = win.getBoundingClientRect();
        const w = Math.min(stripW, window.innerWidth - 2 * margin);
        let shift = 0;
        const over = wr.left + w - (window.innerWidth - margin);
        if (over > 0) shift = Math.min(wr.left - margin, over);
        panel.style.left = -Math.max(0, shift) + "px";
        panel.style.width = w + "px";
        panel.style.background = "#16161c";
        panel.style.borderColor = "#3a3a44";
        panel.style.boxShadow = "0 16px 36px -18px rgba(0,0,0,0.95)";
        panel.style.webkitMaskImage = "none";
        panel.style.maskImage = "none";
        strip.className = "wn-strip-snap";
        strip.style.transform = "translateX(0px)";
        if (rule) rule.style.opacity = "0";
        if (knob) {
          const t = items[active];
          knob.style.opacity = "1";
          knob.style.width = t.offsetWidth + "px";
          knob.style.transform = "translateX(" + t.offsetLeft + "px)";
        }
      } else {
        // Closed (design "accent underline"): frameless — the box disappears; the current group is marked only by the
        // 2px accent rule under it. The strip slides so that group's centre lands in the middle of the 190px window,
        // interpolating between neighbours for the fractional (mid-scroll) position; neighbours fade at the masked edges.
        const i = Math.floor(pos);
        const frac = pos - i;
        const a = items[i];
        const b = items[Math.min(items.length - 1, i + 1)];
        const ca = a.offsetLeft + a.offsetWidth / 2;
        const cb = b.offsetLeft + b.offsetWidth / 2;
        const centre = ca + (cb - ca) * frac;
        panel.style.left = "0px";
        panel.style.width = WIN_W + "px";
        panel.style.background = "transparent";
        panel.style.borderColor = "transparent";
        panel.style.boxShadow = "none";
        const mask = "linear-gradient(90deg, transparent 0, #000 24%, #000 76%, transparent 100%)";
        panel.style.webkitMaskImage = mask;
        panel.style.maskImage = mask;
        strip.className = "wn-strip";
        strip.style.transform = "translateX(" + (WIN_W / 2 - centre) + "px)";
        if (knob) knob.style.opacity = "0";
        if (rule) {
          // Underline as wide as the centred current group (minus the segment's inner padding), centred in the window.
          const gw = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * frac;
          const rw = Math.max(40, gw - 22);
          rule.style.opacity = "1";
          rule.style.width = rw + "px";
          rule.style.transform = "translateX(" + (WIN_W / 2 - rw / 2) + "px)";
        }
      }
    };

    const measure = () => {
      const st = starts();
      const y = window.scrollY;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      let pos = 0;
      if (y >= maxY - 4) {
        // Pinned to the bottom — the last shelf may start past max scroll, so force it current there.
        pos = groups.length - 1;
      } else {
        for (let i = 0; i < groups.length; i++) {
          const a = st[i];
          const b = i + 1 < groups.length ? st[i + 1] : a + 1;
          if (y < a) {
            pos = i;
            break;
          }
          if (y >= a && y < b) {
            pos = i + (y - a) / Math.max(1, b - a);
            break;
          }
          pos = i;
        }
      }
      if (Math.abs(pos - posRef.current) > 0.001) {
        posRef.current = pos;
        paint();
      }
    };

    const onScroll = () => measure();
    const onResize = () => {
      measure();
      paint();
    };
    const onEnter = () => {
      openRef.current = true;
      paint();
    };
    const onLeave = () => {
      openRef.current = false;
      paint();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    win.addEventListener("mouseenter", onEnter);
    win.addEventListener("mouseleave", onLeave);

    measure();
    paint();
    // Re-measure once after fonts/first posters settle, when shelf offsets have shifted.
    const settle = setTimeout(() => {
      measure();
      paint();
    }, 240);

    return () => {
      clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      win.removeEventListener("mouseenter", onEnter);
      win.removeEventListener("mouseleave", onLeave);
    };
  }, [slot, groups]);

  if (!slot || groups.length === 0) return null;

  const jump = (key: string) => {
    const el = document.getElementById("shows-group-" + key);
    if (!el) return;
    const header = document.querySelector("header") as HTMLElement | null;
    const offset = (header ? header.offsetHeight : 100) + 24;
    const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo({ top, behavior: "smooth" });
  };

  return createPortal(
    <>
      {/* Vertical divider between the nav links and the selector (matches the header's other dividers). Part of the
          portaled content, so it shows only on the Shows page alongside the selector. */}
      <span
        aria-hidden
        style={{ width: 1, height: 20, flexShrink: 0, background: "var(--color-border-hover)", marginLeft: 4, marginRight: 12 }}
      />
      <span
        ref={winRef}
        className="wn-win"
        style={{ position: "relative", width: WIN_W, height: 32, flexShrink: 0 }}
      >
      <span
        ref={panelRef}
        className="wn-panel"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: 32,
          width: WIN_W,
          overflow: "hidden",
          border: "1px solid transparent",
          borderRadius: 8,
          background: "transparent",
          zIndex: 5,
        }}
      >
        <span
          ref={knobRef}
          className="wn-knob"
          style={{
            position: "absolute",
            zIndex: 1,
            left: 0,
            top: 3,
            height: 24,
            width: 90,
            borderRadius: 6,
            background: "#1c1c21",
            border: "1px solid #2c2c36",
            opacity: 0,
            transform: "translateX(3px)",
          }}
        />
        <span
          ref={stripRef}
          className="wn-strip"
          style={{
            position: "absolute",
            zIndex: 2,
            left: 0,
            top: 0,
            height: 32,
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: "0 3px",
            willChange: "transform",
          }}
        >
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              data-seg={g.key}
              onClick={() => jump(g.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                height: 24,
                padding: "0 11px",
                border: "none",
                borderRadius: 6,
                background: "transparent",
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 12,
                whiteSpace: "nowrap",
                color: "#8b8b96",
                cursor: "pointer",
              }}
              className="wn-seg"
            >
              {g.label}
              <span
                data-count="1"
                style={{
                  fontFamily: "var(--font-num)",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 10.5,
                  color: "#4a4a54",
                }}
              >
                {g.count}
              </span>
            </button>
          ))}
        </span>
        <span
          ref={ruleRef}
          className="wn-rule"
          style={{
            position: "absolute",
            zIndex: 3,
            left: 0,
            bottom: 0,
            height: 2,
            width: 64,
            borderRadius: 2,
            background: "var(--color-accent)",
            opacity: 0,
          }}
        />
      </span>
      </span>
    </>,
    slot,
  );
}
