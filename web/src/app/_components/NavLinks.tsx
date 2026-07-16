"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEM_ACTIVE, NAV_ITEM_BASE, NAV_ITEM_INACTIVE } from "./navItemClass";

// The nav's content links, with the active one highlighted (accent-tinted pill) based on the current path. Client
// so it can read usePathname; the destinations themselves are decided server-side (Download is owner-only) and
// passed in, so this component carries no access logic — only which pill is lit.
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${NAV_ITEM_BASE} ${active ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE}`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
