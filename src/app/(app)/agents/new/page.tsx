import type { Metadata } from "next";
import { createAgentAction } from "@/app/actions";
import { AgentForm } from "@/components/agent-form";
import { Callout, Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/server/auth";
import { atLeast, listUsers } from "@/server/users";

export const metadata: Metadata = { title: "Register an agent" };

export default async function NewAgentPage() {
  const { org, user } = await requireSession();
  if (!atLeast(user.role, "admin")) {
    return (
      <>
        <PageHeader title="Register an agent" />
        <Callout tone="warn">Registering agents needs the admin role. Ask a workspace owner.</Callout>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Register an agent" lead="Give the agent an identity and an owner. You get its token on the next screen." />
      <Card className="max-w-3xl p-6">
        <AgentForm action={createAgentAction} users={await listUsers(org.id)} defaultMode={org.settings.defaultAgentMode} submit="Register agent" />
      </Card>
    </>
  );
}
