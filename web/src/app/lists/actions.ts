"use server";

import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";

// Manual list mutations (brief §8.6). Owner-gated and owner-scoped: every write is constrained to a list the
// owner actually owns, so a crafted id can't touch someone else's data (matters once accounts exist).

export async function createList(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await getPrisma().list.upsert({
    where: { userId_name: { userId: owner.id, name } },
    create: { userId: owner.id, name },
    update: {},
  });
  revalidatePath("/lists");
}

export async function deleteList(listId: string): Promise<void> {
  const owner = await requireOwner();
  await getPrisma().list.deleteMany({ where: { id: listId, userId: owner.id } });
  revalidatePath("/lists");
}

export async function addListItem(listId: string, formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const mediaItemId = String(formData.get("mediaItemId") ?? "");
  if (!mediaItemId) return;
  const prisma = getPrisma();
  const list = await prisma.list.findFirst({ where: { id: listId, userId: owner.id }, select: { id: true } });
  if (!list) return;
  const max = await prisma.listItem.aggregate({ where: { listId }, _max: { position: true } });
  const position = (max._max.position ?? -1) + 1;
  // ListItem's unique includes a nullable episodeId → find-then-create keeps add idempotent (see importer note).
  const existing = await prisma.listItem.findFirst({ where: { listId, mediaItemId, episodeId: null } });
  if (!existing) await prisma.listItem.create({ data: { listId, mediaItemId, position } });
  revalidatePath(`/lists/${listId}`);
}

export async function removeListItem(listItemId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const item = await prisma.listItem.findFirst({
    where: { id: listItemId, list: { is: { userId: owner.id } } },
    select: { id: true, listId: true },
  });
  if (!item) return;
  await prisma.listItem.delete({ where: { id: item.id } });
  revalidatePath(`/lists/${item.listId}`);
}

export async function moveListItem(listItemId: string, direction: "up" | "down"): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const item = await prisma.listItem.findFirst({
    where: { id: listItemId, list: { is: { userId: owner.id } } },
    select: { listId: true },
  });
  if (!item) return;

  const items = await prisma.listItem.findMany({
    where: { listId: item.listId },
    orderBy: [{ position: "asc" }, { addedAt: "asc" }],
    select: { id: true },
  });
  const idx = items.findIndex((i) => i.id === listItemId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= items.length) return;
  [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
  // Rewrite positions sequentially so ordering is well-defined regardless of prior duplicate positions.
  await prisma.$transaction(
    items.map((it, i) => prisma.listItem.update({ where: { id: it.id }, data: { position: i } })),
  );
  revalidatePath(`/lists/${item.listId}`);
}
