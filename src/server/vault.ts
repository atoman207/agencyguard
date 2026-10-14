import "server-only";
import { all, get, run, tx } from "./db";
import { decryptSecret, encryptSecret, newId } from "./crypto";
import { audit, type Actor } from "./audit";
import { RequestError } from "./engine";
import { money } from "@/lib/format";
import type { Credential, Fact, Org } from "@/lib/types";

// The credential vault. Real keys live here, encrypted, and never leave: an
// agent holds only an AgentGuard token and asks the vault to act on its behalf.
//
// Every connector has a sandbox mode that simulates the outside service against
// local tables, so the whole flow can be exercised without real accounts. Live
// mode calls the real API. Live mode has not been tested against real accounts.

export interface ConnectorParam {
  name: string;
  label: string;
  type: "string" | "number" | "object";
  required: boolean;
  example: string;
}

export interface ConnectorAction {
  id: string;
  /** Catalog action this maps to. AgentGuard defines it, so no human classification is needed. */
  action: string;
  label: string;
  params: ConnectorParam[];
  liveSupported: boolean;
}

export interface ConnectorDef {
  id: string;
  label: string;
  description: string;
  kind: "tool" | "model";
  secretLabel: string;
  actions: ConnectorAction[];
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "stripe",
    label: "Stripe",
    description: "Refunds and charges. Amounts and the customer are read from Stripe, not from the agent.",
    kind: "tool",
    secretLabel: "Secret key (sk_...)",
    actions: [
      {
        id: "refund", action: "payment.refund", label: "Refund a charge", liveSupported: true,
        params: [
          { name: "charge", label: "Charge ID", type: "string", required: true, example: "ch_1001" },
          { name: "amount", label: "Amount", type: "number", required: true, example: "450" },
          { name: "reason", label: "Reason", type: "string", required: false, example: "requested_by_customer" },
        ],
      },
      {
        id: "charge", action: "payment.charge", label: "Charge a customer", liveSupported: false,
        params: [
          { name: "customer", label: "Customer ID", type: "string", required: true, example: "cus_2001" },
          { name: "amount", label: "Amount", type: "number", required: true, example: "120" },
          { name: "description", label: "Description", type: "string", required: false, example: "Order #5521" },
        ],
      },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    description: "Post messages as your workspace bot.",
    kind: "tool",
    secretLabel: "Bot token (xoxb-...)",
    actions: [
      {
        id: "message", action: "message.send", label: "Post a message", liveSupported: true,
        params: [
          { name: "channel", label: "Channel", type: "string", required: true, example: "#support" },
          { name: "text", label: "Text", type: "string", required: true, example: "Refund issued for order 5521." },
        ],
      },
    ],
  },
  {
    id: "hubspot",
    label: "HubSpot",
    description: "Update contacts and deals.",
    kind: "tool",
    secretLabel: "Private app token (pat-...)",
    actions: [
      {
        id: "update_contact", action: "crm.update", label: "Update a contact", liveSupported: true,
        params: [
          { name: "contact_id", label: "Contact ID", type: "string", required: true, example: "501" },
          { name: "properties", label: "Properties", type: "object", required: true, example: '{"lifecyclestage":"customer"}' },
        ],
      },
      {
        id: "update_deal", action: "crm.update", label: "Update a deal", liveSupported: true,
        params: [
          { name: "deal_id", label: "Deal ID", type: "string", required: true, example: "9001" },
          { name: "properties", label: "Properties", type: "object", required: true, example: '{"dealstage":"closedwon"}' },
        ],
      },
    ],
  },
  {
    id: "openai",
    label: "AI provider (OpenAI-compatible)",
    description: "The real provider key for the AI-model gateway. Agents call the gateway with their AgentGuard token instead.",
    kind: "model",
    secretLabel: "Provider API key",
    actions: [],
  },
];

export const getConnector = (id: string) => CONNECTORS.find((c) => c.id === id);

// --- credential storage --------------------------------------------------------

interface StoredSecret {
  apiKey: string;
  baseUrl?: string;
}

export async function listCredentials(orgId: string): Promise<Credential[]> {
  return await all<Credential>("SELECT id, org_id, connector, label, mode, hint, keys_rotated, created_at FROM credentials WHERE org_id = ? ORDER BY created_at ASC", orgId);
}

export async function getCredential(orgId: string, connector: string): Promise<Credential | undefined> {
  return await get<Credential>("SELECT id, org_id, connector, label, mode, hint, keys_rotated, created_at FROM credentials WHERE org_id = ? AND connector = ?", orgId, connector);
}

export async function saveCredential(
  org: Org,
  actor: Actor,
  input: { connector: string; mode: "sandbox" | "live"; apiKey: string; baseUrl?: string },
  now: number,
): Promise<void> {
  const def = getConnector(input.connector);
  if (!def) throw new Error("Unknown connector.");
  const apiKey = input.apiKey.trim();
  if (input.mode === "live" && !apiKey) throw new Error("Live mode needs the real key.");
  const secret: StoredSecret = { apiKey, baseUrl: input.baseUrl?.trim() || undefined };
  const hint = apiKey ? `…${apiKey.slice(-4)}` : "sandbox";
  await tx(async () => {
    await run("DELETE FROM credentials WHERE org_id = ? AND connector = ?", org.id, def.id);
    await run(
      "INSERT INTO credentials (id, org_id, connector, label, mode, secret, hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      newId("cred"), org.id, def.id, def.label, input.mode, encryptSecret(JSON.stringify(secret)), hint, now,
    );
    // The key itself is never written to the audit log.
    await audit(org.id, actor, "vault.credential_saved", { type: "credential", id: def.id }, { connector: def.id, mode: input.mode }, now);
  });
}

export async function deleteCredential(org: Org, actor: Actor, connector: string, now: number): Promise<void> {
  if (await run("DELETE FROM credentials WHERE org_id = ? AND connector = ?", org.id, connector)) {
    await audit(org.id, actor, "vault.credential_removed", { type: "credential", id: connector }, { connector }, now);
  }
}

export async function setKeysRotated(org: Org, actor: Actor, connector: string, rotated: boolean, now: number): Promise<void> {
  if (await run("UPDATE credentials SET keys_rotated = ? WHERE org_id = ? AND connector = ?", rotated ? 1 : 0, org.id, connector)) {
    await audit(org.id, actor, "vault.keys_rotated_confirmed", { type: "credential", id: connector }, { connector, rotated }, now);
  }
}

export async function readSecret(orgId: string, connector: string): Promise<{ mode: "sandbox" | "live"; apiKey: string; baseUrl?: string } | null> {
  const row = await get<{ mode: "sandbox" | "live"; secret: string }>("SELECT mode, secret FROM credentials WHERE org_id = ? AND connector = ?", orgId, connector);
  if (!row) return null;
  return { mode: row.mode, ...(JSON.parse(decryptSecret(row.secret)) as StoredSecret) };
}

// --- connector behaviour -------------------------------------------------------

export interface Prepared {
  /** Parameters after the source system corrected them (e.g. the charge's real customer). */
  params: Record<string, unknown>;
  resource: string | null;
  facts: Fact[];
}

interface Charge {
  id: string;
  customer: string;
  customer_name: string;
  customer_email: string;
  amount: number;
  currency: string;
  refunded: number;
  description: string;
  created_at: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

async function stripeGet(apiKey: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new RequestError(`Stripe: ${str((body.error as Record<string, unknown>)?.message) || res.statusText}`, 422, "connector_error");
  return body;
}

async function loadCharge(orgId: string, secret: { mode: string; apiKey: string }, id: string): Promise<Charge> {
  if (secret.mode === "sandbox") {
    const charge = await get<Charge>("SELECT * FROM sandbox_charges WHERE org_id = ? AND id = ?", orgId, id);
    if (!charge) throw new RequestError(`Stripe sandbox: no such charge "${id}".`, 422, "connector_error");
    return charge;
  }
  const c = await stripeGet(secret.apiKey, `charges/${encodeURIComponent(id)}`);
  const billing = (c.billing_details ?? {}) as Record<string, unknown>;
  // Stripe amounts are in the smallest currency unit. This assumes two-decimal currencies.
  return {
    id, customer: str(c.customer) || "unknown", customer_name: str(billing.name) || "—", customer_email: str(billing.email) || "—",
    amount: Number(c.amount) / 100, currency: str(c.currency) || "usd", refunded: Number(c.amount_refunded ?? 0) / 100,
    description: str(c.description) || "—", created_at: Number(c.created) * 1000,
  };
}

/**
 * Reads the facts for an action from the source system before any rule runs.
 * Limits and approvers then work from what Stripe says, not what the agent says.
 */
export async function prepare(org: Org, connector: string, action: ConnectorAction, raw: Record<string, unknown>): Promise<Prepared> {
  const secret = await readSecret(org.id, connector);
  if (!secret) throw new RequestError(`The ${connector} connector is not connected in the vault.`, 422, "connector_not_connected");
  if (secret.mode === "live" && !action.liveSupported) throw new RequestError(`${action.label} is available in sandbox mode only for now.`, 422, "not_supported");

  const params: Record<string, unknown> = {};
  for (const p of action.params) {
    let value = raw[p.name];
    if (p.type === "object" && typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        throw new RequestError(`"${p.name}" must be a JSON object.`);
      }
    }
    if (value === undefined || value === null || value === "") {
      if (p.required) throw new RequestError(`Missing required parameter "${p.name}".`);
      continue;
    }
    if (p.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value as number) || (value as number) <= 0) throw new RequestError(`"${p.name}" must be a positive number.`);
    } else if (p.type === "string") {
      value = String(value);
    } else if (typeof value !== "object" || Array.isArray(value)) {
      throw new RequestError(`"${p.name}" must be an object.`);
    }
    params[p.name] = value;
  }

  const label = getConnector(connector)!.label + (secret.mode === "sandbox" ? " (sandbox)" : "");
  if (connector === "stripe" && action.id === "refund") {
    const charge = await loadCharge(org.id, secret, str(params.charge));
    const remaining = charge.amount - charge.refunded;
    params.customer = charge.customer;
    params.currency = charge.currency;
    const amount = params.amount as number;
    return {
      params,
      resource: `stripe:charge/${charge.id}`,
      facts: [
        { label: "Original charge", value: `${money(charge.amount, charge.currency)} — ${charge.description}`, source: label },
        { label: "Customer", value: `${charge.customer_name} (${charge.customer_email})`, source: label },
        { label: "Refund requested", value: money(amount, charge.currency), source: label, tone: amount > remaining ? "danger" : "neutral" },
        {
          label: "Already refunded on this charge",
          value: charge.refunded ? `${money(charge.refunded, charge.currency)} — ${money(remaining, charge.currency)} left` : "Nothing yet",
          source: label,
          tone: charge.refunded ? "warn" : "good",
        },
        ...(amount > remaining ? [{ label: "Problem", value: "The refund is larger than what is left on the charge. Stripe will refuse it.", source: label, tone: "danger" as const }] : []),
      ],
    };
  }
  if (connector === "stripe") {
    params.currency = str(raw.currency) || "usd";
    return { params, resource: null, facts: [{ label: "Charge requested", value: `${money(params.amount as number, str(params.currency))} to ${str(params.customer)}`, source: label }] };
  }
  if (connector === "slack") {
    return { params, resource: null, facts: [{ label: "Channel", value: str(params.channel), source: label }, { label: "Message", value: str(params.text).slice(0, 400), source: label }] };
  }
  const idKey = action.id === "update_deal" ? "deal_id" : "contact_id";
  const kind = action.id === "update_deal" ? "deal" : "contact";
  return {
    params,
    resource: `hubspot:${kind}/${str(params[idKey])}`,
    facts: [{ label: `Fields to change on ${kind} ${str(params[idKey])}`, value: Object.keys(params.properties as object).join(", ") || "none", source: label }],
  };
}

/** Runs the action against the outside service. `idempotencyKey` is the event id, so a re-run can never act twice. */
export async function execute(
  org: Org,
  connector: string,
  actionId: string,
  params: Record<string, unknown>,
  idempotencyKey: string,
  now: number,
): Promise<Record<string, unknown>> {
  const secret = await readSecret(org.id, connector);
  if (!secret) throw new Error(`The ${connector} connector is no longer connected.`);
  return secret.mode === "sandbox" ? await sandbox(org.id, connector, actionId, params, idempotencyKey, now) : await live(secret, connector, actionId, params, idempotencyKey);
}

async function sandbox(orgId: string, connector: string, actionId: string, params: Record<string, unknown>, idempotencyKey: string, now: number): Promise<Record<string, unknown>> {
  return await tx(async () => {
    const replay = await get<{ response: string }>("SELECT response FROM sandbox_log WHERE org_id = ? AND connector = ? AND idempotency_key = ?", orgId, connector, idempotencyKey);
    if (replay) return { ...(JSON.parse(replay.response) as Record<string, unknown>), idempotent_replay: true };

    let response: Record<string, unknown>;
    if (connector === "stripe" && actionId === "refund") {
      const charge = await get<Charge>("SELECT * FROM sandbox_charges WHERE org_id = ? AND id = ?", orgId, str(params.charge));
      if (!charge) throw new Error(`No such charge: ${str(params.charge)}`);
      const amount = params.amount as number;
      if (amount > charge.amount - charge.refunded + 1e-9) throw new Error(`Refund amount (${money(amount, charge.currency)}) is greater than the unrefunded amount on the charge (${money(charge.amount - charge.refunded, charge.currency)}).`);
      await run("UPDATE sandbox_charges SET refunded = refunded + ? WHERE org_id = ? AND id = ?", amount, orgId, charge.id);
      response = { id: newId("re"), object: "refund", charge: charge.id, amount, currency: charge.currency, status: "succeeded" };
    } else if (connector === "stripe") {
      const id = newId("ch");
      await run(
        "INSERT INTO sandbox_charges (id, org_id, customer, customer_name, customer_email, amount, currency, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, orgId, str(params.customer), str(params.customer), "—", params.amount as number, str(params.currency) || "usd", str(params.description) || "Charge", now,
      );
      response = { id, object: "charge", amount: params.amount, currency: str(params.currency) || "usd", status: "succeeded" };
    } else if (connector === "slack") {
      response = { ok: true, channel: params.channel, ts: (now / 1000).toFixed(6) };
    } else {
      response = { id: str(params.contact_id ?? params.deal_id), properties: params.properties, updatedAt: new Date(now).toISOString() };
    }
    await run(
      "INSERT INTO sandbox_log (id, org_id, connector, action, idempotency_key, request, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      newId("sbx"), orgId, connector, actionId, idempotencyKey, JSON.stringify(params), JSON.stringify(response), now,
    );
    return { ...response, sandbox: true };
  });
}

async function live(secret: { apiKey: string }, connector: string, actionId: string, params: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(20_000);
  const bearer = { authorization: `Bearer ${secret.apiKey}` };
  let res: Response;
  if (connector === "stripe" && actionId === "refund") {
    const form = new URLSearchParams({ charge: str(params.charge), amount: String(Math.round((params.amount as number) * 100)) });
    if (params.reason) form.set("reason", str(params.reason));
    // Stripe's own idempotency key is used as well as ours.
    res = await fetch("https://api.stripe.com/v1/refunds", { method: "POST", headers: { ...bearer, "idempotency-key": idempotencyKey, "content-type": "application/x-www-form-urlencoded" }, body: form, signal });
  } else if (connector === "slack") {
    res = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { ...bearer, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: params.channel, text: params.text }), signal });
  } else if (connector === "hubspot") {
    const [object, id] = actionId === "update_deal" ? ["deals", params.deal_id] : ["contacts", params.contact_id];
    res = await fetch(`https://api.hubapi.com/crm/v3/objects/${object}/${encodeURIComponent(str(id))}`, { method: "PATCH", headers: { ...bearer, "content-type": "application/json" }, body: JSON.stringify({ properties: params.properties }), signal });
  } else {
    throw new Error(`${connector}.${actionId} is not available in live mode.`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Slack answers 200 with ok:false on failure.
  if (!res.ok || body.ok === false) {
    const message = str((body.error as Record<string, unknown>)?.message) || str(body.error) || str(body.message) || `HTTP ${res.status}`;
    throw new Error(`${connector}: ${message}`);
  }
  return body;
}

export async function listSandboxCharges(orgId: string): Promise<Charge[]> {
  return await all<Charge>("SELECT * FROM sandbox_charges WHERE org_id = ? ORDER BY created_at DESC", orgId);
}
