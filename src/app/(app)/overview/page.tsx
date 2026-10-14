import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Ban, BellRing, Check, CircleDollarSign, Hand, Lightbulb, ListChecks, Sparkles } from "@/components/icons";
import { acknowledgeAlertsAction } from "@/app/actions";
import { AgentStatusBadge, ModeBadge } from "@/components/badges";
import { CoverageBar, DecisionColumns, HBars, Sparkline, StatTile } from "@/components/charts";
import { EventTable } from "@/components/event-table";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Callout, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { cost, longDate, money, num, relative } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { listEvents } from "@/server/events";
import { agentStats, coverage, journey, overview, recommendations } from "@/server/insights";
import { listAlerts } from "@/server/notify";
import { atLeast } from "@/server/users";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { user, org, now } = await requireSession();
  const tz = org.settings.timezone;
  const o = await overview(org, now);
  const stats = await agentStats(org, now);
  const cov = await coverage(org);
  const steps = await journey(org);
  const recs = await recommendations(org, now);
  const alerts = await listAlerts(org.id, { openOnly: true, limit: 5 });
  const recent = (await listEvents(org.id, { limit: 8 })).filter((e) => e.action !== "ai.completion" || e.would_decision === "BLOCK");
  const agents = new Map(stats.map((s) => [s.agent.id, s.agent]));
  const current = steps.findIndex((s) => !s.done);

  if (stats.length === 0) {
    return (
      <>
        <PageHeader eyebrow={longDate(now, tz)} title={`Namaste, ${user.name.split(" ")[0]}`} lead="Your workspace is ready. Connect a first agent in observe mode: it takes a few minutes and blocks nothing." />
        <Card>
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title="No agents yet"
            body="Register an agent to get a token, then point it at AgentGuard. Or open the playground to see the decision engine handle the classic failure cases."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton href="/agents/new">Register an agent</LinkButton>
                <LinkButton href="/playground" variant="secondary">Open the playground</LinkButton>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={longDate(now, tz)}
        title={`Namaste, ${user.name.split(" ")[0]}`}
        lead="What your agents did, said and spent over the last 7 days."
        actions={
          <>
            <LinkButton href="/playground" variant="secondary">Run a scenario</LinkButton>
            <LinkButton href="/agents/new">Register an agent</LinkButton>
          </>
        }
      />

      {o.pending > 0 && (
        <Link href="/approvals" className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-marigold-300 bg-marigold-100 px-5 py-3.5 text-marigold-900 shadow-card transition hover:bg-marigold-200/70">
          <span className="flex items-center gap-3 font-semibold">
            <span className="pulse-dot flex h-8 w-8 items-center justify-center rounded-full bg-marigold-500 text-himal-950">
              <Hand className="h-4 w-4" />
            </span>
            {o.pending} {o.pending === 1 ? "action is" : "actions are"} waiting for a person
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            Review <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Actions checked" value={num(o.actions)} icon={<ListChecks className="h-4 w-4 text-himal-500" />} note={`Plus ${num(o.aiCalls)} AI-model calls through the gateway`} />
        <StatTile
          label="Needed a person"
          value={num(o.asked)}
          icon={<Hand className="h-4 w-4 text-marigold-700" />}
          tone={o.pending > 0 ? "attention" : "plain"}
          note={o.pending > 0 ? `${o.pending} waiting right now` : "Nothing is waiting right now"}
        />
        <StatTile
          label="Blocked"
          value={num(o.blocked)}
          icon={<Ban className="h-4 w-4 text-simrik-500" />}
          note={o.observeFindings > 0 ? `${o.observeFindings} findings came from agents in observe mode and were not stopped` : "Includes limits, rules and the kill switch"}
        />
        <StatTile
          label="AI cost"
          value={cost(o.aiCost)}
          icon={<CircleDollarSign className="h-4 w-4 text-terai-600" />}
          trend={<Sparkline values={o.days.map((d) => d.cost)} label="AI cost per day, last 7 days" />}
          note={o.moneyMoved > 0 ? `${money(o.moneyMoved)} of business money moved by agents` : "No business money moved by agents"}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Decisions per day" hint="Every checked action, by what AgentGuard decided. Observe-mode agents count as what would have happened." />
          <div className="p-5">
            <DecisionColumns days={o.days} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Coverage" hint="How much of your agents' tool use AgentGuard can actually stop, weighted by risk." action={<Link href="/coverage" className="text-sm font-semibold text-himal-700 hover:underline">Details</Link>} />
          <div className="p-5">
            <div className="mb-3 flex items-baseline gap-2">
              <span className="font-display text-[2.6rem] font-semibold leading-none text-himal-900">{cov.total.enforced}%</span>
              <span className="text-sm text-ink-muted">enforced</span>
            </div>
            <CoverageBar share={cov.total} />
            {cov.gaps.length > 0 && (
              <p className="mt-4 border-t border-line pt-3 text-sm text-ink-soft">
                <strong className="text-ink">{cov.gaps.length} {cov.gaps.length === 1 ? "gap" : "gaps"} to close.</strong> Most important: {cov.gaps[0].row.name} on {cov.gaps[0].agent.name}.
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Your path to full control" hint="Each step is judged from this workspace's own state." />
        <ol className="grid gap-px overflow-hidden rounded-b-xl bg-line sm:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.id} className={`flex gap-3 p-4 ${i === current ? "bg-marigold-50" : "bg-white"}`}>
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  s.done ? "bg-terai-500 text-white" : i === current ? "bg-marigold-500 text-himal-950" : "bg-paper-deep text-ink-muted"
                }`}
              >
                {s.done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <div>
                <div className="font-display text-[15px] font-semibold text-himal-900">{s.name}</div>
                <div className="text-[13px] leading-snug text-ink-muted">{s.gain}</div>
                {i === current && <div className="mt-1 text-xs font-bold uppercase tracking-wide text-marigold-800">Next step</div>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recommended next" hint="Suggestions from real activity. Nothing changes until you accept one." icon={<Lightbulb className="h-4 w-4" />} />
          {recs.length === 0 ? (
            <EmptyState title="Nothing to recommend" body="Rules, budgets and coverage all look in order." />
          ) : (
            <ul className="divide-y divide-line">
              {recs.slice(0, 5).map((r, i) => (
                <li key={i} className="px-5 py-3.5">
                  <div className="font-semibold text-ink">{r.title}</div>
                  <p className="mt-0.5 text-sm text-ink-soft">{r.body}</p>
                  <Link href={r.href} className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-himal-700 hover:underline">
                    {r.cta} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Alerts"
            hint="Things that need eyes: loops, budgets, mismatches, suspicious content."
            icon={<BellRing className="h-4 w-4" />}
            action={
              alerts.length > 0 && atLeast(user.role, "approver") ? (
                <ActionForm action={acknowledgeAlertsAction} quiet>
                  <SubmitButton variant="secondary" size="sm">Mark all read</SubmitButton>
                </ActionForm>
              ) : undefined
            }
          />
          {alerts.length === 0 ? (
            <EmptyState title="No open alerts" body="AgentGuard raises one when an agent loops, hits a budget, or does something other than what was approved." />
          ) : (
            <ul className="divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-ink">{a.title}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={a.severity === "critical" ? "danger" : a.severity === "warning" ? "warn" : "neutral"}>
                        {a.severity === "critical" ? "Critical" : a.severity === "warning" ? "Warning" : "Info"}
                      </Badge>
                      {atLeast(user.role, "approver") && (
                        <ActionForm action={acknowledgeAlertsAction} quiet>
                          <input type="hidden" name="id" value={a.id} />
                          <SubmitButton variant="ghost" size="sm" aria-label={`Dismiss ${a.title}`}>
                            Dismiss
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-soft">{a.body}</p>
                  <div className="mt-1 flex gap-3 text-[13px] text-ink-muted">
                    <span>{relative(a.created_at, now)}</span>
                    {a.event_id && (
                      <Link href={`/activity/${a.event_id}`} className="font-semibold text-himal-700 hover:underline">
                        See what happened
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Agents" hint="Health combines failures, blocks, approvals and cost trend into one number." action={<Link href="/agents" className="text-sm font-semibold text-himal-700 hover:underline">All agents</Link>} />
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[560px]">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th className="text-right">Health</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.agent.id}>
                    <td>
                      <Link href={`/agents/${s.agent.id}`} className="font-semibold text-himal-800 hover:underline">{s.agent.name}</Link>
                      <span className="block text-[13px] text-ink-muted">{s.agent.platform} · {s.agent.environment}</span>
                    </td>
                    <td><ModeBadge mode={s.agent.mode} /></td>
                    <td><AgentStatusBadge status={s.agent.status} /></td>
                    <td className="text-right">
                      <span className="font-display text-lg font-semibold tabular-nums text-himal-900">{s.health.score}</span>
                      <span className="block text-xs text-ink-muted">{s.health.label}</span>
                    </td>
                    <td className="text-right tabular-nums">{num(s.actions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="AI cost by agent" hint="Last 7 days, measured at the gateway." />
          <div className="p-5">
            {stats.some((s) => s.cost > 0) ? (
              <HBars rows={[...stats].sort((a, b) => b.cost - a.cost).map((s) => ({ label: s.agent.name, value: s.cost, display: cost(s.cost) }))} />
            ) : (
              <p className="text-sm text-ink-muted">No model calls have gone through the gateway yet.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Latest activity" action={<Link href="/activity" className="text-sm font-semibold text-himal-700 hover:underline">Open the full log</Link>} />
        {recent.length ? <EventTable events={recent} agents={agents} timeZone={tz} /> : <EmptyState title="Nothing yet" body="Actions appear here the moment an agent is connected." />}
      </Card>

      {o.observeFindings > 0 && (
        <div className="mt-5">
          <Callout tone="info" title="Observe mode is honest, not safe">
            Agents in observe mode are recorded but never stopped. The numbers above include what would have been asked or blocked, so you can decide when to switch them to enforce.
          </Callout>
        </div>
      )}
    </>
  );
}
