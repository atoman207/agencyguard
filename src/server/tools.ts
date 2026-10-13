import "server-only";
import { all, get, run } from "./db";
import { newId } from "./crypto";
import { audit, type Actor } from "./audit";
import { isKnownAction, suggestAction } from "@/lib/catalog";
import type { AgentTool, Connection, Org, Source, Tool, ToolPermission } from "@/lib/types";

export function connectionFor(source: Source): Connection {
  if (source === "vault" || source === "ai_gateway" || source === "mcp_gateway") return source;
  return "cooperative";
}

export function getTool(orgId: string, name: string): Tool | undefined {
  return get<Tool>("SELECT * FROM tools WHERE org_id = ? AND name = ?", orgId, name);
}

export function getToolById(orgId: string, id: string): Tool | undefined {
  return get<Tool>("SELECT * FROM tools WHERE org_id = ? AND id = ?", orgId, id);
}

/**
 * Records that a tool exists. A tool whose name is a catalog action, or that
 * AgentGuard itself defines (vault connectors), is trusted as classified.
 * Anything else starts unclassified with a keyword-based suggestion.
 */
export function upsertTool(orgId: string, name: string, now: number, knownAction?: string): Tool {
  const existing = getTool(orgId, name);
  if (existing) {
    run("UPDATE tools SET last_seen_at = ? WHERE id = ?", now, existing.id);
    return existing;
  }
  const action = knownAction ?? (isKnownAction(name) ? name : null);
  const id = newId("tool");
  run(
    "INSERT INTO tools (id, org_id, name, action, suggested_action, status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    orgId,
    name,
    action,
    action ? null : suggestAction(name),
    action ? "confirmed" : "unclassified",
    now,
    now,
  );
  return getToolById(orgId, id)!;
}

export function getAgentTool(agentId: string, toolId: string): AgentTool | undefined {
  return get<AgentTool>("SELECT * FROM agent_tools WHERE agent_id = ? AND tool_id = ?", agentId, toolId);
}

/** Links a tool to an agent the first time it is seen, and tracks how it is connected. */
export function sightTool(orgId: string, agentId: string, toolId: string, connection: Connection, now: number): AgentTool {
  const existing = getAgentTool(agentId, toolId);
  if (!existing) {
    run("INSERT INTO agent_tools (agent_id, tool_id, org_id, connection, last_seen_at) VALUES (?, ?, ?, ?, ?)", agentId, toolId, orgId, connection, now);
  } else {
    run("UPDATE agent_tools SET connection = ?, last_seen_at = ? WHERE agent_id = ? AND tool_id = ?", connection, now, agentId, toolId);
  }
  return getAgentTool(agentId, toolId)!;
}

export function listTools(orgId: string): Tool[] {
  return all<Tool>("SELECT * FROM tools WHERE org_id = ? ORDER BY status DESC, last_seen_at DESC", orgId);
}

export function countUnclassified(orgId: string): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM tools WHERE org_id = ? AND status = 'unclassified'", orgId)!.n;
}

export interface AgentToolView extends AgentTool {
  name: string;
  action: string | null;
  suggested_action: string | null;
  status: Tool["status"];
}

export function listAgentTools(orgId: string, agentId?: string): AgentToolView[] {
  const where = agentId ? "at.org_id = ? AND at.agent_id = ?" : "at.org_id = ?";
  const params = agentId ? [orgId, agentId] : [orgId];
  return all<AgentToolView>(
    `SELECT at.*, t.name, t.action, t.suggested_action, t.status
     FROM agent_tools at JOIN tools t ON t.id = at.tool_id
     WHERE ${where} ORDER BY t.name ASC`,
    ...params,
  );
}

export function classifyTool(org: Org, actor: Actor, toolId: string, action: string, now: number): void {
  if (!isKnownAction(action)) throw new Error("Choose an action type from the catalog.");
  const tool = getToolById(org.id, toolId);
  if (!tool) throw new Error("Tool not found.");
  run("UPDATE tools SET action = ?, status = 'confirmed' WHERE id = ?", action, toolId);
  audit(org.id, actor, "tool.classified", { type: "tool", id: toolId }, { name: tool.name, action, suggested: tool.suggested_action, previous: tool.action }, now);
}

export function setToolPermission(org: Org, actor: Actor, agentId: string, toolId: string, permission: ToolPermission, now: number): void {
  const tool = getToolById(org.id, toolId);
  if (!tool || !getAgentTool(agentId, toolId)) throw new Error("Tool not found for this agent.");
  run("UPDATE agent_tools SET permission = ? WHERE agent_id = ? AND tool_id = ?", permission, agentId, toolId);
  audit(org.id, actor, "tool.permission_changed", { type: "agent", id: agentId }, { tool: tool.name, permission }, now);
}

/**
 * Adds a tool to an agent's inventory by hand. This is how tools that never
 * pass through AgentGuard (direct API keys, database access) become visible in
 * the coverage score instead of staying hidden.
 */
export function declareTool(
  org: Org,
  actor: Actor,
  agentId: string,
  input: { name: string; action: string; connection: Connection },
  now: number,
): void {
  if (!isKnownAction(input.action)) throw new Error("Choose an action type from the catalog.");
  const tool = upsertTool(org.id, input.name, now, input.action);
  if (tool.status === "unclassified") run("UPDATE tools SET action = ?, status = 'confirmed' WHERE id = ?", input.action, tool.id);
  const existing = getAgentTool(agentId, tool.id);
  if (existing) {
    run("UPDATE agent_tools SET connection = ?, declared = 1 WHERE agent_id = ? AND tool_id = ?", input.connection, agentId, tool.id);
  } else {
    run("INSERT INTO agent_tools (agent_id, tool_id, org_id, connection, declared) VALUES (?, ?, ?, ?, 1)", agentId, tool.id, org.id, input.connection);
  }
  audit(org.id, actor, "tool.declared", { type: "agent", id: agentId }, { tool: input.name, action: input.action, connection: input.connection }, now);
}

export function removeAgentTool(org: Org, actor: Actor, agentId: string, toolId: string, now: number): void {
  const tool = getToolById(org.id, toolId);
  if (!tool) return;
  run("DELETE FROM agent_tools WHERE org_id = ? AND agent_id = ? AND tool_id = ?", org.id, agentId, toolId);
  audit(org.id, actor, "tool.removed", { type: "agent", id: agentId }, { tool: tool.name }, now);
}

/** Removes a tool from the organization catalog and every agent that used it. */
export function deleteTool(org: Org, actor: Actor, toolId: string, now: number): void {
  const tool = getToolById(org.id, toolId);
  if (!tool) throw new Error("Tool not found.");
  const links = run("DELETE FROM agent_tools WHERE org_id = ? AND tool_id = ?", org.id, toolId);
  run("DELETE FROM tools WHERE org_id = ? AND id = ?", org.id, toolId);
  audit(org.id, actor, "tool.deleted", { type: "tool", id: toolId }, { name: tool.name, agents_unlinked: links }, now);
}
