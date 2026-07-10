import { getPrisma } from "../src/lib/db";

// Idempotent seed: the single v1 owner (brief §5 — "Seed exactly one User with role 'owner'"). A fixed id
// makes re-runs an upsert, never a duplicate. All user-state rows (states, seen, lists, ratings) reference
// this row's id; the app (and CLI scripts) resolve it via getOwner() (src/lib/session.ts).

const prisma = getPrisma();

const OWNER_ID = "owner";
const OWNER_NAME = "Sava";

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { id: OWNER_ID },
    create: { id: OWNER_ID, name: OWNER_NAME, role: "owner" },
    update: { name: OWNER_NAME, role: "owner" },
  });
  console.log(`Seeded owner user (id=${OWNER_ID}, name=${OWNER_NAME}).`);
}

main().finally(() => prisma.$disconnect());
