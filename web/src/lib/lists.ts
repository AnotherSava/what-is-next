import { getPrisma } from "@/lib/db";

// Read-side data layer for manual lists (brief §8.6). The watch-next queue is derived, not a list; these are
// purely user-curated collections. Explicit userId (§5a rule 1).

export interface ListSummary {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

export async function getLists(userId: string): Promise<ListSummary[]> {
  const lists = await getPrisma().list.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { items: true } } },
  });
  return lists.map((l) => ({ id: l.id, name: l.name, description: l.description, itemCount: l._count.items }));
}

export interface ListItemView {
  listItemId: string;
  mediaItemId: string;
  mediaType: string;
  title: string;
  posterPath: string | null;
  position: number;
}

export interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  items: ListItemView[];
}

export async function getListDetail(userId: string, listId: string): Promise<ListDetail | null> {
  const list = await getPrisma().list.findFirst({
    where: { id: listId, userId },
    include: {
      items: {
        orderBy: [{ position: "asc" }, { addedAt: "asc" }],
        include: { mediaItem: { select: { id: true, mediaType: true, title: true, posterPath: true } } },
      },
    },
  });
  if (!list) return null;
  return {
    id: list.id,
    name: list.name,
    description: list.description,
    items: list.items.map((it) => ({
      listItemId: it.id,
      mediaItemId: it.mediaItem.id,
      mediaType: it.mediaItem.mediaType,
      title: it.mediaItem.title,
      posterPath: it.mediaItem.posterPath,
      position: it.position,
    })),
  };
}

// Tracked items (any type) the owner could add to this list — everything they track that isn't already in it.
export async function getAddableItems(
  userId: string,
  listId: string,
): Promise<{ id: string; title: string; mediaType: string }[]> {
  const prisma = getPrisma();
  const inList = await prisma.listItem.findMany({ where: { listId }, select: { mediaItemId: true } });
  const excluded = new Set(inList.map((i) => i.mediaItemId));
  const states = await prisma.userMediaState.findMany({
    where: { userId },
    include: { mediaItem: { select: { id: true, title: true, mediaType: true } } },
    orderBy: { mediaItem: { title: "asc" } },
  });
  return states
    .map((s) => s.mediaItem)
    .filter((m) => !excluded.has(m.id))
    .map((m) => ({ id: m.id, title: m.title, mediaType: m.mediaType }));
}
