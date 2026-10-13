import type { Metadata } from "next";
import Link from "next/link";
import { Radar, TriangleAlert } from "@/components/icons";
import { ConnectionBadge, RiskBadge } from "@/components/badges";
import { CoverageBar } from "@/components/charts";
import { Callout, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { getAction } from "@/lib/catalog";
import { requireSession } from "@/server/auth";
import { coverage } from "@/server/insights";

export const metadata: Metadata = { title: "Coverage" };

export default async function CoveragePage() {
  const { org } = await requireSession();
  const cov = coverage(org);

  return (
    <>
      <PageHeader title="Coverage" lead="Not every connection gives the same guarantee. This page shows exactly how protected each agent is, including what AgentGuard cannot see." />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Coverage score" hint="Share of tool use at each protection level, weighted by risk: a refund tool counts six times more than an order lookup." icon={<Radar className="h-4 w-4" />} />
          <div className="p-5">
            {cov.total.tools === 0 ? (
              <EmptyState title="No tools seen yet" body="Coverage is calculated from the tools your agents use and the ones you add by hand." />
            ) : (
              <>
                <div className="mb-4 flex items-baseline gap-2">
                  <span className="font-display text-[3.25rem] font-semibold leading-none text-himal-900">{cov.total.enforced}%</span>
                  <span className="text-ink-muted">enforced across {cov.total.tools} agent-tool connections</span>
                </div>
                <CoverageBar share={cov.total} />
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="The three levels" />
          <dl className="space-y-3 p-5 text-sm">
            <div>
              <dt className="flex items-center gap-2 font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-[3px] bg-himal-700" />Enforced</dt>
              <dd className="text-ink-muted">Vault, AI-model gateway, MCP gateway. Traffic physically passes through AgentGuard, so the agent cannot skip the rules.</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-[3px] bg-himal-400" />Cooperative</dt>
              <dd className="text-ink-muted">SDK, n8n, Make, check API. The agent asks first. Quick to add, but relies on the developer using it correctly.</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#e2d8c8] ring-1 ring-inset ring-black/5" />Not covered</dt>
              <dd className="text-ink-muted">Keys and logins the agent holds itself. AgentGuard cannot see or stop these.</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-5">
        <Callout tone="warn" icon={<TriangleAlert className="h-5 w-5" />} title="Enforced only holds if the agent has no other way to reach the tool">
          The real AI-provider keys, MCP-server credentials and tool credentials must live only in AgentGuard, and the old keys must be rotated. Confirm this per connector under <Link href="/vault" className="font-semibold underline">Vault & gateways</Link>.
        </Callout>
      </div>

      <Card className="mt-5">
        <CardHeader title={`Gaps to close${cov.gaps.length ? ` (${cov.gaps.length})` : ""}`} hint="Highest risk first." />
        {cov.gaps.length === 0 ? (
          <EmptyState title="No gaps found" body="Every high-risk tool is enforced and every tool is classified. Tools nobody has declared or used through AgentGuard cannot appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {cov.gaps.map((g, i) => (
              <li key={i} className="grid gap-2 px-5 py-3.5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-[15px] font-medium text-ink">{g.row.name}</code>
                    <span className="text-sm text-ink-muted">on</span>
                    <Link href={`/agents/${g.agent.id}`} className="font-semibold text-himal-700 hover:underline">{g.agent.name}</Link>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-soft">{g.advice}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RiskBadge risk={g.row.risk} />
                  <ConnectionBadge connection={g.row.connection} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {cov.agents.map(({ agent, share, rows }) => (
        <Card key={agent.id} className="mt-5">
          <CardHeader
            title={<Link href={`/agents/${agent.id}`} className="hover:underline">{agent.name}</Link>}
            hint={`${agent.platform} · ${agent.environment}`}
            action={share.tools > 0 && <div className="w-56"><CoverageBar share={share} compact /><div className="mt-1 text-right text-xs text-ink-muted">{share.enforced}% enforced</div></div>}
          />
          {rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">This agent has not used any tool through AgentGuard, and none has been added by hand. Its coverage is unknown.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="ledger w-full min-w-[640px]">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Does</th>
                    <th>Risk</th>
                    <th>Connection</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.tool_id}>
                      <td><code className="text-[14px] font-medium">{r.name}</code></td>
                      <td className="text-sm text-ink-soft">{r.status === "confirmed" ? getAction(r.action).label : "Not classified"}</td>
                      <td><RiskBadge risk={r.risk} /></td>
                      <td>
                        <ConnectionBadge connection={r.connection} />
                        {r.caveat && <span className="mt-1 block text-xs text-ink-muted">{r.caveat}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
