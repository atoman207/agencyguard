// The action catalog: standard action types with default risk levels.
// Every checkpoint translates what it sees into one of these, so rules are
// written once and apply to every agent.

import type { Risk } from "./types";

export interface ActionType {
  id: string;
  label: string;
  category: string;
  risk: Risk;
  reversible: boolean;
  /** Moves real money; `params.amount` is read for limits. */
  money?: boolean;
  /** Sends something outside the company. */
  external?: boolean;
  /** Returns content written by outsiders (web pages, inbound email, files). */
  readsUntrusted?: boolean;
  /** Returns private customer or company data. */
  readsPrivate?: boolean;
  /** Protected against running twice. Reads are not. */
  dedupe: boolean;
  /**
   * How "the same action" is recognised. By default only an identical request
   * is a duplicate. For money and deletion, any second action of this type on
   * the same resource is one (same order, same action), whatever the amount.
   */
  dedupeBy?: "resource";
}

export const ACTIONS: ActionType[] = [
  { id: "payment.refund", label: "Refund a payment", category: "Payments", risk: "high", reversible: false, money: true, dedupe: true, dedupeBy: "resource" },
  { id: "payment.charge", label: "Charge a customer", category: "Payments", risk: "high", reversible: false, money: true, dedupe: true, dedupeBy: "resource" },
  { id: "payment.payout", label: "Pay an invoice or send money", category: "Payments", risk: "critical", reversible: false, money: true, external: true, dedupe: true, dedupeBy: "resource" },
  { id: "email.send", label: "Send an email", category: "Communication", risk: "medium", reversible: false, external: true, dedupe: true },
  { id: "email.read", label: "Read inbound email", category: "Communication", risk: "low", reversible: true, readsUntrusted: true, dedupe: false },
  { id: "message.send", label: "Send a chat message", category: "Communication", risk: "low", reversible: false, external: true, dedupe: true },
  { id: "response.send", label: "Reply to a customer", category: "Communication", risk: "low", reversible: false, external: true, dedupe: false },
  { id: "content.publish", label: "Publish content publicly", category: "Communication", risk: "high", reversible: false, external: true, dedupe: true },
  { id: "crm.read", label: "Read CRM records", category: "CRM", risk: "low", reversible: true, readsPrivate: true, dedupe: false },
  { id: "crm.update", label: "Update a CRM record", category: "CRM", risk: "medium", reversible: true, dedupe: true },
  { id: "crm.delete", label: "Delete a CRM record", category: "CRM", risk: "high", reversible: false, dedupe: true, dedupeBy: "resource" },
  { id: "order.read", label: "Look up an order", category: "Orders", risk: "low", reversible: true, readsPrivate: true, dedupe: false },
  { id: "order.update", label: "Change an order", category: "Orders", risk: "medium", reversible: true, dedupe: true },
  { id: "data.read", label: "Read data", category: "Data", risk: "low", reversible: true, readsPrivate: true, dedupe: false },
  { id: "data.write", label: "Write or update data", category: "Data", risk: "medium", reversible: true, dedupe: true },
  { id: "data.delete", label: "Delete data", category: "Data", risk: "critical", reversible: false, dedupe: true, dedupeBy: "resource" },
  { id: "data.export", label: "Export data outside", category: "Data", risk: "high", reversible: false, external: true, dedupe: true },
  { id: "web.fetch", label: "Read a web page", category: "Web", risk: "low", reversible: true, readsUntrusted: true, dedupe: false },
  { id: "web.post", label: "Send data to a URL", category: "Web", risk: "medium", reversible: false, external: true, dedupe: true },
  { id: "file.read", label: "Read a document", category: "Files", risk: "low", reversible: true, readsUntrusted: true, dedupe: false },
  { id: "code.execute", label: "Run code or shell commands", category: "System", risk: "high", reversible: false, dedupe: false },
  { id: "ai.completion", label: "Call an AI model", category: "AI", risk: "low", reversible: true, dedupe: false },
];

export const UNKNOWN_ACTION: ActionType = {
  id: "unknown",
  label: "Unclassified tool",
  category: "Unknown",
  risk: "high",
  reversible: false,
  dedupe: true,
};

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export function getAction(id: string | null | undefined): ActionType {
  return (id && BY_ID.get(id)) || UNKNOWN_ACTION;
}

export function isKnownAction(id: string | null | undefined): boolean {
  return !!id && BY_ID.has(id);
}

export const ACTION_CATEGORIES = Array.from(new Set(ACTIONS.map((a) => a.category)));

export const RISK_ORDER: Record<Risk, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** `payment.*` style glob matching against an action id or tool name. */
export function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === "*" || pattern === value) return true;
  if (!pattern.includes("*")) return false;
  const re = new RegExp("^" + pattern.split("*").map(escapeRe).join(".*") + "$", "i");
  return re.test(value);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Ordered: destructive and money meanings are checked before generic verbs,
// so "delete_customer" is never suggested as a read.
const HINTS: [RegExp, string][] = [
  [/refund|reimburs|chargeback/, "payment.refund"],
  [/payout|wire|transfer|pay_?invoice|send_?money|disburse/, "payment.payout"],
  [/charge|payment|checkout|bill/, "payment.charge"],
  [/(delete|remove|purge|drop|destroy|erase|truncate|wipe).*(contact|customer|lead|deal|crm|account)/, "crm.delete"],
  [/delete|remove|purge|drop|destroy|erase|truncate|wipe/, "data.delete"],
  [/export|dump|download_?all|backup/, "data.export"],
  [/publish|tweet|post_?(to|on)|broadcast/, "content.publish"],
  [/(read|list|get|fetch|search).*(mail|inbox)|inbox/, "email.read"],
  [/mail|notify_?customer|newsletter|outreach/, "email.send"],
  [/slack|sms|whatsapp|telegram|chat|message|dm\b/, "message.send"],
  [/exec|shell|bash|run_?code|eval|terminal|python/, "code.execute"],
  [/(fetch|browse|scrape|crawl|open|read).*(url|web|page|site|link)|browse|scrape|crawl/, "web.fetch"],
  [/webhook|http_?(post|put|request)|post_?json/, "web.post"],
  [/(read|parse|open|load).*(file|doc|pdf|attachment)/, "file.read"],
  [/(update|edit|change|cancel|modify).*(order|shipping|address)/, "order.update"],
  [/order|shipment|tracking/, "order.read"],
  [/(update|edit|set|create|upsert|add).*(contact|customer|lead|deal|crm|hubspot|salesforce)/, "crm.update"],
  [/contact|customer|lead|deal|crm|hubspot|salesforce/, "crm.read"],
  [/update|edit|set|create|insert|upsert|write|save|add/, "data.write"],
  [/lookup|get|list|search|read|find|query|select|fetch/, "data.read"],
];

/**
 * Suggests a catalog action for a tool name nobody has classified yet.
 * This is keyword matching, not a model; a person always confirms the result.
 */
export function suggestAction(toolName: string): string | null {
  const n = toolName.toLowerCase().replace(/[\s.\-/:]+/g, "_");
  for (const [re, action] of HINTS) if (re.test(n)) return action;
  return null;
}
