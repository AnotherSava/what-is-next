"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { addTitle } from "@/app/search/actions";
import { AddMark } from "./AddMark";

// The non-library preview hero's add affordance: the same two-step "+" corner mark as the search cards, but on
// confirm it adds the item AND navigates to its now-real detail page (search cards flip to ✓ in place instead).
// Sits in the preview poster's top-right corner, where a library poster shows its favourite heart.
export function PreviewAddMark({
  tmdbId,
  mediaType,
  title,
  posterPath,
}: {
  tmdbId: number;
  mediaType: "tv" | "movie";
  title: string;
  posterPath: string | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const onConfirm = () =>
    start(async () => {
      // awaitHydration: this navigates straight to the detail page, so fill the item in first — otherwise it lands on
      // a bare title+poster stub while background hydration is still running.
      const { slug } = await addTitle({ tmdbId, mediaType, title, posterPath }, { awaitHydration: true });
      router.push(`/${mediaType === "tv" ? "shows" : "movies"}/${slug}`);
    });

  return <AddMark pending={pending} onConfirm={onConfirm} />;
}
