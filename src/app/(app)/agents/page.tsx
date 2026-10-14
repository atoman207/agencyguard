import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Plus } from "@/components/icons";
import { AgentStatusBadge, ModeBadge } from "@/components/badges";
import { CoverageBar } from "@/components/charts";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { cost, num, relative } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { agentStats, coverage } from "@/server/insights";
import { atLeast, listUsers } from "@/server/users";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const { org, user, now } = await requireSession();
  const stats = await agentStats(org, now);
  const cov = new Map((await coverage(org)).agents.map((a) => [a.agent.id, a.share]));
  const owners = new Map((await listUsers(org.id)).map((u) => [u.id, u.name]));
  const canEdit = atLeast(user.role, "admin");

  return (
    <>
      <PageHeader
        title="Agents"
        lead="One list of every agent your company runs, and who answers for each."
        actions={canEdit && <LinkButton href="/agents/new"><Plus className="h-4 w-4" />Register an agent</LinkButton>}
      />
      {stats.length === 0 ? (
        <Card>
          <EmptyState icon={<Bot className="h-6 w-6" />} title="No agents registered" body="Registering gives an agent an identity, an owner and a token. It takes a minute." action={canEdit && <LinkButton href="/agents/new">Register an agent</LinkButton>} />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {stats.map((s) => {
            const share = cov.get(s.agent.id);
            return (
              <Link key={s.agent.id} href={`/agents/${s.agent.id}`} className="group rounded-xl border border-line bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-himal-300 hover:shadow-lift">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-himal-50 text-himal-700">
                      <Bot className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-himal-900 group-hover:text-himal-700">{s.agent.name}</h2>
                      <p className="text-sm text-ink-muted">
                        {s.agent.platform} · {s.agent.environment} · {owners.get(s.agent.owner_user_id ?? "") ?? "No owner"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-2xl font-semibold leading-none text-himal-900">{s.health.score}</div>
                    <div className="mt-0.5 text-xs text-ink-muted">{s.health.label}</div>
                  </div>
                </div>
                {s.agent.purpose && <p className="mt-3 line-clamp-2 text-[15px] text-ink-soft">{s.agent.purpose}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <AgentStatusBadge status={s.agent.status} />
                  <ModeBadge mode={s.agent.mode} />
                </div>
                <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3 text-sm">
                  {[
                    ["Actions", num(s.actions)],
                    ["Asked", num(s.asked)],
                    ["Blocked", num(s.blocked)],
                    ["AI cost", cost(s.cost)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-ink-muted">{label}</dt>
                      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3">
                  <div className="mb-1.5 flex justify-between text-xs text-ink-muted">
                    <span>Coverage{share?.tools ? `: ${share.enforced}% enforced` : ""}</span>
                    <span>{s.lastSeen ? `Last seen ${relative(s.lastSeen, now)}` : "Never connected"}</span>
                  </div>
                  {share && <CoverageBar share={share} compact />}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
