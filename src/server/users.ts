import "server-only";
import { all, get, run, tx } from "./db";
import { hashPassword, newId, randomToken, sha256, verifyPassword } from "./crypto";
import { audit, type Actor } from "./audit";
import { DEFAULT_SETTINGS } from "./orgs";
import type { Org, Role, User } from "@/lib/types";

const USER_COLUMNS = "id, org_id, email, name, role, avatar, created_at";
export const ROLES: Role[] = ["owner", "admin", "approver", "viewer"];
const RANK: Record<Role, number> = { viewer: 0, approver: 1, admin: 2, owner: 3 };

export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];
export const userActor = (user: Pick<User, "id" | "name">): Actor => ({ type: "user", id: user.id, label: user.name });

export async function listUsers(orgId: string): Promise<User[]> {
  return await all<User>(`SELECT ${USER_COLUMNS} FROM users WHERE org_id = ? ORDER BY created_at ASC`, orgId);
}

export async function getUser(id: string): Promise<User | undefined> {
  return await get<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, id);
}

async function validate(email: string, password: string, name: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error("Enter a valid email address.");
  if (password.length < 8) throw new Error("The password needs at least 8 characters.");
  if (!name.trim()) throw new Error("Enter a name.");
  if (await get("SELECT 1 AS x FROM users WHERE email = ?", normalized)) throw new Error("An account with this email already exists.");
  return normalized;
}

/** Creates a new workspace with its first user as owner. */
export async function signUp(input: { orgName: string; name: string; email: string; password: string; avatar?: string | null }, now: number): Promise<User> {
  const email = await validate(input.email, input.password, input.name);
  if (!input.orgName.trim()) throw new Error("Enter a workspace name.");
  const orgId = newId("org");
  const userId = newId("usr");
  await tx(async () => {
    await run("INSERT INTO organizations (id, name, settings, created_at) VALUES (?, ?, ?, ?)", orgId, input.orgName.trim(), JSON.stringify(DEFAULT_SETTINGS), now);
    await run(
      "INSERT INTO users (id, org_id, email, name, password_hash, role, avatar, created_at) VALUES (?, ?, ?, ?, ?, 'owner', ?, ?)",
      userId,
      orgId,
      email,
      input.name.trim(),
      hashPassword(input.password),
      input.avatar ?? null,
      now,
    );
    await audit(orgId, { type: "user", id: userId, label: input.name.trim() }, "organization.created", { type: "organization", id: orgId }, { name: input.orgName.trim() }, now);
  });
  return (await getUser(userId))!;
}

export async function setUserAvatar(userId: string, avatar: string | null): Promise<void> {
  await run("UPDATE users SET avatar = ? WHERE id = ?", avatar, userId);
}

/**
 * Adds a member with a password the inviter passes on. Invitation emails are
 * not wired to a mail provider in this MVP.
 */
export async function addMember(org: Org, actor: Actor, input: { name: string; email: string; role: Role; password: string }, now: number): Promise<User> {
  if (!ROLES.includes(input.role)) throw new Error("Choose a role.");
  const email = await validate(input.email, input.password, input.name);
  const id = newId("usr");
  await run("INSERT INTO users (id, org_id, email, name, password_hash, role, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)", id, org.id, email, input.name.trim(), hashPassword(input.password), input.role, now);
  await audit(org.id, actor, "member.added", { type: "user", id }, { name: input.name.trim(), email, role: input.role }, now);
  return (await getUser(id))!;
}

async function ownerCount(orgId: string): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'owner'", orgId))!.n;
}

export async function changeRole(org: Org, actor: Actor, userId: string, role: Role, now: number): Promise<void> {
  if (!ROLES.includes(role)) throw new Error("Choose a role.");
  const user = await getUser(userId);
  if (!user || user.org_id !== org.id) throw new Error("Member not found.");
  if (user.role === "owner" && role !== "owner" && await ownerCount(org.id) === 1) throw new Error("A workspace needs at least one owner.");
  await run("UPDATE users SET role = ? WHERE id = ?", role, userId);
  await audit(org.id, actor, "member.role_changed", { type: "user", id: userId }, { name: user.name, from: user.role, to: role }, now);
}

export async function removeMember(org: Org, actor: Actor, userId: string, now: number): Promise<void> {
  const user = await getUser(userId);
  if (!user || user.org_id !== org.id) throw new Error("Member not found.");
  if (user.id === actor.id) throw new Error("You cannot remove yourself.");
  if (user.role === "owner" && await ownerCount(org.id) === 1) throw new Error("A workspace needs at least one owner.");
  await tx(async () => {
    await run("DELETE FROM sessions WHERE user_id = ?", userId);
    await run("DELETE FROM users WHERE id = ?", userId);
    await audit(org.id, actor, "member.removed", { type: "user", id: userId }, { name: user.name, email: user.email }, now);
  });
}

// --- sessions ------------------------------------------------------------------

export const SESSION_DAYS = 7;

// Slows down password guessing. In-memory, so it resets on restart and is per process.
const failures = new Map<string, { count: number; until: number }>();

export async function checkPassword(email: string, password: string, now: number): Promise<User> {
  const key = email.trim().toLowerCase();
  const state = failures.get(key);
  if (state && state.until > now) throw new Error("Too many attempts. Try again in a few minutes.");
  const row = await get<User & { password_hash: string }>(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`, key);
  if (!row || !verifyPassword(password, row.password_hash)) {
    const count = (state && state.until > now - 600_000 ? state.count : 0) + 1;
    failures.set(key, { count, until: count >= 5 ? now + 5 * 60_000 : 0 });
    throw new Error("The email or password is not correct.");
  }
  failures.delete(key);
  return (await getUser(row.id))!;
}

export async function createSession(userId: string, now: number): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const expiresAt = now + SESSION_DAYS * 86_400_000;
  await run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, now, expiresAt);
  return { token, expiresAt };
}

export async function userForSession(token: string, now: number): Promise<User | undefined> {
  const row = await get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", sha256(token));
  if (!row || row.expires_at < now) return undefined;
  return await getUser(row.user_id);
}

/** Like `userForSession`, but checks expiry against the database clock, for callers that must not read the time themselves. */
export async function userForLiveSession(token: string): Promise<User | undefined> {
  const row = await get<{ user_id: string }>("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?", sha256(token), Date.now());
  return row ? await getUser(row.user_id) : undefined;
}

export async function destroySession(token: string): Promise<void> {
  await run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

// --- organization API keys ------------------------------------------------------
// Used by the management endpoints (/v1/agents, /v1/rules, /v1/limits).

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  revoked_at: number | null;
}

export async function listApiKeys(orgId: string): Promise<ApiKey[]> {
  return await all<ApiKey>("SELECT id, name, prefix, created_at, revoked_at FROM api_keys WHERE org_id = ? ORDER BY created_at DESC", orgId);
}

export async function createApiKey(org: Org, actor: Actor, name: string, now: number): Promise<string> {
  const key = `agk_${randomToken(30)}`;
  const id = newId("key");
  await run("INSERT INTO api_keys (id, org_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, org.id, name.trim() || "API key", key.slice(0, 10), sha256(key), now);
  await audit(org.id, actor, "api_key.created", { type: "api_key", id }, { name }, now);
  return key;
}

export async function revokeApiKey(org: Org, actor: Actor, id: string, now: number): Promise<void> {
  if (await run("UPDATE api_keys SET revoked_at = ? WHERE org_id = ? AND id = ? AND revoked_at IS NULL", now, org.id, id)) {
    await audit(org.id, actor, "api_key.revoked", { type: "api_key", id }, {}, now);
  }
}

export async function orgForApiKey(key: string): Promise<{ orgId: string; keyId: string; name: string } | undefined> {
  const row = await get<{ org_id: string; id: string; name: string }>("SELECT org_id, id, name FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL", sha256(key));
  return row ? { orgId: row.org_id, keyId: row.id, name: row.name } : undefined;
}
