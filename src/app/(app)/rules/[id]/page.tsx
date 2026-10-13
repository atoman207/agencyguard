import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "@/components/icons";
import { deleteRuleAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { RuleBuilder } from "@/components/rule-builder";
import { PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { listAgents } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { getRule } from "@/server/rules";
import { atLeast } from "@/server/users";

export const metadata: Metadata = { title: "Edit rule" };

export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const { org, user } = await requireSession();
  const { id } = await params;
  const rule = getRule(org.id, id);
  if (!rule) notFound();
  const canEdit = atLeast(user.role, "admin");
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/rules" className="hover:underline">Rules</Link>}
        title={rule.name}
        lead={`Version ${rule.version}, last changed ${dateTime(rule.updated_at, org.settings.timezone)}. Every change is kept in the audit trail.`}
        actions={
          canEdit ? (
            <ActionForm action={deleteRuleAction} quiet>
              <input type="hidden" name="id" value={rule.id} />
              <input type="hidden" name="redirect" value="true" />
              <SubmitButton variant="ghost" size="sm" className="text-simrik-700 hover:bg-simrik-50" confirm={`Delete the rule "${rule.name}"?`} aria-label={`Delete ${rule.name}`}>
                <Trash2 className="h-4 w-4" />
                Delete
              </SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />
      <RuleBuilder rule={rule} agents={listAgents(org.id).map((a) => ({ id: a.id, name: a.name }))} timeZone={org.settings.timezone} canEdit={canEdit} />
    </>
  );
}
