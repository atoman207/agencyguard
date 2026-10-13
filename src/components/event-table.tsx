import Link from "next/link";
import { Lock, ShieldQuestion } from "@/components/icons";
import { DecisionBadge, StatusBadge } from "./badges";
import { getAction } from "@/lib/catalog";
import { cost, dateTime, money } from "@/lib/format";
import type { ActionEvent, Agent } from "@/lib/types";

export const SOURCE_LABEL: Record<string, string> = {
  vault: "Vault",
  ai_gateway: "AI gateway",
  mcp_gateway: "MCP gateway",
  sdk: "SDK",
  n8n: "n8n",
  make: "Make",
  api: "Check API",
};

export function eventTitle(e: ActionEvent): string {
  if (e.action === "ai.completion") return `Model call to ${e.model ?? "a model"}`;
  if (e.action === "unknown") return `Unclassified tool`;
  return getAction(e.action).label;
}

export function EventTable({ events, agents, timeZone, showAgent = true, compact = false }: { events: ActionEvent[]; agents: Map<string, Agent>; timeZone: string; showAgent?: boolean; /** Drops the checkpoint column, for narrow cards. */ compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={`ledger w-full ${compact ? "min-w-[560px]" : "min-w-[720px]"}`}>
        <thead>
          <tr>
            <th>When</th>
            {showAgent && <th>Agent</th>}
            <th>Action</th>
            <th className="text-right">Amount</th>
            <th>Decision</th>
            <th>Outcome</th>
            {!compact && <th>Through</th>}
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap text-sm tabular-nums text-ink-muted">{dateTime(e.created_at, timeZone)}</td>
              {showAgent && (
                <td className="whitespace-nowrap">
                  <Link href={`/agents/${e.agent_id}`} className="font-medium text-ink hover:text-himal-700 hover:underline">
                    {agents.get(e.agent_id)?.name ?? "Unknown agent"}
                  </Link>
                </td>
              )}
              <td className="max-w-[18rem]">
                <Link href={`/activity/${e.id}`} className="block font-medium text-himal-800 hover:underline">
                  {eventTitle(e)}
                </Link>
                <span className="block truncate text-[13px] text-ink-muted" title={e.resource ?? e.tool}>
                  {e.tool}
                  {e.resource && e.action !== "ai.completion" ? ` · ${e.resource}` : ""}
                </span>
              </td>
              <td className="whitespace-nowrap text-right tabular-nums">
                {e.amount !== null ? money(e.amount, e.currency) : e.cost_usd > 0 ? <span className="text-ink-muted">{cost(e.cost_usd)}</span> : <span className="text-ink-muted">—</span>}
              </td>
              <td>
                <DecisionBadge decision={e.would_decision} observe={!!e.observe && e.would_decision !== "ALLOW"} />
              </td>
              <td>
                <StatusBadge status={e.status} />
              </td>
              {!compact && <td className="whitespace-nowrap text-sm text-ink-soft">
                <span className="inline-flex items-center gap-1.5" title={e.enforcement === "enforced" ? "Enforced: the action passes through AgentGuard" : "Cooperative: the agent asks before acting"}>
                  {e.enforcement === "enforced" ? <Lock className="h-3.5 w-3.5 text-himal-600" /> : <ShieldQuestion className="h-3.5 w-3.5 text-ink-muted" />}
                  {SOURCE_LABEL[e.source] ?? e.source}
                </span>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
