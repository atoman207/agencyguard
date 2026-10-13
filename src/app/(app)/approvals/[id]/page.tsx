import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Check, CircleAlert, Clock, Database, Fingerprint, Lock, MessageSquareQuote, ShieldQuestion, X } from "@/components/icons";
import { decideApprovalAction } from "@/app/actions";
import { ApprovalBadge, ModeBadge, StatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Callout, Card, CardHeader, CodeBlock, Mono, PageHeader, Row } from "@/components/ui";
import { dateTime, fullDateTime, relative, shortHash } from "@/lib/format";
import { getAgent } from "@/server/agents";
import { canApprove, describeEvent, expireOverdue, getApproval } from "@/server/approvals";
import { requireSession } from "@/server/auth";
import { getEvent } from "@/server/events";
import { listUsers } from "@/server/users";
import type { Fact } from "@/lib/types";

export const metadata: Metadata = { title: "Review a request" };

const TONE: Record<NonNullable<Fact["tone"]>, string> = {
  neutral: "text-ink",
  good: "text-terai-700",
  warn: "text-marigold-800",
  danger: "text-simrik-700",
};

// This is the page every approval link opens: email, Slack and the inbox all
// lead here, behind login. Nothing is ever approved by following a link.
export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { org, user, now } = await requireSession();
  const { id } = await params;
  expireOverdue(org, now);
  const approval = getApproval(org.id, id);
  if (!approval) notFound();
  const event = getEvent(org.id, approval.event_id);
  if (!event) notFound();
  const agent = getAgent(org.id, approval.agent_id);
  const owner = listUsers(org.id).find((u) => u.id === agent?.owner_user_id);
  const tz = org.settings.timezone;
  const isResponse = approval.kind === "response";
  const mayDecide = canApprove(user.role);
  const already = approval.decisions.some((d) => d.user_id === user.id);
  const approvedCount = approval.decisions.filter((d) => d.decision === "approve").length;
  const enforced = event.enforcement === "enforced";

  // Facts are grouped by where they came from, source systems before our own records.
  const groups = new Map<string, Fact[]>();
  for (const f of approval.facts) groups.set(f.source, [...(groups.get(f.source) ?? []), f]);
  const why = approval.facts.filter((f) => f.label === "Why a person is needed");
  const factGroups = [...groups.entries()].map(([source, facts]) => [source, facts.filter((f) => f.label !== "Why a person is needed")] as const).filter(([, facts]) => facts.length);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/approvals" className="hover:underline">Approvals</Link>}
        title={isResponse ? `${agent?.name ?? "An agent"} wants to send a flagged reply` : `${agent?.name ?? "An agent"} wants to: ${describeEvent(event)}`}
        lead={`Asked ${fullDateTime(approval.created_at, tz)}`}
        actions={<ApprovalBadge status={approval.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="The facts"
              hint="Read directly from the source systems and from AgentGuard's own records. The agent cannot change these."
              icon={<Database className="h-4 w-4" />}
            />
            {factGroups.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">No source system is connected for this tool, so there are no independent facts. Rely on the exact parameters below.</p>
            ) : (
              factGroups.map(([source, facts]) => (
                <div key={source} className="border-b border-line last:border-b-0">
                  <div className="bg-paper/70 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">From {source}</div>
                  <dl>
                    {facts.map((f, i) => (
                      <div key={i} className="grid gap-1 border-t border-line px-5 py-3 first:border-t-0 sm:grid-cols-[14rem_1fr]">
                        <dt className="text-sm text-ink-muted">{f.label}</dt>
                        <dd className={`text-[15px] font-medium ${TONE[f.tone ?? "neutral"]}`}>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))
            )}
          </Card>

          {why.length > 0 && (
            <Card>
              <CardHeader title="Why this reached you" icon={<CircleAlert className="h-4 w-4" />} />
              <ul className="divide-y divide-line">
                {why.map((f, i) => (
                  <li key={i} className="px-5 py-3">
                    <div className="text-sm font-semibold text-ink">{f.source}</div>
                    <p className="text-sm text-ink-soft">{f.value}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {isResponse ? (
            <Card>
              <CardHeader title="The reply the agent wanted to send" hint="Personal data is masked. The customer has received the holding message instead." icon={<MessageSquareQuote className="h-4 w-4" />} />
              <blockquote className="m-5 rounded-xl border-l-4 border-marigold-400 bg-marigold-50 px-4 py-3 text-[15px] text-ink">{String(event.params.text ?? "")}</blockquote>
            </Card>
          ) : (
            <Card>
              <CardHeader title="The agent's explanation" hint="Written by the agent. It is not verified and may have been influenced by what the agent read." icon={<Bot className="h-4 w-4" />} />
              <p className="px-5 py-4 text-[15px] italic text-ink-soft">{approval.explanation ? `“${approval.explanation}”` : "The agent gave no explanation."}</p>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Exactly what will run"
              hint="Your approval is locked to these parameters by their fingerprint. If anything changes, this approval no longer applies."
              icon={<Fingerprint className="h-4 w-4" />}
            />
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <Mono>{event.tool}</Mono>
                {event.resource && <Mono>{event.resource}</Mono>}
                <span className="text-ink-muted">fingerprint</span>
                <Mono>{shortHash(approval.fingerprint)}</Mono>
              </div>
              <CodeBlock>{JSON.stringify(isResponse ? { findings: event.params.findings } : event.params, null, 2)}</CodeBlock>
              {enforced ? (
                <Callout tone="good" icon={<Lock className="h-5 w-5" />} title="Enforced">
                  {event.source === "vault" ? "On approval the vault executes exactly this action, once. The agent never holds the real key." : "This passes through an AgentGuard gateway. After approval the agent repeats the same call and it is forwarded once."}
                </Callout>
              ) : (
                <Callout tone="warn" icon={<ShieldQuestion className="h-5 w-5" />} title="Cooperative: AgentGuard checks the request but cannot guarantee what is finally executed">
                  This tool has no AgentGuard connector, so the agent performs the action itself after approval. A mismatch is detected and alerted if the agent reports it. Move the tool to the vault to enforce it.
                </Callout>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className={approval.status === "pending" ? "border-marigold-300 ring-1 ring-marigold-200" : ""}>
            <CardHeader title={approval.status === "pending" ? "Your decision" : "Decision"} />
            <div className="p-5">
              {approval.status === "pending" ? (
                <>
                  <div className="mb-4 flex items-center gap-2 text-sm text-ink-soft">
                    <Clock className="h-4 w-4 text-ink-muted" />
                    Expires {relative(approval.expires_at, now)}; then it is {org.settings.timeoutBehaviour === "escalate" && !approval.escalated_at ? "escalated" : "safely rejected"}.
                  </div>
                  {approval.required > 1 && (
                    <Callout tone="warn" title={`Two-person approval: ${approvedCount} of ${approval.required}`}>
                      Two different authorized people must approve.
                    </Callout>
                  )}
                  {!mayDecide ? (
                    <p className="mt-3 text-sm text-ink-muted">Your role is {user.role}. Only owners, admins and approvers can decide.</p>
                  ) : already ? (
                    <p className="mt-3 text-sm font-medium text-ink-soft">You have approved. A second person must confirm.</p>
                  ) : (
                    <ActionForm action={decideApprovalAction} className="mt-3">
                      <input type="hidden" name="id" value={approval.id} />
                      <label className="field-label" htmlFor="note">Note (optional, kept in the audit trail)</label>
                      <textarea id="note" name="note" rows={2} className="field" placeholder="Checked the order photos." />
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <SubmitButton name="decision" value="reject" variant="secondary"><X className="h-4 w-4" />Reject</SubmitButton>
                        <SubmitButton name="decision" value="approve" variant="success"><Check className="h-4 w-4" />Approve</SubmitButton>
                      </div>
                      <p className="mt-2 text-xs text-ink-muted">Deciding as {user.name}. Your identity comes from your sign-in, not from a link.</p>
                    </ActionForm>
                  )}
                </>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <ApprovalBadge status={approval.status} />
                    <StatusBadge status={event.status} />
                  </div>
                  {approval.status === "approved" && event.status === "executed" && (
                    <p className="font-medium text-terai-700">{event.source === "vault" ? "The vault executed exactly the approved action, once." : "The action ran and was reported back."}</p>
                  )}
                  {approval.status === "approved" && (event.status === "approved" || event.status === "allowed") && (
                    <p className="text-ink-soft">{isResponse ? "The reply is released. Your system is told through the approval.decided webhook." : "The agent may now proceed with exactly these parameters. It has not reported back yet."}</p>
                  )}
                  {approval.status === "approved" && event.status === "failed" && (
                    <p className="font-medium text-simrik-700">Approved, but the action failed: {(event.result as { error?: string } | null)?.error ?? "unknown error"}</p>
                  )}
                  {approval.status === "expired" && <p className="text-ink-soft">Nobody decided in time, so the request was safely rejected.</p>}
                  {approval.status === "rejected" && approval.decisions.length === 0 && <p className="text-ink-soft">Rejected automatically when the agent was stopped with the kill switch.</p>}
                </div>
              )}
              {approval.decisions.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-line pt-3">
                  {approval.decisions.map((d, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-semibold text-ink">{d.user_name}</span>{" "}
                      <span className={d.decision === "approve" ? "text-terai-700" : "text-simrik-700"}>{d.decision === "approve" ? "approved" : "rejected"}</span>
                      <span className="text-ink-muted"> · {dateTime(d.at, tz)} · {d.channel}</span>
                      {d.note && <p className="text-ink-soft">“{d.note}”</p>}
                    </li>
                  ))}
                </ul>
              )}
              {approval.status !== "pending" && (
                <Link href={`/activity/${event.id}`} className="mt-4 inline-block text-sm font-semibold text-himal-700 hover:underline">
                  See the action and its result
                </Link>
              )}
            </div>
          </Card>

          {agent && (
            <Card>
              <CardHeader title="The agent" />
              <dl>
                <Row label="Name"><Link href={`/agents/${agent.id}`} className="text-himal-700 hover:underline">{agent.name}</Link></Row>
                <Row label="Purpose"><span className="font-normal">{agent.purpose || "—"}</span></Row>
                <Row label="Responsible">{owner?.name ?? "Nobody"}</Row>
                <Row label="Environment"><span className="capitalize">{agent.environment}</span></Row>
                <Row label="Mode"><ModeBadge mode={agent.mode} /></Row>
              </dl>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
