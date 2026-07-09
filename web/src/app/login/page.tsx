import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { getOwner } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

async function login(formData: FormData): Promise<void> {
  "use server";
  const password = formData.get("password");
  if (typeof password !== "string" || !verifyPassword(password)) redirect("/login?error=1");
  // A valid password mints a session for the single owner. The token carries the owner's id; role is
  // re-verified server-side on every owner action (requireOwner).
  const owner = await getOwner();
  (await cookies()).set(SESSION_COOKIE, createSessionToken(owner.id), sessionCookieOptions());
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-sm py-10">
      <form
        action={login}
        className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">Owner sign in</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Unlocks editing. Viewers can browse without signing in.
          </p>
        </div>
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">Wrong password.</p>}
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm text-[var(--color-muted)]">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-[var(--color-accent-strong)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent)]"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
