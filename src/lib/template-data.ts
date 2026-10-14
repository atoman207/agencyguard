// Template packs: ready-made rules and limits for common kinds of agent.
//
// This file is the built-in copy. The same data lives in Supabase (see
// supabase/database.sql), which is where the app reads it from. `npm run
// sql:build` regenerates that SQL block; `npm run supabase:seed` can also write
// via the API. The app falls back here whenever Supabase cannot be reached. It
// must stay free of server-only imports so those scripts can load it directly.

export type TemplateEffect = "allow" | "ask_human" | "ask_two" | "block";

export interface TemplateCondition {
  field: string;
  op: string;
  value: string | number | boolean | string[];
}

export interface TemplateRule {
  name: string;
  description?: string;
  conditions: TemplateCondition[];
  effect: TemplateEffect;
}

export interface TemplateLimit {
  name: string;
  kind: "money" | "cost" | "count";
  scope: "action" | "customer" | "resource" | "agent" | "organization";
  action: string | null;
  period: "action" | "hour" | "day" | "week" | "month";
  value: number;
  onExceed: "block" | "ask_human";
}

export interface TemplatePack {
  id: string;
  name: string;
  audience: string;
  description: string;
  rules: TemplateRule[];
  limits: TemplateLimit[];
}

const is = (field: string, value: string): TemplateCondition => ({ field, op: "is", value });

export const BUILTIN_TEMPLATE_PACKS: TemplatePack[] = [
  {
    id: "ecommerce-support",
    name: "E-commerce support",
    audience: "Agents that answer customers and issue refunds",
    description: "Small refunds flow through; large ones, repeat refunds to one customer and anything destructive reach a person.",
    rules: [
      { name: "Small refunds are automatic", description: "Refunds up to 100 need no approval.", effect: "allow", conditions: [is("action", "payment.refund"), { field: "amount", op: "lte", value: 100 }] },
      { name: "Large refunds need a manager", description: "A single refund above 100 waits for a person.", effect: "ask_human", conditions: [is("action", "payment.refund"), { field: "amount", op: "gt", value: 100 }] },
      { name: "Never delete data in production", description: "Deleting data in production is blocked outright.", effect: "block", conditions: [is("action", "data.delete"), is("environment", "production")] },
      { name: "Deleting a customer needs a person", effect: "ask_human", conditions: [is("action", "crm.delete")] },
    ],
    limits: [
      { name: "Refunds per customer per week", kind: "money", scope: "customer", action: "payment.refund", period: "week", value: 150, onExceed: "ask_human" },
      { name: "Refunds per agent per day", kind: "money", scope: "agent", action: "payment.refund", period: "day", value: 2000, onExceed: "block" },
      { name: "Daily AI budget per agent", kind: "cost", scope: "agent", action: null, period: "day", value: 5, onExceed: "block" },
    ],
  },
  {
    id: "sales-outreach",
    name: "Sales outreach",
    audience: "Agents that send email on your behalf",
    description: "Stops the wrong-list mistake: large sends wait for approval and mass blasts are blocked.",
    rules: [
      { name: "Large sends need approval", description: "More than 50 recipients in one send waits for a person.", effect: "ask_human", conditions: [is("action", "email.send"), { field: "recipient_count", op: "gt", value: 50 }] },
      { name: "No mass blasts", description: "More than 500 recipients in one send is blocked.", effect: "block", conditions: [is("action", "email.send"), { field: "recipient_count", op: "gt", value: 500 }] },
      { name: "Outreach outside working hours needs approval", effect: "ask_human", conditions: [is("action", "email.send"), { field: "hour", op: "not_between", value: "8-19" }] },
    ],
    limits: [{ name: "Emails per agent per day", kind: "count", scope: "agent", action: "email.send", period: "day", value: 200, onExceed: "block" }],
  },
  {
    id: "finance-operations",
    name: "Finance operations",
    audience: "Agents that pay invoices or move money",
    description: "Every payment reaches a person, large ones reach two, and there is a hard daily cap.",
    rules: [
      { name: "Payments always need a person", effect: "ask_human", conditions: [is("action", "payment.payout")] },
      { name: "Large payments need two people", description: "Payments of 1,000 or more need two different approvers.", effect: "ask_two", conditions: [is("action", "payment.payout"), { field: "amount", op: "gte", value: 1000 }] },
      { name: "Small charges are automatic", effect: "allow", conditions: [is("action", "payment.charge"), { field: "amount", op: "lte", value: 500 }] },
      { name: "Charges above 500 need approval", effect: "ask_human", conditions: [is("action", "payment.charge"), { field: "amount", op: "gt", value: 500 }] },
    ],
    limits: [{ name: "Daily payment cap", kind: "money", scope: "organization", action: "payment.payout", period: "day", value: 10000, onExceed: "block" }],
  },
  {
    id: "customer-support",
    name: "Customer support",
    audience: "Agents that handle tickets and orders",
    description: "Everyday order changes are allowed; exporting data is blocked and public posts wait for approval.",
    rules: [
      { name: "Order changes are allowed", effect: "allow", conditions: [is("action", "order.update")] },
      { name: "Publishing needs approval", effect: "ask_human", conditions: [is("action", "content.publish")] },
      { name: "No data exports", effect: "block", conditions: [is("action", "data.export")] },
    ],
    limits: [{ name: "Monthly AI budget", kind: "cost", scope: "organization", action: null, period: "month", value: 200, onExceed: "block" }],
  },
];
