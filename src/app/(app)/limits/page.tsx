import type { Metadata } from "next";
import { Gauge, Pencil, Trash2 } from "@/components/icons";
import { createLimitAction, deleteLimitAction, toggleLimitAction, updateLimitAction } from "@/app/actions";
import { AutoSubmitSwitch } from "@/components/controls";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LimitFields } from "@/components/limit-fields";
import { Badge, Callout, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { getAction } from "@/lib/catalog";
import { cost, money } from "@/lib/format";
import { listAgents } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { PERIOD_LABEL, limitUsage } from "@/server/limits";
import { atLeast } from "@/server/users";
import type { Limit } from "@/lib/types";

export const metadata: Metadata = { title: "Limits & budgets" };

const SCOPE_LABEL: Record<Limit["scope"], string> = {
  action: "a single action",
  customer: "each customer",
  resource: "each resource",
  agent: "each agent",
  organization: "the whole organization",
};

const amount = (l: Limit, n: number) => (l.kind === "cost" ? cost(n) : l.kind === "money" ? money(n) : n.toLocaleString("en-US"));

function describe(l: Limit, agentName?: string): string {
  const what = l.kind === "cost" ? "AI-model cost" : l.kind === "money" ? (l.action ? getAction(l.action).label.toLowerCase() : "money actions") : l.action ? `"${getAction(l.action).label.toLowerCase()}" actions` : "actions";
  const who = l.scope === "agent" && agentName ? agentName : SCOPE_LABEL[l.scope];
  const scope = agentName && l.scope !== "agent" ? ` (${agentName} only)` : "";
  if (l.period === "action") return `At most ${amount(l, l.value)} for ${who}${scope}: ${what}.`;
  return `At most ${amount(l, l.value)} of ${what} for ${who}${scope} ${PERIOD_LABEL[l.period]}.`;
}

/** The fill carries severity; the track is a lighter step of the same colour. */
function Meter({ used, limit }: { used: number; limit: Limit }) {
  const ratio = used / limit.value;
  const tone = ratio >= 1 ? ["bg-simrik-100", "bg-simrik-500"] : ratio >= 0.7 ? ["bg-marigold-100", "bg-marigold-500"] : ["bg-himal-100", "bg-himal-500"];
  return (
    <div className="mt-2 max-w-md">
      <div className={`h-2 overflow-hidden rounded-full ${tone[0]}`} role="img" aria-label={`${Math.round(ratio * 100)}% used`}>
        <div className={`h-full rounded-full ${tone[1]}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="mt-1 text-xs tabular-nums text-ink-muted">
        {amount(limit, used)} of {amount(limit, limit.value)} used ({Math.round(ratio * 100)}%)
      </div>
    </div>
  );
}

export default async function LimitsPage() {
  const { org, user, now } = await requireSession();
  const usage = limitUsage(org, now);
  const agents = listAgents(org.id);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const canEdit = atLeast(user.role, "admin");

  return (
    <>
      <PageHeader title="Limits & budgets" lead="Agents spend in two ways: AI-model usage and real business money. Limits cover both, per action and added up over time." />

      <Card>
        <CardHeader title="Active limits" hint="Windows are rolling: 'in any 7 days' means the last 7 days from the moment of each action." icon={<Gauge className="h-4 w-4" />} />
        {usage.length === 0 ? (
          <EmptyState title="No limits yet" body="Without limits, only rules stand between an agent and unlimited spend. Add one below or install a template under Rules." />
        ) : (
          <ul className="divide-y divide-line">
            {usage.map(({ limit: l, used }) => (
              <li key={l.id} className={`px-5 py-4 ${l.enabled ? "" : "bg-paper/60"}`}>
                <div className="flex flex-wrap items-center gap-4">
                  {canEdit ? (
                    <ActionForm action={toggleLimitAction} quiet>
                      <input type="hidden" name="id" value={l.id} />
                      <AutoSubmitSwitch name="enabled" defaultChecked={!!l.enabled} label={`${l.enabled ? "Disable" : "Enable"} ${l.name}`} />
                    </ActionForm>
                  ) : (
                    <Badge tone={l.enabled ? "good" : "neutral"}>{l.enabled ? "On" : "Off"}</Badge>
                  )}
                  <div className={`min-w-0 flex-1 ${l.enabled ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{l.name}</span>
                      <Badge tone={l.kind === "cost" ? "info" : l.kind === "money" ? "good" : "neutral"}>{l.kind === "cost" ? "AI cost" : l.kind === "money" ? "Business money" : "Count"}</Badge>
                      <Badge tone={l.on_exceed === "block" ? "danger" : "warn"}>{l.on_exceed === "block" ? "Blocks when reached" : "Asks a person when reached"}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">{describe(l, l.agent_id ? agentName.get(l.agent_id) : undefined)}</p>
                    {used !== null && l.enabled ? <Meter used={used} limit={l} /> : null}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <ActionForm action={deleteLimitAction} quiet>
                        <input type="hidden" name="id" value={l.id} />
                        <SubmitButton variant="ghost" size="sm" aria-label={`Delete ${l.name}`} confirm={`Delete the limit "${l.name}"?`}>
                          <Trash2 className="h-4 w-4" />
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </div>
                {canEdit && (
                  <details className="mt-3 rounded-lg border border-line bg-paper-deep/40 open:bg-white">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-himal-700 marker:content-none [&::-webkit-details-marker]:hidden">
                      <Pencil className="h-3.5 w-3.5" />
                      Edit limit
                    </summary>
                    <ActionForm action={updateLimitAction} className="border-t border-line p-4">
                      <input type="hidden" name="id" value={l.id} />
                      <LimitFields agents={agents} limit={l} />
                      <SubmitButton className="mt-4" size="sm">Save changes</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canEdit && (
        <Card className="mt-5">
          <CardHeader title="Add a limit" />
          <ActionForm action={createLimitAction} resetOnSuccess className="p-5">
            <LimitFields agents={agents} />
            <SubmitButton className="mt-4">Add limit</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Callout tone="info" title="Reserve, then settle">
          Like a card payment, an amount is reserved the moment an action is allowed or approved and settled when it completes. Two agents acting at the same time cannot both fit under a limit that only one fits under.
        </Callout>
        <Callout tone="warn" title="Honest limit">
          Money limits work on amounts AgentGuard can read: vault connectors, and any tool that sends an <code>amount</code>. Amounts are compared within one currency; there is no currency conversion.
        </Callout>
      </div>
    </>
  );
}
