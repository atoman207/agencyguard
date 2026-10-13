import "server-only";
import { get, run } from "./db";
import { fingerprint, newId } from "./crypto";
import { createAgent, type AgentInput } from "./agents";
import { decide, reportCompletion, type ActionRequest } from "./engine";
import { insertEvent, updateEvent } from "./events";
import { decideAndExecute, executeEvent } from "./execution";
import { BUILTIN_DEMO, saveMcpServer } from "./mcp";
import { getOrg, saveSettings } from "./orgs";
import { checkResponse } from "./response-check";
import { installTemplate } from "./templates";
import { classifyTool, declareTool, getTool, sightTool, upsertTool } from "./tools";
import { addMember, getUser, signUp, userActor } from "./users";
import { prepare, getConnector, saveCredential } from "./vault";
import type { ActionEvent, Agent, Source, User } from "@/lib/types";

// Demo workspace: a fictional online shop with four agents and a week of
// activity, so the dashboard has something to show on first run. Everything
// goes through the real decision engine with back-dated timestamps; only the
// AI-model call records are written directly, to give the cost charts volume.

export const DEMO_PASSWORD = "namaste-agentguard";
export const DEMO_USERS = [
  { name: "Aarav Shrestha", email: "owner@himalayanthreads.test", role: "owner" as const },
  { name: "Sita Gurung", email: "manager@himalayanthreads.test", role: "approver" as const },
  { name: "Bikash Tamang", email: "admin@himalayanthreads.test", role: "admin" as const },
  { name: "Maya Lama", email: "viewer@himalayanthreads.test", role: "viewer" as const },
];

// Fixed sign-in accounts, stored in the database as seed data. They are added
// to the demo workspace on first run, and to an existing database the next
// time anyone signs in. Like the demo accounts above, their passwords are
// published here, so they follow the same rule: development only by default.
export const SEED_ACCOUNTS = [
  { name: "Admin", email: "admin@gmail.com", password: "adminPASSWORD", role: "admin" as const },
  { name: "User", email: "user@gmail.com", password: "userPASSWORD", role: "viewer" as const },
];

type Globals = typeof globalThis & { __agSeed?: Promise<void> };

export function seedEnabled(): boolean {
  const flag = process.env.AGENTGUARD_SEED_DEMO;
  if (flag) return flag === "true";
  // Demo accounts have a published password, so they are never created in production by default.
  return process.env.NODE_ENV !== "production";
}

export function ensureSeeded(): Promise<void> {
  const g = globalThis as Globals;
  if (!g.__agSeed) {
    g.__agSeed = (async () => {
      if (!seedEnabled()) return;
      if (!get("SELECT 1 AS x FROM organizations LIMIT 1")) await seed(Date.now());
      ensureSeedAccounts(Date.now());
    })().catch((err) => {
      console.error("AgentGuard demo seed failed:", err);
    });
  }
  return g.__agSeed;
}

/** Adds any missing seed account to the demo workspace. Safe to run on every start. */
function ensureSeedAccounts(now: number): void {
  const owner = get<{ id: string }>("SELECT id FROM users WHERE email = ?", DEMO_USERS[0].email);
  if (!owner) return; // no demo workspace in this database
  const ownerUser = getUser(owner.id)!;
  const org = getOrg(ownerUser.org_id);
  for (const account of SEED_ACCOUNTS) {
    if (get("SELECT 1 AS x FROM users WHERE email = ?", account.email)) continue;
    addMember(org, userActor(ownerUser), account, now);
  }
}

function rng(seedValue: number) {
  let a = seedValue;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOMERS = [
  ["cus_2001", "Anita Rai", "anita.rai@example.com"],
  ["cus_2002", "Rajesh Thapa", "rajesh.thapa@example.com"],
  ["cus_2003", "Sunita Magar", "sunita.magar@example.com"],
  ["cus_2004", "Dipesh KC", "dipesh.kc@example.com"],
  ["cus_2005", "Pema Sherpa", "pema.sherpa@example.com"],
  ["cus_2006", "Kiran Adhikari", "kiran.adhikari@example.com"],
];
const PRODUCTS = ["Pashmina shawl", "Dhaka topi", "Singing bowl", "Lokta paper journal", "Hemp backpack", "Yak wool blanket", "Thangka print", "Felt slippers"];

async function seed(now: number): Promise<void> {
  const rand = rng(2083);
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const start = now - 7 * 86_400_000;

  const owner = signUp({ orgName: "Himalayan Threads", name: DEMO_USERS[0].name, email: DEMO_USERS[0].email, password: DEMO_PASSWORD }, start);
  let org = getOrg(owner.org_id);
  const ownerActor = userActor(owner);
  const [manager, admin] = DEMO_USERS.slice(1).map((u) => addMember(org, ownerActor, { ...u, password: DEMO_PASSWORD }, start)) as User[];

  saveSettings(org.id, {
    ...org.settings,
    approvalTimeoutMinutes: 24 * 60,
    responseCheck: {
      ...org.settings.responseCheck,
      prices: "flag",
      forbiddenTopics: ["lawsuit", "legal advice"],
      approvedAnswers: [
        {
          id: newId("ans"),
          topic: "Refund policy",
          keywords: ["refund", "money back", "return"],
          answer: "Thank you for reaching out. Returns are accepted within 14 days of delivery for unused items. I have passed your request to our team, who will confirm the next step by email.",
        },
      ],
    },
  });
  org = getOrg(org.id);

  for (const connector of ["stripe", "slack", "hubspot"]) saveCredential(org, ownerActor, { connector, mode: "sandbox", apiKey: "" }, start);
  saveMcpServer(org, ownerActor, { slug: "shop", name: "Shop tools (demo MCP server)", url: BUILTIN_DEMO }, start);

  // Charges in the Stripe sandbox. The first five are the ones the playground uses.
  const charge = (id: string, customer: string[], amount: number, description: string, at: number) =>
    run(
      "INSERT INTO sandbox_charges (id, org_id, customer, customer_name, customer_email, amount, currency, description, created_at) VALUES (?, ?, ?, ?, ?, ?, 'usd', ?, ?)",
      id, org.id, customer[0], customer[1], customer[2], amount, description, at,
    );
  charge("ch_1001", CUSTOMERS[0], 450, "Order #5521 — Pashmina shawl, Dhaka topi", now - 9 * 86_400_000);
  charge("ch_1002", CUSTOMERS[1], 85, "Order #5530 — Lokta paper journal", now - 5 * 86_400_000);
  charge("ch_1003", CUSTOMERS[2], 1250, "Order #5544 — Singing bowls, bulk", now - 4 * 86_400_000);
  charge("ch_1004", CUSTOMERS[3], 240, "Order #5561 — Yak wool blanket", now - 3 * 86_400_000);
  charge("ch_1005", CUSTOMERS[4], 60, "Order #5570 — Felt slippers", now - 2 * 86_400_000);

  const agent = (input: Partial<AgentInput> & Pick<AgentInput, "name" | "platform" | "purpose" | "environment" | "mode">, ownerUser: User) =>
    createAgent(org, ownerActor, { ownerUserId: ownerUser.id, handlesPrivateData: false, checkResponses: true, ...input }, start);

  const support = agent({ name: "Support Sathi", platform: "n8n", purpose: "Answers customers, looks up orders and issues refunds.", environment: "production", mode: "enforce", handlesPrivateData: true }, manager);
  const outreach = agent({ name: "Outreach Agent", platform: "Make", purpose: "Sends follow-up emails to wholesale leads and updates the CRM.", environment: "production", mode: "observe" }, admin);
  const invoices = agent({ name: "Invoice Assistant", platform: "LangGraph", purpose: "Reads supplier invoices and prepares payments.", environment: "staging", mode: "enforce", handlesPrivateData: true }, admin);
  const research = agent({ name: "Research Helper", platform: "OpenAI Agents SDK", purpose: "Reads supplier websites and summarises prices.", environment: "development", mode: "observe", checkResponses: false }, owner);

  await installTemplate(org, ownerActor, "ecommerce-support", { agentId: null, enable: true }, start);
  await installTemplate(org, ownerActor, "sales-outreach", { agentId: null, enable: true }, start);
  await installTemplate(org, ownerActor, "finance-operations", { agentId: null, enable: true }, start);

  // Tools the team has already classified.
  const known = (name: string, action: string) => classifyTool(org, ownerActor, upsertTool(org.id, name, start).id, action, start);
  known("gmail.send", "email.send");
  known("crm.upsert_contact", "crm.update");
  known("pay_invoice", "payment.payout");
  known("shop.lookup_order", "order.read");
  known("shop.update_shipping_address", "order.update");
  known("shop.fetch_webpage", "web.fetch");
  known("shop.send_email", "email.send");
  known("shop.send_message", "message.send");
  known("shop.delete_customer", "crm.delete");
  // A tool that never passes through AgentGuard: visible in coverage as a gap.
  declareTool(org, ownerActor, invoices.id, { name: "postgres.query (direct database login)", action: "data.write", connection: "uncovered" }, start);

  const act = async (a: Agent, source: Source, req: ActionRequest, at: number, approver?: { user: User; decision: "approve" | "reject"; second?: User; note?: string }) => {
    const ctx = { org, agent: a, source, now: at, live: false };
    let request = req;
    if (source === "vault") {
      const [connector, actionId] = req.tool!.split(".");
      const def = getConnector(connector)!.actions.find((x) => x.id === actionId)!;
      const prepared = await prepare(org, connector, def, req.params ?? {});
      request = { ...req, params: prepared.params, resource: prepared.resource, sourceFacts: prepared.facts, knownAction: def.action };
    }
    const outcome = decide(ctx, request);
    const event = outcome.event;
    if (outcome.outcome === "allow" && !outcome.alreadyExecuted) {
      if (source === "vault") await executeEvent(org, event.id, at + 900, false);
      else if (source === "mcp_gateway") updateEvent(event.id, { status: "executed", completed_at: at + 400 });
      else reportCompletion({ org, agent: a, now: at + 1500, live: false }, { eventId: event.id, status: "completed" });
    } else if (outcome.outcome === "pending" && approver && event.approval_id) {
      const decidedAt = at + between(2, 25) * 60_000;
      const result = await decideAndExecute(org, approver.user, event.approval_id, approver.decision, approver.note ?? "", "dashboard", decidedAt, false);
      if (approver.second && result.approval.status === "pending") {
        await decideAndExecute(org, approver.second, event.approval_id, "approve", "", "dashboard", decidedAt + 4 * 60_000, false);
      }
      if (approver.decision === "approve" && source !== "vault") {
        const again = decide({ ...ctx, now: decidedAt + 6 * 60_000 }, request);
        if (again.outcome === "allow") reportCompletion({ org, agent: a, now: decidedAt + 7 * 60_000, live: false }, { eventId: again.event.id, status: "completed" });
      }
    }
    return outcome;
  };

  const modelCall = (a: Agent, model: string, at: number, runId: string | null) => {
    const tokensIn = between(600, 3200);
    const tokensOut = between(120, 900);
    const price = model === "sandbox-large" ? { i: 5, o: 15 } : { i: 0.5, o: 1.5 };
    const params = { model, messages: between(2, 9), priced: true };
    const event: ActionEvent = {
      id: newId("evt"), org_id: org.id, agent_id: a.id, run_id: runId, source: "ai_gateway", enforcement: "enforced", tool: "ai.completion",
      action: "ai.completion", resource: `model:${model}`, params, params_fingerprint: fingerprint("ai.completion", null, { ...params, at }),
      idempotency_key: `ai.completion:${newId("k")}`, client_key: null, untrusted_input_seen: 0, risk: "low", decision: "ALLOW", would_decision: "ALLOW",
      observe: a.mode === "observe" ? 1 : 0, rules: [], reason: null, status: "executed", amount: null, currency: null, customer: null, money_state: "none",
      cost_usd: (tokensIn * price.i + tokensOut * price.o) / 1_000_000, model, tokens_in: tokensIn, tokens_out: tokensOut, explanation: null, result: null,
      approval_id: null, duplicate_of: null, created_at: at, completed_at: at,
    };
    insertEvent(event);
  };
  const modelTool = upsertTool(org.id, "ai.completion", start);
  for (const a of [support, outreach, invoices, research]) sightTool(org.id, a.id, modelTool.id, "ai_gateway", start);

  let chargeNo = 900;
  for (let day = 6; day >= 0; day--) {
    const dayStart = now - day * 86_400_000 - 10 * 3_600_000;
    // Leave the last three hours empty so today's seeded history sits before "now".
    const at = () => Math.min(dayStart + between(0, 9 * 60) * 60_000, now - 3 * 3_600_000 - between(1, 50) * 60_000);

    // Support Sathi: order lookups, refunds through the vault, replies through the gateway.
    for (let i = between(5, 9); i > 0; i--) {
      const t = at();
      const runId = `run_${newId("s").slice(2, 10)}`;
      const customer = pick(CUSTOMERS);
      await act(support, "mcp_gateway", { tool: "shop.lookup_order", params: { order_id: String(between(5200, 5600)) }, runId }, t);
      modelCall(support, "sandbox-small", t + 2000, runId);
      if (rand() < 0.45) {
        const amount = rand() < 0.8 ? between(15, 95) : between(120, 380);
        const id = `ch_0${chargeNo++}`;
        charge(id, customer, amount + between(0, 120), `Order #${between(5200, 5600)} — ${pick(PRODUCTS)}`, t - 3 * 86_400_000);
        await act(
          support,
          "vault",
          { tool: "stripe.refund", params: { charge: id, amount, reason: "requested_by_customer" }, runId, explanation: "The customer says the item arrived damaged and asked for a refund." },
          t + 4000,
          { user: manager, decision: rand() < 0.8 ? "approve" : "reject", note: rand() < 0.5 ? "Checked the order photos." : "" },
        );
      }
      modelCall(support, "sandbox-small", t + 9000, runId);
    }
    if (day % 2 === 0) {
      const t = at();
      const verdict = checkResponse({ org, agent: support, source: "ai_gateway", now: t, live: false }, "Of course! We guarantee a full refund, no questions asked. I will refund the entire amount within 3 days.");
      if (verdict.approvalId) await decideAndExecute(org, manager, verdict.approvalId, day === 2 ? "approve" : "reject", "", "dashboard", t + 6 * 60_000, false);
      checkResponse({ org, agent: support, source: "ai_gateway", now: t + 3_600_000, live: false }, "The jacket is $59 this week, and delivery to Pokhara is free.");
    }

    // Outreach Agent (observe mode): nothing is stopped, but the log shows what would have been.
    for (let i = between(3, 6); i > 0; i--) {
      const t = at();
      const runId = `run_${newId("o").slice(2, 10)}`;
      modelCall(outreach, "sandbox-small", t, runId);
      const recipients = day === 3 && i === 1 ? 2400 : rand() < 0.2 ? between(60, 140) : between(1, 30);
      await act(outreach, "make", { tool: "gmail.send", params: { subject: "Autumn wholesale catalogue", recipient_count: recipients, segment: recipients > 500 ? "all-contacts" : "wholesale-leads", batch: `${day}-${i}` }, runId }, t + 3000);
      await act(outreach, "make", { tool: "crm.upsert_contact", params: { contact_id: String(between(400, 480)), properties: { last_contacted: `day-${day}` } }, runId }, t + 5000);
    }

    // Invoice Assistant: every payment reaches a person, large ones reach two.
    for (let i = between(1, 2); i > 0; i--) {
      const t = at();
      const runId = `run_${newId("i").slice(2, 10)}`;
      const amount = rand() < 0.3 ? between(1100, 2600) : between(180, 900);
      modelCall(invoices, "sandbox-large", t, runId);
      await act(
        invoices,
        "sdk",
        { tool: "pay_invoice", resource: `invoice:INV-${between(3000, 3999)}`, params: { amount, currency: "usd", vendor: pick(["Kathmandu Weavers Co-op", "Everest Freight", "Bhaktapur Pottery Works", "Lumbini Packaging"]) }, runId, explanation: "The invoice matches a purchase order and is due this week." },
        t + 5000,
        { user: admin, decision: rand() < 0.9 ? "approve" : "reject", second: manager },
      );
    }

    // Research Helper (observe mode): reads the web, costs a little.
    for (let i = between(2, 5); i > 0; i--) {
      const t = at();
      const runId = `run_${newId("r").slice(2, 10)}`;
      modelCall(research, "sandbox-large", t, runId);
      await act(research, "mcp_gateway", { tool: "shop.fetch_webpage", params: { url: `https://suppliers.example/prices/${between(1, 40)}` }, runId }, t + 2000);
      modelCall(research, "sandbox-large", t + 6000, runId);
    }
  }

  // An unclassified tool, seen yesterday: the team has not decided what it is yet.
  await act(research, "sdk", { tool: "notion.append_block", params: { page: "Supplier notes", text: "Updated price list." } }, now - 20 * 3_600_000);

  // Two requests waiting right now, so the approvals inbox is not empty.
  await act(
    support,
    "vault",
    { tool: "stripe.refund", params: { charge: "ch_1004", amount: 240, reason: "requested_by_customer" }, runId: "run_demo_pending", explanation: "The customer says the blanket was the wrong colour and wants a full refund." },
    now - 14 * 60_000,
  );
  await act(
    invoices,
    "sdk",
    { tool: "pay_invoice", resource: "invoice:INV-4102", params: { amount: 1840, currency: "usd", vendor: "Everest Freight" }, runId: "run_demo_pending_2", explanation: "Quarterly freight invoice, due on Friday." },
    now - 41 * 60_000,
  );

  if (!getTool(org.id, "stripe.refund")) throw new Error("Seed did not register the vault tools.");
}
