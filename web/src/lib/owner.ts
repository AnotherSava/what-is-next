import type { User } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";

// THE single seam that knows the v1 "one owner" reality (brief §5a rule 1). When accounts arrive, grepping
// for getOwner( is the complete list of call sites to revisit — nothing else may query User "the first row".
//
// Kept in its own module (no `next/headers`, no cookies) so it's importable from BOTH the request path
// (via session.ts) AND the nightly job (instrumentation.ts), which runs in-process outside any request.
export async function getOwner(): Promise<User> {
  const owner = await getPrisma().user.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error("No owner user seeded — run `npm run db:seed`.");
  return owner;
}
