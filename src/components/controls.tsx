"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ComponentProps } from "react";
import { RefreshCw } from "@/components/icons";
import { createApiKeyAction, createTokenAction } from "@/app/actions";
import { ActionForm, OneTimeSecret, SubmitButton } from "./forms";

/** A select that submits its form as soon as the choice changes. */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** A checkbox styled as a switch that submits its form when toggled. */
export function AutoSubmitSwitch({ name, defaultChecked, label, disabled }: { name: string; defaultChecked: boolean; label: string; disabled?: boolean }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center" title={label}>
      <input type="hidden" name={name} value="false" />
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} disabled={disabled} aria-label={label} className="peer sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
      <span className="h-6 w-11 rounded-full bg-line-strong transition peer-checked:bg-terai-500 peer-focus-visible:ring-2 peer-focus-visible:ring-himal-300 peer-disabled:opacity-50" />
      <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
    </label>
  );
}

/** A filter control that writes its value into the URL query string. */
export function QuerySelect({ name, value, options, label }: { name: string; value: string; options: { value: string; label: string }[]; label: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
      {label}
      <select
        className="field h-10 min-w-36 py-0 text-[15px] font-normal normal-case tracking-normal"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          next.delete("page");
          router.push(`?${next.toString()}`);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TokenForm({ agentId }: { agentId: string }) {
  return (
    <ActionForm
      action={createTokenAction}
      resetOnSuccess
      result={(data) => <OneTimeSecret value={String(data.token)} note="Copy this token now. Only its hash is stored, so it cannot be shown again." />}
    >
      <input type="hidden" name="agent" value={agentId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <div>
          <label className="field-label" htmlFor="token-name">Name</label>
          <input id="token-name" name="name" className="field" placeholder="Production" required />
        </div>
        <div>
          <label className="field-label" htmlFor="token-scopes">Scopes</label>
          <input id="token-scopes" name="scopes" className="field" placeholder="* (everything)" />
        </div>
        <div>
          <label className="field-label" htmlFor="token-expires">Expires</label>
          <select id="token-expires" name="expires" className="field" defaultValue="90">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="0">Never</option>
          </select>
        </div>
        <SubmitButton>Create token</SubmitButton>
      </div>
      <p className="field-hint">Scopes limit what the token may do, for example <code>payment.* order.read ai.completion</code>. Leave empty for everything.</p>
    </ActionForm>
  );
}

export function ApiKeyForm() {
  return (
    <ActionForm action={createApiKeyAction} resetOnSuccess result={(data) => <OneTimeSecret value={String(data.key)} note="Copy this key now. It cannot be shown again." />}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className="field-label" htmlFor="key-name">Key name</label>
          <input id="key-name" name="name" className="field" placeholder="Deployment script" required />
        </div>
        <SubmitButton>Create API key</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Re-reads the page from the server every few seconds while switched on. */
export function LiveRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [on, seconds, router]);
  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      aria-pressed={on}
      className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[15px] font-semibold transition ${on ? "border-terai-300 bg-terai-50 text-terai-700" : "border-line-strong bg-white text-ink-soft hover:border-himal-300"}`}
    >
      <RefreshCw className={`h-4 w-4 ${on ? "animate-spin [animation-duration:3s]" : ""}`} />
      {on ? "Live" : "Go live"}
    </button>
  );
}
