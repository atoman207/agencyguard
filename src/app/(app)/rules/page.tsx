import type { Metadata } from "next";
import Link from "next/link";
import { Check, LayoutTemplate, ListChecks, Plus, Trash2 } from "@/components/icons";
import { deleteRuleAction, installTemplateAction, toggleRuleAction, uninstallTemplateAction } from "@/app/actions";
import { AutoSubmitSwitch } from "@/components/controls";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Callout, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { describeRule } from "@/lib/rule-fields";
import { listAgents } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { listRules } from "@/server/rules";
import { installedTemplates, loadTemplatePacks } from "@/server/templates";
import { atLeast } from "@/server/users";
import type { RuleEffect } from "@/lib/types";

export const metadata: Metadata = { title: "Rules" };

const EFFECT: Record<RuleEffect, { tone: "good" | "warn" | "danger"; label: string }> = {
  allow: { tone: "good", label: "Allow" },
  ask_human: { tone: "warn", label: "Ask a person" },
  ask_two: { tone: "warn", label: "Ask two people" },
  block: { tone: "danger", label: "Block" },
};

export default async function RulesPage() {
  const { org, user } = await requireSession();
  const rules = await listRules(org.id);
  const agents = await listAgents(org.id);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const catalog = await loadTemplatePacks();
  const installed = await installedTemplates(org.id);
  const canEdit = atLeast(user.role, "admin");
  const s = org.settings;

  return (
    <>
      <PageHeader
        title="Rules"
        lead="Simple if-then rules, written once and applied to every agent on every platform."
        actions={canEdit && <LinkButton href="/rules/new"><Plus className="h-4 w-4" />New rule</LinkButton>}
      />

      <Card>
        <CardHeader title="Your rules" hint="When several match, the strictest wins: block, then ask, then allow." icon={<ListChecks className="h-4 w-4" />} />
        {rules.length === 0 ? (
          <EmptyState title="No rules yet" body="Start from a template below, or write your own. Until then, the built-in protections apply." />
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-4 px-5 py-3.5 ${r.enabled ? "" : "bg-paper/60"}`}>
                {canEdit ? (
                  <ActionForm action={toggleRuleAction} quiet>
                    <input type="hidden" name="id" value={r.id} />
                    <AutoSubmitSwitch name="enabled" defaultChecked={!!r.enabled} label={`${r.enabled ? "Disable" : "Enable"} ${r.name}`} />
                  </ActionForm>
                ) : (
                  <Badge tone={r.enabled ? "good" : "neutral"}>{r.enabled ? "On" : "Off"}</Badge>
                )}
                <div className={`min-w-0 flex-1 ${r.enabled ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/rules/${r.id}`} className="font-semibold text-himal-800 hover:underline">{r.name}</Link>
                    <Badge tone={EFFECT[r.effect].tone}>{EFFECT[r.effect].label}</Badge>
                    {r.agent_id && <Badge tone="info">{agentName.get(r.agent_id) ?? "One agent"} only</Badge>}
                    {r.template && <span className="text-xs text-ink-muted">from a template</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-soft">{describeRule(r.conditions, r.effect)}</p>
                </div>
                {canEdit && (
                  <ActionForm action={deleteRuleAction} quiet>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton variant="ghost" size="sm" aria-label={`Delete ${r.name}`} confirm={`Delete the rule "${r.name}"?`}>
                      <Trash2 className="h-4 w-4" />
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader title="Built-in protections" hint="These apply before any rule you write. Owners change them under Settings." />
        <ul className="grid gap-px bg-line sm:grid-cols-2">
          {[
            [s.unknownToolsAskHuman, "Unknown tools ask a person", "A tool nobody has classified is not trusted."],
            [s.strictIrreversible, "Irreversible actions are strict by default", "Sending money, deleting data and publishing need approval unless a rule allows them."],
            [s.untrustedExfiltrationGuard, "Untrusted content guard", "An agent that has read outside content and can reach private data needs a person to send anything out."],
            [true, "Duplicate protection", `The same action cannot run twice within ${s.duplicateWindowHours} hours, even if the agent retries.`],
            [s.twoPersonThreshold !== null, "Two-person approval", s.twoPersonThreshold !== null ? `Any action of ${s.twoPersonThreshold.toLocaleString("en-US")} or more needs two approvers.` : "Off. Only rules can ask for two approvers."],
            [true, "Risk checks only raise risk", "No automated check can lower the risk of an action, so an attacker cannot talk it down."],
          ].map(([on, title, body], i) => (
            <li key={i} className="flex gap-3 bg-white px-5 py-3.5 last:rounded-b-xl">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${on ? "bg-terai-500 text-white" : "bg-line-strong text-white"}`}>
                <Check className="h-3 w-3" />
              </span>
              <div>
                <div className="font-semibold text-ink">{title as string}{!on && <span className="ml-2 text-xs font-normal text-ink-muted">switched off</span>}</div>
                <p className="text-sm text-ink-muted">{body as string}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-himal-900">
          <LayoutTemplate className="h-5 w-5 text-himal-700" />
          Template packs
        </h2>
        <Badge tone="neutral">Built-in packs</Badge>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {catalog.packs.map((pack) => (
          <Card key={pack.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-himal-900">{pack.name}</h3>
                <p className="text-sm text-ink-muted">{pack.audience}</p>
              </div>
              {installed.has(pack.id) && <Badge tone="good" icon={<Check className="h-3.5 w-3.5" />}>Installed</Badge>}
            </div>
            <p className="mt-2 text-[15px] text-ink-soft">{pack.description}</p>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm text-ink-soft">
              {pack.rules.map((r) => (
                <li key={r.name} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-himal-400" />
                  {describeRule(r.conditions as never, r.effect)}
                </li>
              ))}
              {pack.limits.map((l) => (
                <li key={l.name} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-marigold-500" />
                  Limit: {l.name.toLowerCase()} ({l.kind === "cost" ? "$" : ""}{l.value.toLocaleString("en-US")})
                </li>
              ))}
            </ul>
            {canEdit && !installed.has(pack.id) && (
              <ActionForm action={installTemplateAction} className="mt-4 border-t border-line pt-4">
                <input type="hidden" name="template" value={pack.id} />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-40 flex-1">
                    <label className="field-label" htmlFor={`agent-${pack.id}`}>Apply to</label>
                    <select id={`agent-${pack.id}`} name="agent" className="field">
                      <option value="">Every agent</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <SubmitButton variant="secondary">Install</SubmitButton>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
                  <input type="checkbox" name="enable" className="h-4 w-4 accent-himal-700" />
                  Enable the rules straight away (otherwise they install switched off, ready to replay)
                </label>
              </ActionForm>
            )}
            {canEdit && installed.has(pack.id) && (
              <ActionForm action={uninstallTemplateAction} className="mt-4 border-t border-line pt-4">
                <input type="hidden" name="template" value={pack.id} />
                <SubmitButton variant="ghost" className="text-simrik-700 hover:bg-simrik-50" confirm={`Remove "${pack.name}" and delete the rules and limits it installed?`}>
                  Uninstall pack
                </SubmitButton>
              </ActionForm>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Callout tone="info" title="Rules in this MVP">
          Rules are evaluated by a small built-in engine. The roadmap names OPA or Cedar as the production rule engine; the rule format here is simple enough to translate.
        </Callout>
      </div>
    </>
  );
}
