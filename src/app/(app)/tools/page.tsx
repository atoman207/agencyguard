import type { Metadata } from "next";
import { CircleHelp, Trash2, Undo2, Wrench } from "@/components/icons";
import { classifyToolAction, deleteToolAction } from "@/app/actions";
import { RiskBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { ACTIONS, ACTION_CATEGORIES, getAction } from "@/lib/catalog";
import { relative } from "@/lib/format";
import { listAgents } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { listAgentTools, listTools } from "@/server/tools";
import { atLeast } from "@/server/users";

export const metadata: Metadata = { title: "Tools" };

async function ActionSelect({ id, value }: { id: string; value: string }) {
  return (
    <select id={id} name="action" className="field h-9 py-0 text-sm" defaultValue={value}>
      {ACTION_CATEGORIES.map((category) => (
        <optgroup key={category} label={category}>
          {ACTIONS.filter((a) => a.category === category).map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default async function ToolsPage() {
  const { org, user, now } = await requireSession();
  const tools = await listTools(org.id);
  const agentName = new Map((await listAgents(org.id)).map((a) => [a.id, a.name]));
  const usedBy = new Map<string, string[]>();
  for (const link of await listAgentTools(org.id)) usedBy.set(link.tool_id, [...(usedBy.get(link.tool_id) ?? []), agentName.get(link.agent_id) ?? "Unknown"]);
  const unclassified = tools.filter((t) => t.status !== "confirmed");
  const classified = tools.filter((t) => t.status === "confirmed");
  const canEdit = atLeast(user.role, "admin");

  return (
    <>
      <PageHeader title="Tools" lead="Agents call the same thing by different names. Here every tool is mapped to a standard action type, so one rule covers them all." />

      <Card className={unclassified.length ? "border-marigold-300" : ""}>
        <CardHeader
          title={`Waiting to be classified${unclassified.length ? ` (${unclassified.length})` : ""}`}
          hint="Until a person confirms what a tool does, every call to it asks a human."
          icon={<CircleHelp className="h-4 w-4" />}
        />
        {unclassified.length === 0 ? (
          <EmptyState title="Every tool is classified" body="New tools appear here the first time an agent calls them, or when the MCP gateway discovers them on a server." />
        ) : (
          <ul className="divide-y divide-line">
            {unclassified.map((t) => (
              <li key={t.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[15px] font-medium text-ink">{t.name}</code>
                  <p className="mt-1 text-sm text-ink-muted">
                    First seen {relative(t.first_seen_at, now)}
                    {usedBy.get(t.id)?.length ? ` · used by ${usedBy.get(t.id)!.join(", ")}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {t.suggested_action ? (
                      <>
                        Suggestion: <strong>{getAction(t.suggested_action).label}</strong>. This is a guess from the name of the tool; check it before confirming.
                      </>
                    ) : (
                      "No suggestion: the name gives nothing to go on."
                    )}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionForm action={classifyToolAction} quiet className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <ActionSelect id={`action-${t.id}`} value={t.suggested_action ?? "data.read"} />
                      <SubmitButton size="sm">Confirm</SubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteToolAction} quiet>
                      <input type="hidden" name="id" value={t.id} />
                      <SubmitButton variant="ghost" size="sm" aria-label={`Delete ${t.name}`} confirm={`Delete tool "${t.name}"?`}>
                        <Trash2 className="h-4 w-4" />
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader title="Classified tools" hint="Change a classification if a tool does more than its name suggests." icon={<Wrench className="h-4 w-4" />} />
        {classified.length === 0 ? (
          <EmptyState title="No tools yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[760px]">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Action type</th>
                  <th>Risk</th>
                  <th>Used by</th>
                  <th>Last seen</th>
                  {canEdit && <th>Manage</th>}
                </tr>
              </thead>
              <tbody>
                {classified.map((t) => {
                  const type = getAction(t.action);
                  return (
                    <tr key={t.id}>
                      <td><code className="text-[14px] font-medium text-ink">{t.name}</code></td>
                      <td>
                        {type.label}
                        <span className="block text-[13px] text-ink-muted">
                          {type.category}
                          {type.reversible ? (
                            <span className="ml-1.5 inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />can be undone</span>
                          ) : (
                            " · cannot be undone"
                          )}
                        </span>
                      </td>
                      <td><RiskBadge risk={type.risk} /></td>
                      <td className="text-sm text-ink-soft">{usedBy.get(t.id)?.join(", ") ?? "—"}</td>
                      <td className="whitespace-nowrap text-sm text-ink-muted">{relative(t.last_seen_at, now)}</td>
                      {canEdit && (
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            <ActionForm action={classifyToolAction} quiet className="flex items-center gap-2">
                              <input type="hidden" name="id" value={t.id} />
                              <ActionSelect id={`action-${t.id}`} value={t.action ?? "data.read"} />
                              <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
                            </ActionForm>
                            <ActionForm action={deleteToolAction} quiet>
                              <input type="hidden" name="id" value={t.id} />
                              <SubmitButton variant="ghost" size="sm" aria-label={`Delete ${t.name}`} confirm={`Delete tool "${t.name}" from every agent?`}>
                                <Trash2 className="h-4 w-4" />
                              </SubmitButton>
                            </ActionForm>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader title="The action catalog" hint="The standard action types and their default risk. Actions that cannot be undone are strict by default." />
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {ACTIONS.map((a) => (
            <div key={a.id} className="bg-white px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{a.label}</span>
                <RiskBadge risk={a.risk} />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-muted">
                <code>{a.id}</code>
                {!a.reversible && <Badge>irreversible</Badge>}
                {a.readsUntrusted && <Badge tone="warn">reads outside content</Badge>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
