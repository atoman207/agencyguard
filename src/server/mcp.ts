import "server-only";
import { all, get, run } from "./db";
import { decryptSecret, encryptSecret, newId } from "./crypto";
import { agentActor } from "./agents";
import { audit, type Actor } from "./audit";
import { demoMcp, type JsonRpcMessage } from "./demo-mcp";
import { decide, markRunUntrusted } from "./engine";
import { updateEvent } from "./events";
import { createAlert } from "./notify";
import { looksLikeInjection } from "./response-check";
import { connectionFor, getAgentTool, sightTool, upsertTool } from "./tools";
import { getAction } from "@/lib/catalog";
import type { Agent, AgentToken, McpServer, Org } from "@/lib/types";

// The MCP gateway: a proxy in front of an MCP tool server. The agent connects
// to AgentGuard's address instead of the server's; every tools/call goes
// through the decision engine before it is forwarded.
//
// It speaks MCP's Streamable HTTP transport for single request/response
// messages. Server-initiated streams (GET) are not proxied.

export const BUILTIN_DEMO = "builtin:demo-shop";

export function listMcpServers(orgId: string): McpServer[] {
  return all<McpServer>("SELECT id, org_id, slug, name, url, created_at FROM mcp_servers WHERE org_id = ? ORDER BY created_at ASC", orgId);
}

export function saveMcpServer(org: Org, actor: Actor, input: { slug: string; name: string; url: string; authHeader?: string }, now: number): void {
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Give the server a short name using letters, numbers and dashes.");
  const url = input.url.trim();
  if (url !== BUILTIN_DEMO && !/^https?:\/\//.test(url)) throw new Error("The server address must start with http:// or https://");
  run("DELETE FROM mcp_servers WHERE org_id = ? AND slug = ?", org.id, slug);
  run(
    "INSERT INTO mcp_servers (id, org_id, slug, name, url, auth_header, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId("mcp"), org.id, slug, input.name.trim() || slug, url, input.authHeader?.trim() ? encryptSecret(input.authHeader.trim()) : null, now,
  );
  audit(org.id, actor, "mcp.server_saved", { type: "mcp_server", id: slug }, { name: input.name, url }, now);
}

export function deleteMcpServer(org: Org, actor: Actor, slug: string, now: number): void {
  if (run("DELETE FROM mcp_servers WHERE org_id = ? AND slug = ?", org.id, slug)) {
    audit(org.id, actor, "mcp.server_removed", { type: "mcp_server", id: slug }, {}, now);
  }
}

interface Upstream {
  message: JsonRpcMessage | null;
  sessionId: string | null;
}

async function forward(server: McpServer & { auth_header: string | null }, message: JsonRpcMessage, headers: McpHeaders): Promise<Upstream> {
  if (server.url === BUILTIN_DEMO) return { message: demoMcp(message), sessionId: null };

  const out: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (headers.sessionId) out["mcp-session-id"] = headers.sessionId;
  if (headers.protocolVersion) out["mcp-protocol-version"] = headers.protocolVersion;
  // The MCP server's own credential stays here; the agent never sees it.
  if (server.auth_header) out.authorization = decryptSecret(server.auth_header);

  const res = await fetch(server.url, { method: "POST", headers: out, body: JSON.stringify(message), signal: AbortSignal.timeout(60_000) });
  const sessionId = res.headers.get("mcp-session-id");
  if (res.status === 202 || res.status === 204) return { message: null, sessionId };
  const text = await res.text();
  if (!res.ok) throw new Error(`The MCP server answered HTTP ${res.status}: ${text.slice(0, 200)}`);

  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    // The reply to our request is the SSE data frame that carries its id.
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as JsonRpcMessage;
        if (parsed.id === message.id && (parsed.result !== undefined || parsed.error !== undefined)) return { message: parsed, sessionId };
      } catch {
        // Not JSON: a comment or keep-alive frame.
      }
    }
    throw new Error("The MCP server's stream ended without answering the request.");
  }
  return { message: text ? (JSON.parse(text) as JsonRpcMessage) : null, sessionId };
}

export interface McpHeaders {
  sessionId: string | null;
  protocolVersion: string | null;
  runId: string | null;
}

export interface McpResult {
  status: number;
  message: JsonRpcMessage | null;
  sessionId: string | null;
}

const toolResult = (id: JsonRpcMessage["id"], text: string, isError: boolean): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result: { content: [{ type: "text", text }], isError },
});

const rpcError = (id: JsonRpcMessage["id"], code: number, message: string): JsonRpcMessage => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function resultText(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c?.type === "text" && typeof c.text === "string" ? c.text : "")).join("\n");
}

export async function handleMcp(
  auth: { org: Org; agent: Agent; token: AgentToken },
  slug: string,
  message: JsonRpcMessage,
  headers: McpHeaders,
  now: number,
): Promise<McpResult> {
  const { org, agent, token } = auth;
  const server = get<McpServer & { auth_header: string | null }>("SELECT * FROM mcp_servers WHERE org_id = ? AND slug = ?", org.id, slug);
  if (!server) return { status: 404, message: rpcError(message.id, -32001, `No MCP server named "${slug}" is registered in AgentGuard.`), sessionId: null };

  // A stopped agent gets nothing through, including tool discovery.
  if (agent.status !== "active" && message.method !== "tools/call") {
    return { status: 200, message: message.id === undefined ? null : rpcError(message.id, -32002, `AgentGuard: this agent is ${agent.status}.`), sessionId: null };
  }

  try {
    if (message.method === "tools/list") {
      const up = await forward(server, message, headers);
      const result = up.message?.result as { tools?: { name: string }[] } | undefined;
      if (result?.tools) {
        result.tools = result.tools.filter((t) => {
          // Discovery: every tool the server offers becomes visible in the registry.
          const tool = upsertTool(org.id, `${slug}.${t.name}`, now);
          const link = getAgentTool(agent.id, tool.id) ?? sightTool(org.id, agent.id, tool.id, connectionFor("mcp_gateway"), now);
          return link.permission !== "deny";
        });
      }
      return { status: 200, ...up };
    }

    if (message.method !== "tools/call") {
      const up = await forward(server, message, headers);
      return { status: up.message ? 200 : 202, ...up };
    }

    const name = String(message.params?.name ?? "");
    const args = (message.params?.arguments as Record<string, unknown> | undefined) ?? {};
    const toolName = `${slug}.${name}`;
    const outcome = decide({ org, agent, token, source: "mcp_gateway", now }, { tool: toolName, params: args, runId: headers.runId });
    const event = outcome.event;

    if (outcome.outcome === "block") {
      return { status: 200, message: toolResult(message.id, `Blocked by AgentGuard. ${event.reason ?? ""} This action was NOT performed.`, true), sessionId: null };
    }
    if (outcome.outcome === "pending") {
      return {
        status: 200,
        sessionId: null,
        message: toolResult(
          message.id,
          `Waiting for human approval (${event.approval_id}). This action has NOT been performed yet. Do not tell anyone it is done. Call the same tool again with the same arguments once it is approved.`,
          true,
        ),
      };
    }
    if (outcome.alreadyExecuted) {
      const earlier = resultText(event.result) || "It completed earlier.";
      return { status: 200, message: toolResult(message.id, `Already done (${event.id}); AgentGuard did not run it a second time. Earlier result: ${earlier}`, false), sessionId: null };
    }

    const type = getAction(event.action);
    const settle = (ok: boolean) => (event.amount !== null && type.money ? (ok ? "settled" : "released") : event.money_state);
    let up: Upstream;
    try {
      up = await forward(server, message, headers);
    } catch (err) {
      updateEvent(event.id, { status: "failed", result: { error: String(err).slice(0, 500) }, money_state: settle(false), completed_at: now });
      throw err;
    }
    const failed = !!up.message?.error || (up.message?.result as { isError?: boolean } | undefined)?.isError === true;
    const text = resultText(up.message?.result);
    updateEvent(event.id, {
      status: failed ? "failed" : "executed",
      result: up.message?.error ? { error: up.message.error.message } : { content: [{ type: "text", text: text.slice(0, 4000) }] },
      money_state: settle(!failed),
      completed_at: now,
    });

    // What the agent has just read. From here on, sending data outside is high risk.
    const injected = looksLikeInjection(text);
    if (!failed && (type.readsUntrusted || injected)) {
      markRunUntrusted(org, agent, headers.runId, `${toolName}${injected ? ", which contained hidden instructions" : ""}`, now);
      if (injected) {
        audit(org.id, agentActor(agent), "injection.suspected", { type: "event", id: event.id }, { tool: toolName }, now);
        createAlert(org, {
          kind: "injection.suspected", severity: "warning", title: `${agent.name} read content with hidden instructions`,
          body: `The result of ${toolName} contains text that tries to instruct the agent. Anything it now sends outside needs a person if it can reach private data.`,
          agentId: agent.id, eventId: event.id,
        }, now);
      }
    }
    return { status: 200, ...up };
  } catch (err) {
    return { status: 200, message: rpcError(message.id, -32000, `AgentGuard MCP gateway: ${err instanceof Error ? err.message : String(err)}`), sessionId: null };
  }
}
