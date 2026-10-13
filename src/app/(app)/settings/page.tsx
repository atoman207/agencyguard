import type { Metadata } from "next";
import { Bell, Building2, Cpu, Hand, KeySquare, ShieldCheck, Trash2, Users } from "@/components/icons";
import { addMemberAction, changeRoleAction, removeMemberAction, revokeApiKeyAction } from "@/app/actions";
import { ApiKeyForm, AutoSubmitSelect } from "@/components/controls";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SettingsForm, Toggle } from "@/components/settings-form";
import { Badge, Callout, Card, CardHeader, Mono, PageHeader } from "@/components/ui";
import { dateTime, relative } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { listOutbox } from "@/server/notify";
import { atLeast, listApiKeys, listUsers, ROLES } from "@/server/users";

export const metadata: Metadata = { title: "Settings" };

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including members and settings",
  admin: "Agents, rules, limits, vault; can approve",
  approver: "Can approve or reject requests",
  viewer: "Read only",
};

export default async function SettingsPage() {
  const { org, user, now } = await requireSession();
  const s = org.settings;
  const owner = atLeast(user.role, "owner");
  const users = listUsers(org.id);
  const tz = s.timezone;
  const disabled = !owner;

  if (!atLeast(user.role, "admin")) {
    return (
      <>
        <PageHeader title="Settings" />
        <Callout tone="warn">Settings are visible to admins and owners. Your role is {user.role}.</Callout>
      </>
    );
  }
  const keys = owner ? listApiKeys(org.id) : [];
  const outbox = listOutbox(org.id, 10);

  return (
    <>
      <PageHeader title="Settings" lead={owner ? "Workspace-wide behaviour. Every change is written to the audit trail." : "You can read these settings. Only an owner can change them."} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Workspace" icon={<Building2 className="h-4 w-4" />} />
          <SettingsForm className="space-y-4 p-5">
            <div>
              <label className="field-label" htmlFor="org-name">Name</label>
              <input id="org-name" name="org_name" className="field" defaultValue={org.name} disabled={disabled} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="tz">Time zone</label>
                <input id="tz" name="s.timezone" className="field" defaultValue={s.timezone} disabled={disabled} />
                <p className="field-hint">Used for every time shown and for time-of-day rules. Default is Nepal Time.</p>
              </div>
              <div>
                <label className="field-label" htmlFor="default-mode">New agents start in</label>
                <select id="default-mode" name="s.defaultAgentMode" className="field" defaultValue={s.defaultAgentMode} disabled={disabled}>
                  <option value="observe">Observe mode</option>
                  <option value="enforce">Enforce mode</option>
                </select>
              </div>
            </div>
            {owner && <SubmitButton>Save</SubmitButton>}
          </SettingsForm>
        </Card>

        <Card>
          <CardHeader title="Approvals" hint="How long a request waits, and what happens when nobody answers." icon={<Hand className="h-4 w-4" />} />
          <SettingsForm className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="timeout">Wait for a decision (minutes)</label>
                <input id="timeout" name="s.approvalTimeoutMinutes#num" type="number" min="1" className="field" defaultValue={s.approvalTimeoutMinutes} disabled={disabled} />
              </div>
              <div>
                <label className="field-label" htmlFor="timeout-behaviour">If nobody decides</label>
                <select id="timeout-behaviour" name="s.timeoutBehaviour" className="field" defaultValue={s.timeoutBehaviour} disabled={disabled}>
                  <option value="reject">Reject safely</option>
                  <option value="escalate">Escalate once, then reject</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="two-person">Two approvers from this amount</label>
                <input id="two-person" name="s.twoPersonThreshold#numOrNull" type="number" min="1" className="field" defaultValue={s.twoPersonThreshold ?? ""} placeholder="Off" disabled={disabled} />
                <p className="field-hint">Leave empty to switch off.</p>
              </div>
              <div>
                <label className="field-label" htmlFor="dup-window">Duplicate window (hours)</label>
                <input id="dup-window" name="s.duplicateWindowHours#num" type="number" min="1" className="field" defaultValue={s.duplicateWindowHours} disabled={disabled} />
                <p className="field-hint">How long the same action counts as a repeat.</p>
              </div>
            </div>
            {owner && <SubmitButton>Save</SubmitButton>}
          </SettingsForm>
        </Card>

        <Card>
          <CardHeader title="Built-in protections" hint="These apply before any rule. Switching one off weakens every agent at once." icon={<ShieldCheck className="h-4 w-4" />} />
          <SettingsForm className="space-y-3.5 p-5">
            <Toggle name="unknownToolsAskHuman" defaultChecked={s.unknownToolsAskHuman} title="Unknown tools ask a person" hint="Until someone classifies a new tool, every call to it waits for approval." />
            <Toggle name="strictIrreversible" defaultChecked={s.strictIrreversible} title="Irreversible and high-risk actions need approval by default" hint="Unless a rule explicitly allows them." />
            <Toggle name="untrustedExfiltrationGuard" defaultChecked={s.untrustedExfiltrationGuard} title="Untrusted content guard" hint="Private data, plus untrusted content, plus sending outside: needs a person." />
            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="loop-rate">Pause after this many model calls a minute</label>
                <input id="loop-rate" name="s.loop.maxCallsPerMinute#num" type="number" min="1" className="field" defaultValue={s.loop.maxCallsPerMinute} disabled={disabled} />
              </div>
              <div>
                <label className="field-label" htmlFor="loop-same">Or the same request this many times</label>
                <input id="loop-same" name="s.loop.maxIdenticalCalls#num" type="number" min="2" className="field" defaultValue={s.loop.maxIdenticalCalls} disabled={disabled} />
                <p className="field-hint">Within five minutes.</p>
              </div>
            </div>
            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="fail-low">If AgentGuard is unreachable, low-risk actions</label>
                <select id="fail-low" name="s.failureBehaviour.lowRisk" className="field" defaultValue={s.failureBehaviour.lowRisk} disabled={disabled}>
                  <option value="continue">Continue</option>
                  <option value="wait">Wait</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="fail-high">High-risk actions</label>
                <select id="fail-high" name="s.failureBehaviour.highRisk" className="field" defaultValue={s.failureBehaviour.highRisk} disabled={disabled}>
                  <option value="wait">Wait</option>
                  <option value="continue">Continue</option>
                </select>
              </div>
            </div>
            <p className="text-[13px] text-ink-muted">The failure setting is a policy for your own agent code to follow when a cooperative check cannot reach AgentGuard. Enforced checkpoints simply cannot act without it.</p>
            {owner && <SubmitButton>Save</SubmitButton>}
          </SettingsForm>
        </Card>

        <Card>
          <CardHeader title="Notifications" hint="Where approval requests and alerts are sent." icon={<Bell className="h-4 w-4" />} />
          {owner ? (
            <SettingsForm className="space-y-4 p-5">
              <div>
                <label className="field-label" htmlFor="slack">Slack incoming webhook</label>
                <input id="slack" name="s.notifications.slackWebhookUrl" className="field" defaultValue={s.notifications.slackWebhookUrl} placeholder="https://hooks.slack.com/services/…" />
                <p className="field-hint">Approval requests are posted with a link to the review page. Deciding always happens there, after sign-in.</p>
              </div>
              <div>
                <label className="field-label" htmlFor="webhook">Webhook for your own systems</label>
                <input id="webhook" name="s.notifications.webhookUrl" className="field" defaultValue={s.notifications.webhookUrl} placeholder="https://example.com/agentguard" />
              </div>
              {s.notifications.webhookSecret && (
                <div className="rounded-lg bg-paper px-3 py-2 text-sm text-ink-soft">
                  Signing secret: <Mono>{s.notifications.webhookSecret}</Mono>
                  <label className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="s.notifications.rotateWebhookSecret#bool" value="false" />
                    <input type="checkbox" name="s.notifications.rotateWebhookSecret#bool" value="true" className="h-4 w-4 accent-himal-700" />
                    Replace it with a new secret
                  </label>
                </div>
              )}
              <SubmitButton>Save</SubmitButton>
            </SettingsForm>
          ) : (
            <p className="px-5 py-4 text-sm text-ink-muted">Slack: {s.notifications.slackWebhookUrl ? "connected" : "not connected"}. Webhook: {s.notifications.webhookUrl ? "set" : "not set"}.</p>
          )}
          <div className="border-t border-line px-5 py-4">
            <h3 className="text-sm font-semibold text-ink">Recent deliveries</h3>
            {outbox.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">Nothing sent yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {outbox.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft"><span className="font-medium capitalize text-ink">{o.channel}</span> · {o.kind}</span>
                    <span className="flex items-center gap-2 text-ink-muted">
                      <Badge tone={o.status === "sent" ? "good" : o.status === "failed" ? "danger" : "neutral"}>{o.status.replace("_", " ")}</Badge>
                      {relative(o.created_at, now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[13px] text-ink-muted">Email is not connected to a mail provider in this version; approval emails are recorded here as “not delivered”.</p>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="AI-model prices" hint="Used to turn tokens into cost at the gateway. Prices are per million tokens, in US dollars." icon={<Cpu className="h-4 w-4" />} />
        <SettingsForm className="grid gap-4 p-5 lg:grid-cols-[1fr_16rem]">
          <div>
            <label className="field-label" htmlFor="prices">One model per line: name, input price, output price</label>
            <textarea id="prices" name="s.modelPrices#prices" rows={5} className="field font-mono text-[13px]" defaultValue={s.modelPrices.map((p) => `${p.pattern}, ${p.inputPerM}, ${p.outputPerM}`).join("\n")} disabled={disabled} />
            <p className="field-hint">Use * as a wildcard, for example <code>my-model-*</code>. Only the built-in sandbox models are listed to begin with. Add the models you use with the rates on your own provider contract.</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="field-label" htmlFor="default-in">Any other model: input</label>
              <input id="default-in" name="s.defaultModelPrice.inputPerM#num" type="number" step="any" min="0" className="field" defaultValue={s.defaultModelPrice.inputPerM} disabled={disabled} />
            </div>
            <div>
              <label className="field-label" htmlFor="default-out">Any other model: output</label>
              <input id="default-out" name="s.defaultModelPrice.outputPerM#num" type="number" step="any" min="0" className="field" defaultValue={s.defaultModelPrice.outputPerM} disabled={disabled} />
            </div>
            {owner && <SubmitButton>Save</SubmitButton>}
          </div>
        </SettingsForm>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Members" hint="Only named, authorized people can approve. Roles decide who." icon={<Users className="h-4 w-4" />} />
        <div className="overflow-x-auto">
          <table className="ledger w-full min-w-[620px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.name}{u.id === user.id && <span className="ml-2 text-xs text-ink-muted">you</span>}</td>
                  <td className="text-sm text-ink-soft">{u.email}</td>
                  <td>
                    {owner ? (
                      <ActionForm action={changeRoleAction} quiet>
                        <input type="hidden" name="id" value={u.id} />
                        <AutoSubmitSelect name="role" defaultValue={u.role} className="field h-9 w-32 py-0 text-sm capitalize" aria-label={`Role of ${u.name}`}>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </AutoSubmitSelect>
                      </ActionForm>
                    ) : (
                      <Badge>{u.role}</Badge>
                    )}
                    <span className="mt-0.5 block text-xs text-ink-muted">{ROLE_HELP[u.role]}</span>
                  </td>
                  <td className="whitespace-nowrap text-sm text-ink-muted">{dateTime(u.created_at, tz)}</td>
                  <td className="text-right">
                    {owner && u.id !== user.id && (
                      <ActionForm action={removeMemberAction} quiet>
                        <input type="hidden" name="id" value={u.id} />
                        <SubmitButton variant="ghost" size="sm" aria-label={`Remove ${u.name}`} confirm={`Remove ${u.name} from this workspace?`}>
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
        {owner && (
          <ActionForm action={addMemberAction} resetOnSuccess className="border-t border-line p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_9rem_1fr_auto] lg:items-end">
              <div>
                <label className="field-label" htmlFor="member-name">Name</label>
                <input id="member-name" name="name" className="field" required />
              </div>
              <div>
                <label className="field-label" htmlFor="member-email">Email</label>
                <input id="member-email" name="email" type="email" className="field" required />
              </div>
              <div>
                <label className="field-label" htmlFor="member-role">Role</label>
                <select id="member-role" name="role" className="field capitalize" defaultValue="approver">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="member-password">Starting password</label>
                <input id="member-password" name="password" type="password" autoComplete="new-password" minLength={8} className="field" required />
              </div>
              <SubmitButton variant="secondary">Add member</SubmitButton>
            </div>
            <p className="field-hint">Invitation emails are not wired up yet, so you set a starting password and pass it on yourself.</p>
          </ActionForm>
        )}
      </Card>

      {owner && (
        <Card className="mt-5">
          <CardHeader title="API keys" hint="For the management API: registering agents, rules and limits from your own scripts. These keys cannot approve actions." icon={<KeySquare className="h-4 w-4" />} />
          {keys.length > 0 && (
            <ul className="divide-y divide-line">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span>
                    <span className="font-medium">{k.name}</span> <Mono>{k.prefix}…</Mono>
                    <span className="ml-2 text-sm text-ink-muted">created {dateTime(k.created_at, tz)}</span>
                  </span>
                  {k.revoked_at ? (
                    <Badge tone="danger">Revoked</Badge>
                  ) : (
                    <ActionForm action={revokeApiKeyAction} quiet>
                      <input type="hidden" name="id" value={k.id} />
                      <SubmitButton variant="secondary" size="sm" confirm={`Revoke the API key "${k.name}"?`}>Revoke</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line p-5">
            <ApiKeyForm />
          </div>
        </Card>
      )}

      <div className="mt-5">
        <Callout tone="info" title="Not in this version">
          Single sign-on, multi-factor sign-in, data-retention periods and automatic masking of stored personal data are planned and not built yet. Events and audit entries are kept until you delete the database.
        </Callout>
      </div>
    </>
  );
}
