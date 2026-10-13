"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, Ban, Check, CircleAlert, CopyCheck, Hand, Info, LoaderCircle, Play } from "@/components/icons";
import { runScenarioAction } from "@/app/actions";
import { buttonClass } from "./ui";
import type { Scenario, ScenarioStep } from "@/server/scenarios";

const LOOK: Record<ScenarioStep["outcome"], { icon: typeof Check; ring: string; label: string }> = {
  allow: { icon: Check, ring: "bg-terai-100 text-terai-600", label: "Allowed" },
  block: { icon: Ban, ring: "bg-simrik-100 text-simrik-700", label: "Blocked" },
  pending: { icon: Hand, ring: "bg-marigold-100 text-marigold-800", label: "Waiting for a person" },
  duplicate: { icon: CopyCheck, ring: "bg-himal-100 text-himal-700", label: "Duplicate" },
  info: { icon: Info, ring: "bg-paper-deep text-ink-muted", label: "" },
  error: { icon: CircleAlert, ring: "bg-simrik-100 text-simrik-700", label: "Error" },
};

function ScenarioCard({ scenario, canRun }: { scenario: Scenario; canRun: boolean }) {
  const [state, action, pending] = useActionState(runScenarioAction, null);
  const steps = state?.ok ? ((state.data?.steps as ScenarioStep[] | undefined) ?? []) : [];

  return (
    <section className="flex flex-col rounded-xl border border-line bg-card shadow-card">
      <div className="flex flex-1 flex-col p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-simrik-600">{scenario.checkpoint}</div>
        <h3 className="mt-1 text-lg font-semibold text-himal-900">{scenario.title}</h3>
        <p className="mt-1 flex-1 text-[15px] text-ink-soft">{scenario.story}</p>
        <form action={action} className="mt-4">
          <input type="hidden" name="scenario" value={scenario.id} />
          <button type="submit" disabled={pending || !canRun} className={buttonClass(steps.length ? "secondary" : "primary")}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {steps.length ? "Run again" : "Run"}
          </button>
        </form>
        {state && !state.ok && state.message && (
          <p role="alert" className="mt-3 rounded-lg border border-simrik-200 bg-simrik-50 px-3 py-2 text-sm font-medium text-simrik-800">
            {state.message}
          </p>
        )}
      </div>
      {steps.length > 0 && (
        <ol className="rise border-t border-line bg-paper/60 px-5 py-4" aria-live="polite">
          {steps.map((s, i) => {
            const look = LOOK[s.outcome];
            const Icon = look.icon;
            return (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                {i < steps.length - 1 && <span className="absolute left-[13px] top-7 h-full w-px bg-line-strong" />}
                <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${look.ring}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <div className="text-[15px] font-semibold text-ink">
                    {s.label}
                    {look.label && <span className="ml-2 text-xs font-bold uppercase tracking-wide text-ink-muted">{look.label}</span>}
                  </div>
                  <p className="text-sm text-ink-soft">{s.detail}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-sm font-semibold">
                    {s.approvalId && (
                      <Link href={`/approvals/${s.approvalId}`} className="inline-flex items-center gap-1 text-himal-700 hover:underline">
                        Open the approval <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                    {s.eventId && (
                      <Link href={`/activity/${s.eventId}`} className="inline-flex items-center gap-1 text-himal-700 hover:underline">
                        See the record <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function Playground({ scenarios, canRun }: { scenarios: Scenario[]; canRun: boolean }) {
  return (
    <div className="grid items-start gap-5 md:grid-cols-2">
      {scenarios.map((s) => (
        <ScenarioCard key={s.id} scenario={s} canRun={canRun} />
      ))}
    </div>
  );
}
