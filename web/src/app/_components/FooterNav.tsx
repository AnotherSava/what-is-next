"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/_actions/auth";
import { NAV_ITEM_ACTIVE, NAV_ITEM_BASE, NAV_ITEM_INACTIVE } from "./navItemClass";

// The footer's Credits / Sign out, styled as nav items (grey with a hover outline; Credits lights up on /credits)
// to match the top nav. Client so Credits can read the current path for its active state.
export function FooterNav({ isOwner }: { isOwner: boolean }) {
  const creditsActive = usePathname() === "/credits";
  return (
    <div className="ml-auto flex items-center gap-1">
      <Link
        href="/credits"
        aria-current={creditsActive ? "page" : undefined}
        className={`${NAV_ITEM_BASE} ${creditsActive ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE}`}
      >
        Credits
      </Link>
      {isOwner && (
        <form action={logout}>
          <button type="submit" className={`${NAV_ITEM_BASE} ${NAV_ITEM_INACTIVE}`}>
            Sign out
          </button>
        </form>
      )}
    </div>
  );
}
