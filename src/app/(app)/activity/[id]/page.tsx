import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Ban, Check, Hand } from "@/components/icons";
import { DecisionBadge, EnforcementBadge, RiskBadge, StatusBadge } from "@/components/badges";
import { SOURCE_LABEL, eventTitle } from "@/components/event-table";
import { Badge, Callout, Card, CardHeader, CodeBlock, LinkButton, Mono, PageHeader, Row } from "@/components/ui";
import { getAction } from "@/lib/catalog";
import { cost, dateTime, fullDateTime, money, shortHash } from "@/lib/format";
import { getAgent } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { runTimeline } from "@/server/engine";
import { getEvent } from "@/server/events";
import type { ActionEvent, AppliedRule } from "@/lib/types";

export const metadata: Metadata = { title: "Action" };

function RuleLine({ rule }: { rule: AppliedRule }) {
  const icon = rule.effect === "block" ? <Ban className="h-4 w-4 text-simrik-500" /> : rule.effect === "ask_human" ? <Hand className="h-4 w-4 text-marigold-700" /> : <Check className="h-4 w-4 text-terai-600" />;
  const kind = { rule: "Rule", limit: "Limit", builtin: "Built-in protection", permission: "Tool permission" }[rule.kind];
  return (
    <li className="flex gap-3 px-5 py-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {rule.kind === "rule" ? (
            <Link href={`/rules/${rule.id}`} className="font-semibold text-himal-800 hover:underline">{rule.name}</Link>
          ) : (
            <span className="font-semibold text-ink">{rule.name}</span>
          )}
          <span className="text-xs text-ink-muted">{kind}</span>
        </div>
        <p className="text-sm text-ink-soft">{rule.detail}</p>
      </div>
    </li>
  );
}

/** The event in the standard format from the roadmap (section 3.2). */
function standardEvent(e: ActionEvent) {
  return {
    event_id: e.id,
    agent_id: e.agent_id,
    source: e.source,
    enforcement: e.enforcement,
    action: e.action,
    resource: e.resource,
    params: e.params,
    params_fingerprint: e.params_fingerprint,
    idempotency_key: e.idempotency_key,
    untrusted_input_seen: !!e.untrusted_input_seen,
    risk: e.risk,
    decision: e.decision,
    rules: e.rules.filter((r) => r.effect !== "allow").map((r) => r.name),
  };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { org } = await requireSession();
  const { id } = await params;
  const e = getEvent(org.id, id);
  if (!e) notFound();
  const agent = getAgent(org.id, e.agent_id);
  const tz = org.settings.timezone;
  const type = getAction(e.action);
  const timeline = e.run_id ? runTimeline(org.id, e.run_id) : [];
  const observed = !!e.observe && e.would_decision !== "ALLOW";
  const mismatch = !!(e.result as { parameter_mismatch?: boolean } | null)?.parameter_mismatch;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/activity" className="hover:underline">Activity</Link>}
        title={eventTitle(e)}
        lead={`${agent?.name ?? "Unknown agent"} · ${fullDateTime(e.created_at, tz)}`}
        actions={
          <>
            <DecisionBadge decision={e.would_decision} observe={observed} />
            <StatusBadge status={e.status} />
          </>
        }
      />

      <div className="mb-5 space-y-3">
        {e.reason && (
          <Callout tone={e.would_decision === "BLOCK" ? "danger" : e.would_decision === "ASK_HUMAN" ? "warn" : "info"} title={observed ? "What would have happened (the agent is in observe mode, so nothing was stopped)" : "Why"}>
            {e.reason}
          </Callout>
        )}
        {mismatch && (
          <Callout tone="danger" title="Executed parameters differ from what was allowed">
            The agent reported running this with different parameters. This connection is cooperative, so AgentGuard could detect it but not prevent it.
          </Callout>
        )}
        {e.duplicate_of && (
          <Callout tone="info" title="Repeat of an earlier action">
            Same action as <Link href={`/activity/${e.duplicate_of}`} className="font-semibold underline">{e.duplicate_of}</Link>.
          </Callout>
        )}
        {e.approval_id && (
          <LinkButton href={`/approvals/${e.approval_id}`} variant="secondary">
            Open the approval <ArrowRight className="h-4 w-4" />
          </LinkButton>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Checks that applied" hint="Every rule, limit and built-in protection that matched this action. The strictest one decides." />
            {e.rules.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">Nothing matched. Low-risk, reversible actions are allowed by default.</p>
            ) : (
              <ul className="divide-y divide-line">
                {e.rules.map((r, i) => (
                  <RuleLine key={i} rule={r} />
                ))}
              </ul>
            )}
          </Card>

          {timeline.length > 1 && (
            <Card>
              <CardHeader title="Why did it do this?" hint="The whole run this action belongs to, step by step." />
              <ol className="relative px-5 py-4">
                {timeline.map((t, i) => (
                  <li key={t.id} className="relative flex gap-4 pb-4 last:pb-0">
                    {i < timeline.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line-strong" />}
                    <span
                      className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        t.id === e.id ? "bg-simrik-500 text-white ring-4 ring-simrik-100" : "bg-paper-deep text-ink-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/activity/${t.id}`} className={`font-medium hover:underline ${t.id === e.id ? "text-himal-900" : "text-himal-700"}`}>{eventTitle(t)}</Link>
                        <DecisionBadge decision={t.would_decision} observe={!!t.observe && t.would_decision !== "ALLOW"} />
                        {t.amount !== null && <span className="text-sm tabular-nums text-ink-soft">{money(t.amount, t.currency)}</span>}
                      </div>
                      <div className="text-[13px] text-ink-muted">
                        {dateTime(t.created_at, tz)} · {t.tool} · {SOURCE_LABEL[t.source]}
                        {t.untrusted_input_seen ? " · after reading untrusted content" : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card>
            <CardHeader title="Standard action event" hint="Every checkpoint translates what it sees into this one format, so rules are written once for all agents." />
            <div className="p-5">
              <CodeBlock>{JSON.stringify(standardEvent(e), null, 2)}</CodeBlock>
            </div>
          </Card>

          {e.result !== null && (
            <Card>
              <CardHeader title="Result" />
              <div className="p-5">
                <CodeBlock>{JSON.stringify(e.result, null, 2)}</CodeBlock>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl>
              <Row label="Agent">{agent ? <Link href={`/agents/${agent.id}`} className="text-himal-700 hover:underline">{agent.name}</Link> : "Unknown"}</Row>
              <Row label="Tool"><Mono>{e.tool}</Mono></Row>
              <Row label="Action type">{e.action === "unknown" ? "Not classified" : `${type.label}`}</Row>
              <Row label="Risk"><RiskBadge risk={e.risk} /></Row>
              <Row label="Can be undone">{e.action === "unknown" ? "Unknown" : type.reversible ? "Yes" : "No"}</Row>
              {e.resource && <Row label="Resource"><span className="break-all">{e.resource}</span></Row>}
              {e.amount !== null && <Row label="Amount">{money(e.amount, e.currency)}</Row>}
              {e.customer && <Row label="Customer">{e.customer}</Row>}
              {e.cost_usd > 0 && <Row label="AI cost">{cost(e.cost_usd)} <span className="font-normal text-ink-muted">({e.tokens_in} in, {e.tokens_out} out)</span></Row>}
              <Row label="Through">{SOURCE_LABEL[e.source]}</Row>
              <Row label="Protection"><EnforcementBadge level={e.enforcement} /></Row>
              {e.money_state !== "none" && <Row label="Money"><Badge tone={e.money_state === "settled" ? "good" : e.money_state === "reserved" ? "warn" : "neutral"}>{e.money_state}</Badge></Row>}
              {e.untrusted_input_seen ? <Row label="Untrusted content"><Badge tone="danger">Read before this</Badge></Row> : null}
              {e.run_id && <Row label="Run"><Link href={`/activity?run=${encodeURIComponent(e.run_id)}&show=all`} className="text-himal-700 hover:underline">{e.run_id}</Link></Row>}
              <Row label="Fingerprint"><Mono>{shortHash(e.params_fingerprint)}</Mono></Row>
              <Row label="Event ID"><Mono>{e.id}</Mono></Row>
            </dl>
          </Card>
          {e.explanation && (
            <Card>
              <CardHeader title="The agent's explanation" hint="Written by the agent. Not verified." />
              <p className="px-5 py-4 text-[15px] italic text-ink-soft">“{e.explanation}”</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
