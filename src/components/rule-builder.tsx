"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CircleAlert, FlaskConical, LoaderCircle, Plus, Trash2 } from "@/components/icons";
import { replayRuleAction, saveRuleAction } from "@/app/actions";
import { PendingContext, SubmitButton, submitTo, type ActionState } from "./forms";
import { buttonClass } from "./ui";
import { getAction } from "@/lib/catalog";
import { dateTime, money } from "@/lib/format";
import { EFFECT_LABELS, OP_LABELS, RULE_FIELDS, describeRule, fieldMeta } from "@/lib/rule-fields";
import type { Condition, Rule, RuleEffect } from "@/lib/types";
import type { ReplayResult } from "@/server/rules";

const EFFECTS: { value: RuleEffect; label: string; hint: string; ring: string }[] = [
  { value: "allow", label: "Allow it", hint: "Runs without a person", ring: "peer-checked:border-terai-500 peer-checked:bg-terai-50" },
  { value: "ask_human", label: "Ask a person", hint: "Waits for one approver", ring: "peer-checked:border-marigold-500 peer-checked:bg-marigold-50" },
  { value: "ask_two", label: "Ask two people", hint: "Two different approvers", ring: "peer-checked:border-marigold-500 peer-checked:bg-marigold-50" },
  { value: "block", label: "Block it", hint: "Never runs", ring: "peer-checked:border-simrik-500 peer-checked:bg-simrik-50" },
];

function blank(field = "action"): Condition {
  const meta = fieldMeta(field)!;
  const value = meta.type === "boolean" ? true : meta.type === "number" ? 100 : meta.type === "hours" ? "9-18" : (meta.options?.[0]?.value ?? "");
  return { field, op: meta.ops[0], value };
}

function Message({ state }: { state: ActionState }) {
  if (!state || state.ok || !state.message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-simrik-200 bg-simrik-50 px-3 py-2 text-sm font-medium text-simrik-800">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      {state.message}
    </p>
  );
}

export function RuleBuilder({ rule, agents, timeZone, canEdit }: { rule?: Rule; agents: { id: string; name: string }[]; timeZone: string; canEdit: boolean }) {
  const [conditions, setConditions] = useState<Condition[]>(rule?.conditions.length ? rule.conditions : [blank("action"), blank("amount")]);
  const [effect, setEffect] = useState<RuleEffect>(rule?.effect ?? "ask_human");
  const [saveState, saveAction, saving] = useActionState(saveRuleAction, null);
  const [replayState, replayAction, replaying] = useActionState(replayRuleAction, null);
  const replay = replayState?.ok ? (replayState.data?.replay as ReplayResult | undefined) : undefined;

  const update = (i: number, patch: Partial<Condition>) => setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const changeField = (i: number, field: string) => setConditions((cs) => cs.map((c, j) => (j === i ? blank(field) : c)));

  return (
    // One form, two actions: the clicked button says which. Fields keep their values either way.
    <form action={saveAction} onSubmit={submitTo((data) => (data.get("intent") === "replay" ? replayAction(data) : saveAction(data)))} className="grid gap-5 lg:grid-cols-3">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <input type="hidden" name="conditions" value={JSON.stringify(conditions)} />
      <input type="hidden" name="effect" value={effect} />

      <div className="space-y-5 lg:col-span-2">
        <section className="rounded-xl border border-line bg-card p-5 shadow-card">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="rule-name">Rule name</label>
              <input id="rule-name" name="name" className="field" defaultValue={rule?.name} placeholder="Large refunds need a manager" required />
            </div>
            <div>
              <label className="field-label" htmlFor="rule-agent">Applies to</label>
              <select id="rule-agent" name="agent" className="field" defaultValue={rule?.agent_id ?? ""}>
                <option value="">Every agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="field-label" htmlFor="rule-description">Note for your team (optional)</label>
            <input id="rule-description" name="description" className="field" defaultValue={rule?.description} />
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card shadow-card">
          <h2 className="border-b border-line px-5 py-3.5 text-base font-semibold">
            <span className="mr-2 rounded bg-himal-900 px-2 py-0.5 text-sm text-white">IF</span>all of these are true
          </h2>
          <ul className="divide-y divide-line">
            {conditions.map((c, i) => {
              const meta = fieldMeta(c.field)!;
              return (
                <li key={i} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center">
                  <select className="field" value={c.field} onChange={(e) => changeField(i, e.target.value)} aria-label="Field">
                    {RULE_FIELDS.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                  <select className="field" value={c.op} onChange={(e) => update(i, { op: e.target.value })} aria-label="Comparison">
                    {meta.ops.map((op) => (
                      <option key={op} value={op}>{OP_LABELS[op]}</option>
                    ))}
                  </select>
                  {meta.type === "boolean" ? (
                    <span className="text-sm text-ink-muted">no value needed</span>
                  ) : meta.options && c.op !== "matches" ? (
                    <select className="field" value={String(c.value)} onChange={(e) => update(i, { value: e.target.value })} aria-label="Value">
                      {meta.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="field"
                      type={meta.type === "number" ? "number" : "text"}
                      step="any"
                      value={String(c.value)}
                      placeholder={meta.type === "hours" ? "9-18" : c.op === "matches" ? "payment.*" : ""}
                      onChange={(e) => update(i, { value: meta.type === "number" ? Number(e.target.value) : e.target.value })}
                      aria-label="Value"
                    />
                  )}
                  <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove condition">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {meta.hint && <p className="text-xs text-ink-muted sm:col-span-4">{meta.hint}</p>}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line px-5 py-3">
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setConditions((cs) => [...cs, blank(cs.some((c) => c.field === "action") ? "amount" : "action")])}>
              <Plus className="h-4 w-4" />
              Add a condition
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card shadow-card">
          <h2 className="border-b border-line px-5 py-3.5 text-base font-semibold">
            <span className="mr-2 rounded bg-simrik-500 px-2 py-0.5 text-sm text-white">THEN</span>do this
          </h2>
          <div className="grid gap-3 p-5 sm:grid-cols-4">
            {EFFECTS.map((e) => (
              <label key={e.value} className="cursor-pointer">
                <input type="radio" className="peer sr-only" checked={effect === e.value} onChange={() => setEffect(e.value)} />
                <span className={`block rounded-xl border-2 border-line p-3 transition hover:border-line-strong ${e.ring}`}>
                  <span className="block font-semibold text-ink">{e.label}</span>
                  <span className="block text-[13px] text-ink-muted">{e.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="space-y-5">
        <section className="rounded-xl border border-himal-200 bg-himal-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-himal-700">The rule in plain words</h2>
          <p className="mt-2 font-display text-[17px] font-medium leading-snug text-himal-900">{describeRule(conditions, effect)}</p>
          <p className="mt-2 text-[13px] text-himal-800/80">When several rules match, the strictest wins. An allow rule only lifts the default caution; it never overrides a block, a limit or another ask.</p>
        </section>

        <section className="rounded-xl border border-line bg-card p-5 shadow-card">
          <h2 className="text-base font-semibold">Test before enforcing</h2>
          <p className="mt-1 text-sm text-ink-muted">Replays the last 7 days of real activity against this rule. Nothing is changed.</p>
          <button type="submit" name="intent" value="replay" disabled={replaying || saving} className={buttonClass("secondary", "md", "mt-3 w-full")}>
            {replaying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Replay on past activity
          </button>
          <div className="mt-3">
            <Message state={replayState} />
          </div>
          {replay && (
            <div className="mt-3 text-sm">
              <p className="text-ink-soft">
                Of <strong className="text-ink">{replay.total}</strong> actions, this rule matches <strong className="text-ink">{replay.matched}</strong>.{" "}
                {effect === "allow" ? (
                  "Those would no longer need the default approval."
                ) : (
                  <>
                    <strong className="text-ink">{replay.changed}</strong> of them would have had a stricter outcome than they did: {EFFECT_LABELS[effect]}.
                  </>
                )}
              </p>
              {replay.sample.length > 0 && (
                <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                  {replay.sample.map((s) => (
                    <li key={s.id} className="px-3 py-2">
                      <Link href={`/activity/${s.id}`} target="_blank" className="font-medium text-himal-700 hover:underline">
                        {getAction(s.action).label}
                        {s.amount !== null ? ` · ${money(s.amount, s.currency)}` : ""}
                      </Link>
                      <span className="block text-xs text-ink-muted">
                        {s.agent} · {dateTime(s.created_at, timeZone)} · was {s.was === "ALLOW" ? "allowed" : s.was === "BLOCK" ? "blocked" : "sent to a person"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-card p-5 shadow-card">
          <label className="flex items-start gap-3 text-[15px]">
            <input type="checkbox" name="enabled" defaultChecked={rule ? !!rule.enabled : true} className="mt-1 h-4 w-4 accent-himal-700" />
            <span>
              <span className="font-semibold">Enabled</span>
              <span className="block text-sm text-ink-muted">Switch off to keep a draft without applying it.</span>
            </span>
          </label>
          <div className="mt-4 space-y-3">
            <Message state={saveState} />
            {canEdit ? <PendingContext value={saving}><SubmitButton className="w-full" disabled={replaying}>{rule ? "Save rule" : "Create rule"}</SubmitButton></PendingContext> : <p className="text-sm text-ink-muted">Changing rules needs the admin role.</p>}
          </div>
        </section>
      </div>
    </form>
  );
}
