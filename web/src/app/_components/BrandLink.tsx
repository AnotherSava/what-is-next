"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The nav's brand: the gradient play-triangle mark + "What's next", linking home and lit like a nav pill when the
// home view is active. Client so it can read usePathname for that active state.
export function BrandLink() {
  const active = usePathname() === "/";
  return (
    <Link
      href="/"
      aria-current={active ? "page" : undefined}
      className={`wn-nav wn-brand flex h-[22px] items-center gap-2 rounded-lg pr-2 ${
        active ? "wn-nav-on bg-[rgba(125,149,255,0.16)]" : ""
      }`}
    >
      <span
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md"
        style={{ background: "linear-gradient(140deg,#7d95ff,#4f6ef7)" }}
      >
        <svg width="8" height="9" viewBox="0 0 8 9" fill="#08080a" aria-hidden>
          <path d="M0 0.5 L8 4.5 L0 8.5 Z" />
        </svg>
      </span>
      <span className="font-display text-[15px] font-bold whitespace-nowrap">What&rsquo;s next</span>
    </Link>
  );
}
