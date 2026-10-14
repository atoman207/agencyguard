import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock, Hand, MessageSquareWarning, Users } from "@/components/icons";
import { ApprovalBadge } from "@/components/badges";
import { Badge, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { dateTime, money, relative } from "@/lib/format";
import { listAgents } from "@/server/agents";
import { countPending, describeEvent, expireOverdue, listApprovals } from "@/server/approvals";
import { requireSession } from "@/server/auth";
import { getEvent } from "@/server/events";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { org, now } = await requireSession();
  const tab = (await searchParams).tab === "history" ? "history" : "waiting";
  await expireOverdue(org, now);
  const approvals = await listApprovals(org.id, { status: tab === "waiting" ? "pending" : "decided", limit: 60 });
  const agents = new Map((await listAgents(org.id)).map((a) => [a.id, a]));
  const tz = org.settings.timezone;
  const rows = await Promise.all(approvals.map(async (a) => ({ approval: a, event: await getEvent(org.id, a.event_id) })));
  const listed = rows.filter((r): r is { approval: (typeof rows)[number]["approval"]; event: NonNullable<(typeof rows)[number]["event"]> } => !!r.event);

  return (
    <>
      <PageHeader title="Approvals" lead="Risky actions wait here until an authorized person decides. An approval covers one exact action; any change needs a new one." />
      <Tabs
        current={tab}
        tabs={[
          { id: "waiting", href: "/approvals", label: "Waiting", count: await countPending(org.id) },
          { id: "history", href: "/approvals?tab=history", label: "History" },
        ]}
      />

      {approvals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Hand className="h-6 w-6" />}
            title={tab === "waiting" ? "Nothing is waiting" : "No decisions yet"}
            body={tab === "waiting" ? "When a rule, a limit or an unknown tool sends an action to a person, it appears here and in Slack if connected." : "Decided requests appear here with who decided and why."}
          />
        </Card>
      ) : tab === "waiting" ? (
        <ul className="space-y-3">
          {listed.map(({ approval: a, event }) => {
            const done = a.decisions.filter((d) => d.decision === "approve").length;
            return (
              <li key={a.id}>
                <Link href={`/approvals/${a.id}`} className="group flex flex-wrap items-center gap-4 rounded-xl border border-marigold-200 bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-marigold-400 hover:shadow-lift">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marigold-100 text-marigold-800">
                    {a.kind === "response" ? <MessageSquareWarning className="h-5 w-5" /> : <Hand className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink-muted">{agents.get(a.agent_id)?.name ?? "Unknown agent"} wants to</div>
                    <div className="text-lg font-semibold text-himal-900">{a.kind === "response" ? "Send a reply that was flagged" : describeEvent(event)}</div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-ink-soft">{event.reason}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 text-sm">
                    {event.amount !== null && <span className="font-display text-xl font-semibold tabular-nums text-himal-900">{money(event.amount, event.currency)}</span>}
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Clock className="h-3.5 w-3.5" />
                      Asked {relative(a.created_at, now)}, expires {relative(a.expires_at, now)}
                    </span>
                    {a.required > 1 && (
                      <Badge tone="warn" icon={<Users className="h-3.5 w-3.5" />}>
                        {done} of {a.required} approvals
                      </Badge>
                    )}
                  </div>
                  <ArrowRight className="h-5 w-5 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-himal-700" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[720px]">
              <thead>
                <tr>
                  <th>Decided</th>
                  <th>Agent</th>
                  <th>Request</th>
                  <th className="text-right">Amount</th>
                  <th>Outcome</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {listed.map(({ approval: a, event }) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-sm tabular-nums text-ink-muted">{dateTime(a.decided_at ?? a.created_at, tz)}</td>
                      <td className="whitespace-nowrap font-medium">{agents.get(a.agent_id)?.name ?? "Unknown"}</td>
                      <td>
                        <Link href={`/approvals/${a.id}`} className="font-medium text-himal-800 hover:underline">
                          {a.kind === "response" ? "Flagged reply" : describeEvent(event)}
                        </Link>
                      </td>
                      <td className="text-right tabular-nums">{event.amount !== null ? money(event.amount, event.currency) : "—"}</td>
                      <td><ApprovalBadge status={a.status} /></td>
                      <td className="text-sm text-ink-soft">{a.decisions.map((d) => d.user_name).join(", ") || (a.status === "expired" ? "Nobody in time" : "Kill switch")}</td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
