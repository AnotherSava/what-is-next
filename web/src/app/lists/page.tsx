import type { Metadata } from "next";
import Link from "next/link";
import { getLists } from "@/lib/lists";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { createList, deleteList } from "./actions";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const lists = await getLists(displayedUser.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Lists</h1>

      {canEdit && (
        <form action={createList} className="flex gap-2">
          <input
            name="name"
            required
            placeholder="New list name…"
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent)]"
          >
            Create
          </button>
        </form>
      )}

      {lists.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          No lists yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {lists.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <Link href={`/lists/${l.id}`} className="flex-1 font-medium hover:underline">
                {l.name} <span className="text-sm text-[var(--color-muted)]">({l.itemCount})</span>
              </Link>
              {canEdit && (
                <form action={deleteList.bind(null, l.id)}>
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-red-400"
                  >
                    Delete
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
