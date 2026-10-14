import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Download, ShieldAlert, ShieldCheck, User, Workflow } from "@/components/icons";
import { Callout, Card, CardHeader, EmptyState, Mono, PageHeader, buttonClass } from "@/components/ui";
import { fullDateTime, num } from "@/lib/format";
import { countAudit, listAudit, verifyAudit } from "@/server/audit";
import { requireSession } from "@/server/auth";
import { atLeast } from "@/server/users";

export const metadata: Metadata = { title: "Audit trail" };

const PAGE = 50;

const GROUPS = [
  ["", "Everything"],
  ["action.", "Agent actions"],
  ["approval.", "Approvals"],
  ["vault.", "Vault"],
  ["rule.", "Rules"],
  ["limit.", "Limits"],
  ["agent.", "Agents"],
  ["token.", "Tokens"],
  ["member.", "Members"],
  ["settings.", "Settings"],
];

function summary(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

async function targetHref(type: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  if (type === "event") return `/activity/${id}`;
  if (type === "approval") return `/approvals/${id}`;
  if (type === "agent") return `/agents/${id}`;
  if (type === "rule") return `/rules/${id}`;
  return null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; group?: string }> }) {
  const { org, user } = await requireSession();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const group = GROUPS.some(([g]) => g === sp.group) ? (sp.group ?? "") : "";
  const integrity = await verifyAudit(org.id);
  const total = await countAudit(org.id);
  const entries = await listAudit(org.id, { limit: PAGE, offset: (page - 1) * PAGE, action: group || undefined });
  const rows = await Promise.all(entries.map(async (e) => ({ e, link: await targetHref(e.target_type, e.target_id) })));
  const tz = org.settings.timezone;
  const canExport = atLeast(user.role, "admin");
  const href = (p: number, g = group) => `/audit?${new URLSearchParams({ ...(g ? { group: g } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <>
      <PageHeader
        title="Audit trail"
        lead="Who did what, when, and under which rule. Proof for your clients and auditors that your AI is under control."
        actions={
          canExport && (
            <>
              <a href="/api/audit/export?format=csv" className={buttonClass("secondary")}><Download className="h-4 w-4" />CSV</a>
              <a href="/api/audit/export?format=json" className={buttonClass("secondary")}><Download className="h-4 w-4" />JSON</a>
            </>
          )
        }
      />

      <div className="mb-5">
        {integrity.ok ? (
          <Callout tone="good" icon={<ShieldCheck className="h-5 w-5" />} title={`Verified: all ${num(integrity.entries)} entries are intact`}>
            Every entry carries a hash of its content and of the entry before it. Changing or removing any entry would break every hash after it. This check ran just now.
          </Callout>
        ) : (
          <Callout tone="danger" icon={<ShieldAlert className="h-5 w-5" />} title={`The chain is broken at entry ${integrity.brokenAt}`}>
            An entry was changed or removed after it was written. Entries before number {integrity.brokenAt} are intact; treat everything from it onward as unreliable.
          </Callout>
        )}
      </div>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter">
        {GROUPS.map(([g, label]) => (
          <Link key={g} href={href(1, g)} className={`rounded-full px-3 py-1 text-sm font-semibold transition ${g === group ? "bg-himal-900 text-white" : "bg-white text-ink-soft ring-1 ring-line-strong hover:ring-himal-300"}`}>
            {label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader title="Entries" hint={`${num(total)} in total, newest first.`} />
        {entries.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="ledger w-full min-w-[860px]">
                <thead>
                  <tr>
                    <th className="text-right">#</th>
                    <th>Time</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Details</th>
                    <th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ e, link }) => {
                    const Icon = e.actor_type === "user" ? User : e.actor_type === "agent" ? Bot : Workflow;
                    return (
                      <tr key={e.seq}>
                        <td className="text-right text-sm tabular-nums text-ink-muted">{e.seq}</td>
                        <td className="whitespace-nowrap text-sm tabular-nums text-ink-muted">{fullDateTime(e.created_at, tz)}</td>
                        <td className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                            <Icon className="h-3.5 w-3.5 text-ink-muted" />
                            {e.actor_label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">{link ? <Link href={link} className="font-medium text-himal-800 hover:underline">{e.action}</Link> : <span className="font-medium">{e.action}</span>}</td>
                        <td className="max-w-md text-[13px] text-ink-soft"><span className="line-clamp-2" title={summary(e.details)}>{summary(e.details) || "—"}</span></td>
                        <td><Mono>{e.hash.slice(0, 10)}</Mono></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-ink-muted">
              <span>Page {page}</span>
              <span className="flex gap-2">
                {page > 1 && <Link href={href(page - 1)} className={buttonClass("secondary", "sm")}>Newer</Link>}
                {entries.length === PAGE && <Link href={href(page + 1)} className={buttonClass("secondary", "sm")}>Older</Link>}
              </span>
            </div>
          </>
        )}
      </Card>

      <p className="mt-4 text-sm text-ink-muted">
        Routine AI-model calls are recorded under Activity with their cost, not here, to keep this trail readable. Blocked model calls are in both.
      </p>
    </>
  );
}
