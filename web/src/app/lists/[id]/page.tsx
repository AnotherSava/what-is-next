import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Poster } from "@/app/_components/Poster";
import { getAddableItems, getListDetail } from "@/lib/lists";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { addListItem, moveListItem, removeListItem } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const displayedUser = await getDisplayedUser();
  const list = await getListDetail(displayedUser.id, id);
  return { title: list?.name ?? "List" };
}

export default async function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const list = await getListDetail(displayedUser.id, id);
  if (!list) notFound();
  const addable = canEdit ? await getAddableItems(displayedUser.id, id) : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/lists" className="text-xs text-[var(--color-muted)] hover:underline">
          ← Lists
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>
        {list.description && <p className="mt-1 text-sm text-[var(--color-muted)]">{list.description}</p>}
      </div>

      {canEdit && addable.length > 0 && (
        <form action={addListItem.bind(null, id)} className="flex gap-2">
          <select
            name="mediaItemId"
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            {addable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} ({a.mediaType === "tv" ? "TV" : "Movie"})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent-strong)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent)]"
          >
            Add
          </button>
        </form>
      )}

      {list.items.length === 0 ? (
        <p className="text-[var(--color-muted)]">This list is empty.</p>
      ) : (
        <ul className="space-y-2">
          {list.items.map((it, i) => (
            <li
              key={it.listItemId}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
            >
              <Poster path={it.posterPath} alt={it.title} width={40} height={60} size="w185" />
              <Link
                href={it.mediaType === "tv" ? `/shows/${it.mediaItemId}` : "/movies"}
                className="flex-1 truncate font-medium hover:underline"
              >
                {it.title}
              </Link>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <MoveButton listItemId={it.listItemId} direction="up" disabled={i === 0} />
                  <MoveButton listItemId={it.listItemId} direction="down" disabled={i === list.items.length - 1} />
                  <form action={removeListItem.bind(null, it.listItemId)}>
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-red-400"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoveButton({
  listItemId,
  direction,
  disabled,
}: {
  listItemId: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <form action={moveListItem.bind(null, listItemId, direction)}>
      <button
        type="submit"
        disabled={disabled}
        aria-label={direction === "up" ? "Move up" : "Move down"}
        className="rounded-md px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-30"
      >
        {direction === "up" ? "↑" : "↓"}
      </button>
    </form>
  );
}
