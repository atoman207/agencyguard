import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyRound, OctagonX, Pause, Play, Trash2 } from "@/components/icons";
import { declareToolAction, deleteAgentAction, removeAgentToolAction, revokeTokenAction, setAgentStatusAction, setToolPermissionAction, updateAgentAction } from "@/app/actions";
import { AgentForm } from "@/components/agent-form";
import { AgentStatusBadge, ConnectionBadge, ModeBadge, RiskBadge } from "@/components/badges";
import { CoverageBar } from "@/components/charts";
import { AutoSubmitSelect, TokenForm } from "@/components/controls";
import { EventTable } from "@/components/event-table";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Callout, Card, CardHeader, EmptyState, LinkButton, Mono, PageHeader, Row } from "@/components/ui";
import { ACTIONS, getAction } from "@/lib/catalog";
import { cost, dateTime, fullDateTime, num, relative } from "@/lib/format";
import { getAgent, listTokens } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { listEvents } from "@/server/events";
import { agentStats, coverage } from "@/server/insights";
import { atLeast, listUsers } from "@/server/users";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { org, user, now } = await requireSession();
  const { id } = await params;
  const isNew = (await searchParams).new === "1";
  const agent = getAgent(org.id, id);
  if (!agent) notFound();

  const tz = org.settings.timezone;
  const canEdit = atLeast(user.role, "admin");
  const users = listUsers(org.id);
  const owner = users.find((u) => u.id === agent.owner_user_id);
  const stats = agentStats(org, now).find((s) => s.agent.id === id)!;
  const cov = coverage(org).agents.find((a) => a.agent.id === id)!;
  const tokens = listTokens(org.id, id);
  const liveTokens = tokens.filter((t) => !t.revoked_at && (!t.expires_at || t.expires_at > now));
  const events = listEvents(org.id, { agentId: id, hideModelCalls: true, limit: 10 });
  const agents = new Map([[agent.id, agent]]);
  // What it did before it was stopped: the last actions up to the moment of the kill.
  const beforeStop = agent.status !== "active" && agent.status_changed_at ? listEvents(org.id, { agentId: id, hideModelCalls: true, until: agent.status_changed_at + 1, limit: 8 }) : [];

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/agents" className="hover:underline">Agents</Link>}
        title={agent.name}
        lead={agent.purpose || undefined}
        actions={
          <>
            <AgentStatusBadge status={agent.status} />
            <ModeBadge mode={agent.mode} />
          </>
        }
      />

      {isNew && (
        <div className="mb-5">
          <Callout tone="good" title="Agent registered">
            Next: create a token below, then follow <Link href="/connect" className="font-semibold underline">Connect an agent</Link> for your platform. In observe mode nothing is blocked.
          </Callout>
        </div>
      )}

      {agent.status !== "active" && (
        <div className="mb-5">
          <Callout tone={agent.status === "killed" ? "danger" : "warn"} icon={agent.status === "killed" ? <OctagonX className="h-5 w-5" /> : <Pause className="h-5 w-5" />} title={agent.status === "killed" ? "This agent is stopped" : "This agent is paused"}>
            {agent.status_reason ? `${agent.status_reason} ` : ""}
            {agent.status_changed_at ? `Since ${fullDateTime(agent.status_changed_at, tz)}. ` : ""}
            {agent.status === "killed" ? "It is blocked at every checkpoint, its tokens are revoked and its pending requests were rejected. Reactivating does not restore old tokens." : "Every action is blocked until it is resumed."}
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {beforeStop.length > 0 && (
            <Card>
              <CardHeader title="What it did before it was stopped" hint="Its last actions up to the moment it was stopped." />
              <EventTable events={beforeStop} agents={agents} timeZone={tz} showAgent={false} compact />
            </Card>
          )}

          <Card>
            <CardHeader
              title="Tools and permissions"
              hint="What this agent uses, how each tool is connected, and what it may do. Unknown tools ask a person until classified."
            />
            {cov.rows.length === 0 ? (
              <EmptyState title="No tools seen yet" body="Tools appear here the first time the agent uses them through any checkpoint. You can also add one by hand below." />
            ) : (
              <div className="overflow-x-auto">
                <table className="ledger w-full min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Risk</th>
                      <th>Connected through</th>
                      <th>Permission</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {cov.rows.map((row) => (
                      <tr key={row.tool_id}>
                        <td>
                          <span className="font-medium text-ink">{row.name}</span>
                          <span className="block text-[13px] text-ink-muted">
                            {row.status === "confirmed" ? getAction(row.action).label : <Link href="/tools" className="font-semibold text-marigold-800 underline">Not classified yet</Link>}
                            {row.declared ? " · added by hand" : ""}
                          </span>
                        </td>
                        <td><RiskBadge risk={row.risk} /></td>
                        <td>
                          <ConnectionBadge connection={row.connection} />
                          {row.caveat && <span className="mt-1 block max-w-52 text-xs leading-snug text-ink-muted">{row.caveat}</span>}
                        </td>
                        <td>
                          {canEdit ? (
                            <ActionForm action={setToolPermissionAction} quiet>
                              <input type="hidden" name="agent" value={id} />
                              <input type="hidden" name="tool" value={row.tool_id} />
                              <AutoSubmitSelect name="permission" defaultValue={row.permission} className="field h-9 w-40 py-0 text-sm" aria-label={`Permission for ${row.name}`}>
                                <option value="default">Follow the rules</option>
                                <option value="allow">Always allow</option>
                                <option value="ask">Always ask</option>
                                <option value="deny">Never allow</option>
                              </AutoSubmitSelect>
                            </ActionForm>
                          ) : (
                            <Badge>{row.permission}</Badge>
                          )}
                        </td>
                        <td className="text-right">
                          {canEdit && (
                            <ActionForm action={removeAgentToolAction} quiet>
                              <input type="hidden" name="agent" value={id} />
                              <input type="hidden" name="tool" value={row.tool_id} />
                              <SubmitButton variant="ghost" size="sm" aria-label={`Remove ${row.name}`} confirm={`Remove ${row.name} from this agent's inventory?`}>
                                <Trash2 className="h-4 w-4" />
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && (
              <details className="border-t border-line px-5 py-4">
                <summary className="cursor-pointer text-sm font-semibold text-himal-700 hover:underline">Add a tool AgentGuard cannot see</summary>
                <p className="mt-2 text-sm text-ink-muted">If this agent holds its own API key or database login, add it here. It will count as not covered, so the gap is visible instead of hidden.</p>
                <ActionForm action={declareToolAction} resetOnSuccess className="mt-3">
                  <input type="hidden" name="agent" value={id} />
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_11rem_auto] sm:items-end">
                    <div>
                      <label className="field-label" htmlFor="tool-name">Tool name</label>
                      <input id="tool-name" name="name" className="field" placeholder="postgres (direct login)" required />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="tool-action">What it does</label>
                      <select id="tool-action" name="action" className="field" defaultValue="data.write">
                        {ACTIONS.map((a) => (
                          <option key={a.id} value={a.id}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="tool-connection">Connection</label>
                      <select id="tool-connection" name="connection" className="field" defaultValue="uncovered">
                        <option value="uncovered">Not covered</option>
                        <option value="cooperative">Cooperative check</option>
                      </select>
                    </div>
                    <SubmitButton variant="secondary">Add</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent activity" hint="Actions and replies. Routine model calls are in the full log." action={<LinkButton href={`/activity?agent=${id}`} variant="secondary" size="sm">Open in the log</LinkButton>} />
            {events.length ? <EventTable events={events} agents={agents} timeZone={tz} showAgent={false} compact /> : <EmptyState title="No activity yet" body="This agent has not sent anything through AgentGuard." />}
          </Card>

          <Card>
            <CardHeader title="Tokens" hint="The agent's identity towards AgentGuard. Scoped, expiring and revocable. Real tool keys stay in the vault." icon={<KeyRound className="h-4 w-4" />} />
            {tokens.length > 0 && (
              <div className="overflow-x-auto">
                <table className="ledger w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Scopes</th>
                      <th>Last used</th>
                      <th>State</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => {
                      const expired = !!t.expires_at && t.expires_at <= now;
                      return (
                        <tr key={t.id}>
                          <td>
                            <span className="font-medium">{t.name}</span>
                            <span className="block text-[13px] text-ink-muted"><Mono>{t.prefix}…</Mono></span>
                          </td>
                          <td className="text-sm text-ink-soft">{t.scopes.join(", ")}</td>
                          <td className="text-sm text-ink-muted">{t.last_used_at ? relative(t.last_used_at, now) : "Never"}</td>
                          <td>
                            {t.revoked_at ? <Badge tone="danger">Revoked</Badge> : expired ? <Badge>Expired</Badge> : <Badge tone="good">Active{t.expires_at ? ` until ${dateTime(t.expires_at, tz).split(",")[0]}` : ""}</Badge>}
                          </td>
                          <td className="text-right">
                            {canEdit && !t.revoked_at && !expired && (
                              <ActionForm action={revokeTokenAction} quiet>
                                <input type="hidden" name="id" value={t.id} />
                                <SubmitButton variant="secondary" size="sm" confirm={`Revoke the token "${t.name}"? The agent using it will be refused at once.`}>Revoke</SubmitButton>
                              </ActionForm>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && agent.status !== "killed" && (
              <div className="border-t border-line p-5">
                <TokenForm agentId={id} />
              </div>
            )}
            {agent.status === "killed" && <p className="border-t border-line px-5 py-4 text-sm text-ink-muted">Reactivate the agent before issuing new tokens.</p>}
          </Card>
        </div>

        <div className="space-y-5">
          {canEdit && (
            <Card className={agent.status === "active" ? "border-simrik-200" : ""}>
              <CardHeader title="Controls" />
              <div className="space-y-3 p-5">
                {agent.status === "active" ? (
                  <>
                    <ActionForm action={setAgentStatusAction}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="status" value="paused" />
                      <SubmitButton variant="secondary" className="w-full"><Pause className="h-4 w-4" />Pause</SubmitButton>
                    </ActionForm>
                    <ActionForm action={setAgentStatusAction} className="rounded-xl border border-simrik-200 bg-simrik-50 p-3">
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="status" value="killed" />
                      <label className="field-label" htmlFor="kill-reason">Reason (kept in the audit trail)</label>
                      <input id="kill-reason" name="reason" className="field" placeholder="Sending wrong refunds" />
                      <SubmitButton variant="danger" className="mt-3 w-full" confirm={`Stop ${agent.name} everywhere? Its ${liveTokens.length} active ${liveTokens.length === 1 ? "token" : "tokens"} will be revoked and pending requests rejected.`}>
                        <OctagonX className="h-4 w-4" />
                        Kill switch
                      </SubmitButton>
                      <p className="mt-2 text-[13px] leading-snug text-simrik-800">Blocks the agent at every AgentGuard checkpoint at once and revokes its vault access.</p>
                    </ActionForm>
                  </>
                ) : (
                  <ActionForm action={setAgentStatusAction}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="status" value="active" />
                    <SubmitButton variant="success" className="w-full"><Play className="h-4 w-4" />{agent.status === "killed" ? "Reactivate" : "Resume"}</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={deleteAgentAction} className="border-t border-line pt-3">
                  <input type="hidden" name="id" value={id} />
                  <SubmitButton variant="ghost" className="w-full text-simrik-700 hover:bg-simrik-50" confirm={`Permanently delete ${agent.name}? Activity history stays in the audit trail, but tokens and tool links are removed.`}>
                    <Trash2 className="h-4 w-4" />
                    Delete agent
                  </SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Health" hint="Last 7 days." />
            <div className="p-5">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[2.6rem] font-semibold leading-none text-himal-900">{stats.health.score}</span>
                <span className="text-sm text-ink-muted">{stats.health.label}</span>
              </div>
              {stats.health.parts.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {stats.health.parts.map((p) => (
                    <li key={p.label} className="flex justify-between gap-3">
                      <span className="text-ink-soft">{p.label}<span className="block text-xs text-ink-muted">{p.detail}</span></span>
                      <span className="font-semibold tabular-nums text-simrik-600">−{p.penalty}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">Nothing is pulling the score down.</p>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                <div><dt className="text-xs text-ink-muted">Actions</dt><dd className="font-semibold tabular-nums">{num(stats.actions)}</dd></div>
                <div><dt className="text-xs text-ink-muted">AI cost</dt><dd className="font-semibold tabular-nums">{cost(stats.cost)}</dd></div>
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader title="Coverage" />
            <div className="p-5"><CoverageBar share={cov.share} /></div>
          </Card>

          <Card>
            <CardHeader title="Identity" />
            <dl>
              <Row label="Responsible">{owner?.name ?? "Nobody"}</Row>
              <Row label="Built with">{agent.platform}</Row>
              <Row label="Environment"><span className="capitalize">{agent.environment}</span></Row>
              <Row label="Private data">{agent.handles_private_data ? "Can reach it" : "No"}</Row>
              <Row label="Reply checks">{agent.check_responses ? "On" : "Off"}</Row>
              <Row label="Registered">{dateTime(agent.created_at, tz)}</Row>
              <Row label="Agent ID"><Mono>{agent.id}</Mono></Row>
            </dl>
            {canEdit && (
              <details className="border-t border-line px-5 py-4">
                <summary className="cursor-pointer text-sm font-semibold text-himal-700 hover:underline">Edit details and mode</summary>
                <div className="mt-4">
                  <AgentForm action={updateAgentAction} agent={agent} users={users} defaultMode={agent.mode} submit="Save changes" />
                </div>
              </details>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
