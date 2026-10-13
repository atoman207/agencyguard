import "server-only";
import { connection } from "next/server";
import { authenticateToken, type TokenAuth } from "./agents";
import type { Actor } from "./audit";
import { getSession } from "./auth";
import { RequestError, type ActionRequest, type Outcome } from "./engine";
import { getOrg } from "./orgs";
import { ensureSeeded } from "./seed";
import { atLeast, orgForApiKey, userActor } from "./users";
import type { ActionEvent, Org, Role, Source, User } from "@/lib/types";

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** Wraps a route handler so request mistakes become clean JSON errors instead of stack traces. */
export function route<A extends unknown[]>(fn: (request: Request, ...rest: A) => Promise<Response>) {
  return async (request: Request, ...rest: A): Promise<Response> => {
    // Wait for a real request before touching the database, so nothing here
    // runs while Next.js prerenders routes at build time. Kept outside the try:
    // during a build this call never resolves, and that must not be caught.
    await connection();
    try {
      await ensureSeeded();
      return await fn(request, ...rest);
    } catch (err) {
      if (err instanceof RequestError) return jsonError(err.status, err.code, err.message);
      // Validation errors thrown by the server modules are plain Errors with
      // messages written for people. Anything else (TypeError, a database
      // error with a code) is a bug and must not leak details.
      if (err instanceof Error && err.constructor === Error && !("code" in err)) return jsonError(400, "invalid_request", err.message);
      console.error(err);
      return jsonError(500, "internal_error", "AgentGuard hit an unexpected error.");
    }
  };
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RequestError("The request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("The request body must be a JSON object.");
  return body as Record<string, unknown>;
}

export type AgentAuth = Extract<TokenAuth, { ok: true }>;

/** Authenticates an agent by its AgentGuard token. Throws a RequestError that maps to 401. */
export function agentAuth(request: Request): AgentAuth {
  const header = request.headers.get("authorization") ?? request.headers.get("x-api-key");
  const auth = authenticateToken(header, Date.now());
  if (!auth.ok) throw new RequestError(auth.message, auth.status, auth.code);
  return auth;
}

export interface ManagementAuth {
  org: Org;
  actor: Actor;
  role: Role;
  user: User | null;
}

/** Management endpoints accept an organization API key, or the dashboard session. */
export async function managementAuth(request: Request, min: Role = "admin"): Promise<ManagementAuth> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    const key = orgForApiKey(bearer);
    if (!key) throw new RequestError("This API key is not recognised.", 401, "invalid_api_key");
    return { org: getOrg(key.orgId), actor: { type: "system", id: key.keyId, label: `API key "${key.name}"` }, role: "admin", user: null };
  }
  return sessionAuth(min);
}

/** For endpoints only a signed-in person may call, such as approving an action. */
export async function sessionAuth(min: Role = "viewer"): Promise<ManagementAuth & { user: User }> {
  const session = await getSession();
  if (!session) throw new RequestError("Sign in first.", 401, "unauthenticated");
  if (!atLeast(session.user.role, min)) throw new RequestError(`This needs the ${min} role or higher.`, 403, "forbidden");
  return { org: session.org, actor: userActor(session.user), role: session.user.role, user: session.user };
}

const COOPERATIVE: Source[] = ["sdk", "n8n", "make", "api"];

/** Builds an engine request from a JSON body. The source can only be a cooperative one; enforced sources are set by their own checkpoints. */
export function parseAction(body: Record<string, unknown>): { source: Source; req: ActionRequest } {
  const source = COOPERATIVE.includes(body.source as Source) ? (body.source as Source) : "api";
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  if (body.params !== undefined && (body.params === null || typeof body.params !== "object" || Array.isArray(body.params))) {
    throw new RequestError("`params` must be a JSON object.");
  }
  return {
    source,
    req: {
      tool: text(body.tool),
      action: text(body.action),
      resource: text(body.resource) ?? null,
      params: (body.params as Record<string, unknown> | undefined) ?? {},
      idempotencyKey: text(body.idempotency_key) ?? null,
      runId: text(body.run_id) ?? null,
      untrustedInputSeen: body.untrusted_input_seen === true,
      explanation: text(body.explanation) ?? null,
      confirmRepeat: body.confirm_repeat === true,
    },
  };
}

/** The response every checkpoint gives an agent. */
export function outcomeBody(outcome: Outcome, event: ActionEvent = outcome.event): Record<string, unknown> {
  return {
    decision: outcome.outcome,
    event_id: event.id,
    approval_id: event.approval_id,
    status: event.status,
    reason: event.reason,
    risk: event.risk,
    observe: !!event.observe,
    // In observe mode nothing is stopped; this says what enforcement would have done.
    would: event.would_decision,
    duplicate: outcome.duplicate,
    already_executed: outcome.alreadyExecuted,
    enforcement: event.enforcement,
    rules: event.rules.filter((r) => r.effect !== "allow").map((r) => r.name),
    fingerprint: event.params_fingerprint,
    // The exact parameters this answer covers. Execute these, not a modified copy.
    params: event.params,
    result: event.result,
  };
}
