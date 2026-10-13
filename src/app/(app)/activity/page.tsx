import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText, Search } from "@/components/icons";
import { LiveRefresh, QuerySelect } from "@/components/controls";
import { EventTable, SOURCE_LABEL } from "@/components/event-table";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { num } from "@/lib/format";
import { listAgents } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { countEvents, listEvents, type EventFilters } from "@/server/events";

export const metadata: Metadata = { title: "Activity" };

const PAGE = 40;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { org } = await requireSession();
  const sp = await searchParams;
  const agents = listAgents(org.id);
  const page = Math.max(1, Number(sp.page) || 1);
  const show = sp.show ?? "actions";
  const filters: EventFilters = {
    agentId: sp.agent || undefined,
    decision: sp.decision || undefined,
    source: sp.source || undefined,
    runId: sp.run || undefined,
    q: sp.q?.trim() || undefined,
    hideModelCalls: show === "actions",
    action: show === "model" ? "ai.completion" : undefined,
  };
  const total = countEvents(org.id, filters);
  const events = listEvents(org.id, { ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };

  return (
    <>
      <PageHeader title="Activity" lead="Every action and reply your agents attempted: what was called, with what data, the result, the cost and which rule applied." actions={<LiveRefresh />} />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <QuerySelect name="agent" label="Agent" value={sp.agent ?? ""} options={[{ value: "", label: "All agents" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          <QuerySelect
            name="decision"
            label="Decision"
            value={sp.decision ?? ""}
            options={[
              { value: "", label: "Any decision" },
              { value: "ALLOW", label: "Allowed" },
              { value: "ASK_HUMAN", label: "Asked a person" },
              { value: "BLOCK", label: "Blocked" },
            ]}
          />
          <QuerySelect name="source" label="Through" value={sp.source ?? ""} options={[{ value: "", label: "Any checkpoint" }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))]} />
          <QuerySelect
            name="show"
            label="Show"
            value={show}
            options={[
              { value: "actions", label: "Actions and replies" },
              { value: "model", label: "AI-model calls" },
              { value: "all", label: "Everything" },
            ]}
          />
          <form className="flex min-w-56 flex-1 items-end gap-2" action="/activity">
            {(["agent", "decision", "source", "show"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
            <label className="flex flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Search
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Tool, customer, charge, event ID" className="field h-10 py-0 font-normal normal-case tracking-normal" />
            </label>
            <button type="submit" className={buttonClass("secondary")} aria-label="Search">
              <Search className="h-4 w-4" />
            </button>
          </form>
        </div>
        {sp.run && (
          <p className="mt-3 text-sm text-ink-soft">
            Showing one run: <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[13px]">{sp.run}</code>{" "}
            <Link href="/activity" className="font-semibold text-himal-700 hover:underline">Clear</Link>
          </p>
        )}
      </Card>

      <Card>
        {events.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="Nothing matches" body="Try a wider filter, or connect an agent to start recording." />
        ) : (
          <>
            <EventTable events={events} agents={new Map(agents.map((a) => [a.id, a]))} timeZone={org.settings.timezone} />
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-ink-muted">
              <span>
                {num((page - 1) * PAGE + 1)}–{num(Math.min(page * PAGE, total))} of {num(total)}
              </span>
              <span className="flex gap-2">
                {page > 1 && <Link href={link(page - 1)} className={buttonClass("secondary", "sm")}>Newer</Link>}
                {page < pages && <Link href={link(page + 1)} className={buttonClass("secondary", "sm")}>Older</Link>}
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
