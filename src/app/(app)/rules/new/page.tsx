import type { Metadata } from "next";
import Link from "next/link";
import { RuleBuilder } from "@/components/rule-builder";
import { PageHeader } from "@/components/ui";
import { listAgents } from "@/server/agents";
import { requireSession } from "@/server/auth";
import { atLeast } from "@/server/users";

export const metadata: Metadata = { title: "New rule" };

export default async function NewRulePage() {
  const { org, user } = await requireSession();
  return (
    <>
      <PageHeader eyebrow={<Link href="/rules" className="hover:underline">Rules</Link>} title="New rule" lead="Build it from conditions, read it back in plain words, then test it on real activity before it applies to anything." />
      <RuleBuilder agents={listAgents(org.id).map((a) => ({ id: a.id, name: a.name }))} timeZone={org.settings.timezone} canEdit={atLeast(user.role, "admin")} />
    </>
  );
}
