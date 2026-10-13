import type { Metadata } from "next";
import { FlaskConical } from "@/components/icons";
import { Playground } from "@/components/playground";
import { Callout, PageHeader } from "@/components/ui";
import { requireSession } from "@/server/auth";
import { SCENARIOS } from "@/server/scenarios";
import { atLeast } from "@/server/users";

export const metadata: Metadata = { title: "Playground" };

export default async function PlaygroundPage() {
  const { user } = await requireSession();
  const canRun = atLeast(user.role, "admin");
  return (
    <>
      <PageHeader
        title="Playground"
        lead="The failure cases every company with AI agents worries about, run for real against the decision engine. Each run leaves records in Activity, Approvals and the Audit trail."
      />
      <div className="mb-5">
        <Callout tone="info" icon={<FlaskConical className="h-5 w-5" />} title="What is real here and what is simulated">
          The rules, limits, approvals, duplicate protection, vault and gateways are the real ones. Only the outside world is simulated: Stripe runs in sandbox mode, the model is a built-in stand-in, and the MCP tools belong to a demo server. A dedicated “Playground agent” is used, and its sandbox spend is reset before each run so limits behave the same every time.
          {!canRun && " Running scenarios needs the admin role."}
        </Callout>
      </div>
      <Playground scenarios={SCENARIOS} canRun={canRun} />
    </>
  );
}
