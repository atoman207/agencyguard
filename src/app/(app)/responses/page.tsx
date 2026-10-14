import type { Metadata } from "next";
import Link from "next/link";
import { BookCheck, MessageSquareWarning } from "@/components/icons";
import { DecisionBadge, StatusBadge } from "@/components/badges";
import { SubmitButton } from "@/components/forms";
import { ApprovedAnswersEditor, SettingsForm } from "@/components/settings-form";
import { Callout, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { listAgents } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { listEvents } from "@/server/events";
import { atLeast } from "@/server/users";
import type { ResponseAction } from "@/lib/types";

export const metadata: Metadata = { title: "Responses" };

const CHECKS: { key: "commitments" | "prices" | "personalData" | "forbidden"; title: string; example: string }[] = [
  { key: "commitments", title: "Promises and policy claims", example: "\"We guarantee a full refund\", \"our policy allows…\"" },
  { key: "prices", title: "Prices and discounts", example: "\"It is $59 this week\", \"40% off\"" },
  { key: "personalData", title: "Personal data", example: "Email addresses, phone numbers, card numbers" },
  { key: "forbidden", title: "Forbidden topics", example: "The words and phrases you list below" },
];

const OPTIONS: { value: ResponseAction; label: string }[] = [
  { value: "off", label: "Do nothing" },
  { value: "flag", label: "Flag it, send it anyway" },
  { value: "replace", label: "Replace with an approved answer" },
  { value: "hold", label: "Hold for a person" },
  { value: "block", label: "Block it" },
];

export default async function ResponsesPage() {
  const { org, user } = await requireSession();
  const cfg = org.settings.responseCheck;
  const owner = atLeast(user.role, "owner");
  const flagged = await listEvents(org.id, { action: "response.send", limit: 15 });
  const agents = new Map((await listAgents(org.id)).map((a) => [a.id, a.name]));

  return (
    <>
      <PageHeader title="Responses" lead="Many costly failures are statements, not actions: an invented policy, a wrong price, a leaked phone number. The response checkpoint reads replies before customers do." />

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="What to check, and what to do about it" hint="Applies to agents with reply checks switched on, at the AI-model gateway and through the response check API." icon={<MessageSquareWarning className="h-4 w-4" />} />
          <SettingsForm className="p-5">
            <div className="space-y-4">
              {CHECKS.map((c) => (
                <div key={c.key} className="grid gap-2 sm:grid-cols-[1fr_15rem] sm:items-center">
                  <div>
                    <div className="font-semibold text-ink">{c.title}</div>
                    <div className="text-sm text-ink-muted">{c.example}</div>
                  </div>
                  <select name={`s.responseCheck.${c.key}`} defaultValue={cfg[c.key]} className="field" disabled={!owner} aria-label={c.title}>
                    {OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="forbidden">Forbidden topics</label>
                <textarea id="forbidden" name="s.responseCheck.forbiddenTopics#list" rows={3} className="field" defaultValue={cfg.forbiddenTopics.join("\n")} placeholder={"legal advice\nmedical advice"} disabled={!owner} />
                <p className="field-hint">One word or phrase per line.</p>
              </div>
              <div>
                <label className="field-label" htmlFor="holding">Holding message</label>
                <textarea id="holding" name="s.responseCheck.holdingMessage" rows={3} className="field" defaultValue={cfg.holdingMessage} disabled={!owner} />
                <p className="field-hint">What the customer receives while a reply waits for a person.</p>
              </div>
            </div>
            {owner ? <SubmitButton className="mt-4">Save</SubmitButton> : <p className="mt-4 text-sm text-ink-muted">Only owners can change these settings.</p>}
          </SettingsForm>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Callout tone="warn" title="How detection works today">
            Replies are checked with pattern matching. It catches the plain cases and will miss carefully rephrased ones. A classifier model is the planned next step behind the same settings.
          </Callout>
          <Callout tone="info" title="Checking adds delay">
            A reply has to be complete before it can be checked, so streaming clients receive it in one piece. Switch reply checks off per agent where speed matters more.
          </Callout>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader title="Approved answers" hint="For sensitive topics, steer the agent to wording your company has signed off." icon={<BookCheck className="h-4 w-4" />} />
        <ApprovedAnswersEditor answers={cfg.approvedAnswers} canEdit={owner} />
      </Card>

      <Card className="mt-5">
        <CardHeader title="Recently flagged replies" />
        {flagged.length === 0 ? (
          <EmptyState title="No flagged replies" body="Replies that pass every check are not recorded here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[720px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Agent</th>
                  <th>What was found</th>
                  <th>Decision</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-sm tabular-nums text-ink-muted">{dateTime(e.created_at, org.settings.timezone)}</td>
                    <td className="whitespace-nowrap font-medium">{agents.get(e.agent_id) ?? "Unknown"}</td>
                    <td className="max-w-md">
                      <Link href={e.approval_id ? `/approvals/${e.approval_id}` : `/activity/${e.id}`} className="text-himal-800 hover:underline">
                        {e.reason}
                      </Link>
                    </td>
                    <td><DecisionBadge decision={e.would_decision} observe={!!e.observe && e.would_decision !== "ALLOW"} /></td>
                    <td><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
