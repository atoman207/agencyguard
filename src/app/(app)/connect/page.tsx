import type { Metadata } from "next";
import Link from "next/link";
import { Lock, ShieldQuestion } from "@/components/icons";
import { Badge, Callout, Card, CardHeader, CodeBlock, PageHeader } from "@/components/ui";
import { requireSession } from "@/server/auth";
import { listMcpServers } from "@/server/mcp";
import { requestOrigin } from "@/server/origin";

export const metadata: Metadata = { title: "Connect an agent" };

function Method({ id, title, level, effort, children }: { id: string; title: string; level: "Enforced" | "Cooperative"; effort: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader
        title={title}
        hint={effort}
        action={level === "Enforced" ? <Badge tone="info" icon={<Lock className="h-3.5 w-3.5" />}>Enforced</Badge> : <Badge icon={<ShieldQuestion className="h-3.5 w-3.5" />}>Cooperative</Badge>}
      />
      <div className="space-y-4 p-5 text-[15px] text-ink-soft">{children}</div>
    </Card>
  );
}

export default async function ConnectPage() {
  const { org } = await requireSession();
  const origin = await requestOrigin();
  const mcp = listMcpServers(org.id)[0]?.slug ?? "your-server";
  const f = org.settings.failureBehaviour;

  return (
    <>
      <PageHeader title="Connect an agent" lead="Every kind of agent has at least one way in. Start cooperative, in observe mode, in a few minutes; then move money and irreversible actions to the enforced checkpoints." />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        {[
          ["1", "Register the agent", "Give it a name and an owner, and create a token.", "/agents/new"],
          ["2", "Pick a method below", "One HTTP call is enough to start.", "#check-api"],
          ["3", "Watch it arrive", "The first action shows up in Activity at once.", "/activity"],
        ].map(([n, title, body, href]) => (
          <Link key={n} href={href} className="flex gap-3 rounded-xl border border-line bg-card p-4 shadow-card transition hover:border-himal-300">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-simrik-500 font-display font-semibold text-white">{n}</span>
            <span>
              <span className="block font-semibold text-himal-900">{title}</span>
              <span className="block text-sm text-ink-muted">{body}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="space-y-5">
        <Method id="check-api" title="Check API" level="Cooperative" effort="One HTTP call before the action. Works from n8n, Make, Zapier and any language.">
          <CodeBlock label="Ask before acting">{`curl -X POST ${origin}/v1/check \\
  -H "Authorization: Bearer $AGENTGUARD_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tool": "stripe.refunds.create",
    "action": "payment.refund",
    "resource": "order:5521",
    "params": { "amount": 450, "currency": "usd", "customer": "cus_2001" },
    "explanation": "Customer says the item arrived damaged."
  }'`}</CodeBlock>
          <p>
            The answer is <code>allow</code>, <code>block</code> or <code>pending</code>. On <code>pending</code>, poll <code>GET /v1/approvals/{"{approval_id}"}</code>; once approved, send the same request again to receive a one-time permit, act with the returned <code>params</code>, then report:
          </p>
          <CodeBlock label="Report what happened">{`curl -X POST ${origin}/v1/events \\
  -H "Authorization: Bearer $AGENTGUARD_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "event_id": "evt_...", "status": "completed", "params": { "amount": 450, "currency": "usd", "customer": "cus_2001" } }'`}</CodeBlock>
          <p className="text-sm text-ink-muted">Send the parameters you actually used. If they differ from what was allowed, AgentGuard raises a critical alert.</p>
        </Method>

        <Method id="sdk" title="TypeScript SDK" level="Cooperative" effort="A few lines. The helper asks, waits for a person, runs your function with the approved parameters and reports.">
          <CodeBlock label="sdk/typescript/agentguard.ts">{`import { AgentGuard } from "./agentguard";

const guard = new AgentGuard({ baseUrl: "${origin}", token: process.env.AGENTGUARD_TOKEN! });

const outcome = await guard.guard(
  { tool: "gmail.send", action: "email.send", params: { to: recipients, subject } },
  (approved) => sendEmail(approved),   // always use the approved parameters
);

if (outcome.status !== "done") console.log("Not sent:", outcome.reason);`}</CodeBlock>
          <p className="text-sm text-ink-muted">
            If AgentGuard cannot be reached the SDK throws <code>AgentGuardUnreachable</code>. Your workspace setting says low-risk actions should <strong>{f.lowRisk}</strong> and high-risk actions should <strong>{f.highRisk}</strong>; apply that in your catch block. A Python SDK is planned and not included yet.
          </p>
        </Method>

        <Method id="n8n" title="n8n and Make" level="Cooperative" effort="An HTTP Request step before the action, and a Wait step for approvals.">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Add an <strong>HTTP Request</strong> node (n8n) or <strong>HTTP: Make a request</strong> module (Make) that posts to <code>{origin}/v1/check</code> with <code>&quot;source&quot;: &quot;n8n&quot;</code> or <code>&quot;make&quot;</code> in the body.</li>
            <li>Branch on <code>decision</code>. On <code>allow</code>, continue to the real action using the returned <code>params</code>.</li>
            <li>On <code>pending</code>: in n8n use a <strong>Wait</strong> node and poll the approval; in Make, end the scenario and let a second scenario resume from the <code>approval.decided</code> webhook.</li>
            <li>After the action, post to <code>/v1/events</code> to report completion.</li>
          </ol>
          <Callout tone="info" title="Not built yet">Dedicated n8n guarded tool nodes and a Make app are on the roadmap. They wrap exactly these calls.</Callout>
        </Method>

        <Method id="gateway" title="AI-model gateway" level="Enforced" effort="Change the API base URL. Nothing else in the agent changes.">
          <CodeBlock label="Any OpenAI-compatible client">{`from openai import OpenAI

client = OpenAI(
    base_url="${origin}/gateway/v1",
    api_key=os.environ["AGENTGUARD_TOKEN"],   # the agent's AgentGuard token, not the provider key
)
reply = client.chat.completions.create(
    model="sandbox-small",                     # or any model your provider key can use
    messages=[{"role": "user", "content": "Where is my order?"}],
    extra_headers={"x-agentguard-run": run_id},  # optional: groups a run in the timeline
)`}</CodeBlock>
          <p>The gateway meters cost, enforces AI budgets, pauses agents that loop, scans what the agent reads and checks what it says. Store the real provider key under <Link href="/vault" className="font-semibold text-himal-700 underline">Vault & gateways</Link>.</p>
        </Method>

        <Method id="mcp" title="MCP gateway" level="Enforced" effort="Point the agent's MCP client at the AgentGuard address.">
          <CodeBlock label="MCP client configuration (the exact format depends on your client)">{`{
  "mcpServers": {
    "${mcp}": {
      "type": "http",
      "url": "${origin}/mcp/${mcp}",
      "headers": { "Authorization": "Bearer <agent token>" }
    }
  }
}`}</CodeBlock>
          <p>Tools the agent may not use are hidden from <code>tools/list</code>. A call that needs a person returns a clear &quot;not performed yet&quot; result; the agent repeats the same call after approval and it is forwarded once.</p>
        </Method>

        <Method id="vault" title="Credential vault" level="Enforced" effort="Connect the account once. The agent calls AgentGuard instead of the service.">
          <CodeBlock label="Refund through the vault">{`curl -X POST ${origin}/v1/actions/stripe/refund \\
  -H "Authorization: Bearer $AGENTGUARD_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "params": { "charge": "ch_1001", "amount": 450 }, "explanation": "Item arrived damaged." }'`}</CodeBlock>
          <p>AgentGuard reads the charge from Stripe, applies the rules, and performs the refund itself, exactly once. If approval is needed, the vault executes the moment an authorized person approves; poll the approval to get the result.</p>
        </Method>

        <Card>
          <CardHeader title="Webhooks" hint="AgentGuard can call your system when something is decided." />
          <div className="p-5 text-[15px] text-ink-soft">
            <p>
              Events: <code>approval.decided</code>, <code>limit.reached</code>, <code>agent.killed</code>, <code>alert.created</code>. Each request is signed: <code>X-AgentGuard-Signature: sha256=HMAC(secret, body)</code>. Set the address under <Link href="/settings" className="font-semibold text-himal-700 underline">Settings</Link>.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
