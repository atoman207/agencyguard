import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getOrg } from "./orgs";
import { ensureSeeded } from "./seed";
import { atLeast, createSession, destroySession, SESSION_DAYS, userForLiveSession, userForSession } from "./users";
import type { Org, Role, User } from "@/lib/types";

export const SESSION_COOKIE = "ag_session";

export interface Session {
  user: User;
  org: Org;
  /** The moment this request was read. One clock for the whole page. */
  now: number;
}

/** The signed-in user, read once per request for a page and everything it renders. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // Everything a signed-in page shows is live data from the in-memory store.
  // Waiting for the real request keeps it out of any prerendered or prefetched
  // shell, so a page never shows a stale copy of approvals or activity.
  await connection();
  await ensureSeeded();
  if (!token) return null;
  const now = Date.now();
  const user = await userForSession(token, now);
  if (!user) return null;
  return { user, org: await getOrg(user.org_id), now };
});

/**
 * Who is signed in, for the app shell (sidebar badge and user panel).
 *
 * The shell is shared by every page and is part of what Next.js prefetches per
 * session, so it reads only the cookie: no `connection()` and no clock. That
 * keeps the shell instant. It decides nothing; every page, action and route
 * re-checks the session itself with `getSession`.
 */
export async function readShellSession(): Promise<Pick<Session, "user" | "org"> | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureSeeded();
  const user = await userForLiveSession(token);
  return user ? { user, org: await getOrg(user.org_id) } : null;
}

/** For pages: sends anyone who is not signed in to the login page. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** For Server Actions: every action re-checks who is calling and what they may do. */
export async function requireRole(min: Role): Promise<Session> {
  const session = await requireSession();
  if (!atLeast(session.user.role, min)) throw new Error(`This needs the ${min} role or higher.`);
  return session;
}

export async function startSession(userId: string): Promise<void> {
  const { token } = await createSession(userId, Date.now());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.AGENTGUARD_INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE);
}
