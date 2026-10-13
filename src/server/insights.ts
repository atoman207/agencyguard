import "server-only";
import { all, get } from "./db";
import { listAgents } from "./agents";
import { listLimits } from "./limits";
import { listRules } from "./rules";
import { listAgentTools, type AgentToolView } from "./tools";
import { listCredentials } from "./vault";
import { RISK_ORDER, getAction } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { Agent, Connection, Org } from "@/lib/types";

const DAY = 86_400_000;

function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export interface DayBucket {
  key: string;
  label: string;
  allowed: number;
  asked: number;
  blocked: number;
  cost: number;
}

export interface Overview {
  actions: number;
  asked: number;
  blocked: number;
  aiCost: number;
  aiCalls: number;
  moneyMoved: number;
  pending: number;
  days: DayBucket[];
  observeFindings: number;
}

interface SlimEvent {
  agent_id: string;
  action: string;
  would_decision: string;
  status: string;
  observe: number;
  cost_usd: number;
  amount: number | null;
  money_state: string;
  created_at: number;
}

function recentEvents(orgId: string, since: number): SlimEvent[] {
  return all<SlimEvent>(
    "SELECT agent_id, action, would_decision, status, observe, cost_usd, amount, money_state, created_at FROM events WHERE org_id = ? AND created_at >= ?",
    orgId,
    since,
  );
}

/** The last seven days, bucketed by calendar day in the organization's time zone. */
export function overview(org: Org, now: number): Overview {
  const tz = org.settings.timezone;
  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const ms = now - i * DAY;
    days.push({
      key: dayKey(ms, tz),
      label: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric" }).format(ms),
      allowed: 0, asked: 0, blocked: 0, cost: 0,
    });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  const out: Overview = { actions: 0, asked: 0, blocked: 0, aiCost: 0, aiCalls: 0, moneyMoved: 0, pending: 0, days, observeFindings: 0 };

  for (const e of recentEvents(org.id, now - 7 * DAY)) {
    const bucket = byKey.get(dayKey(e.created_at, tz));
    out.aiCost += e.cost_usd;
    if (bucket) bucket.cost += e.cost_usd;
    if (e.action === "ai.completion") {
      out.aiCalls++;
      if (e.would_decision !== "BLOCK") continue;
    }
    if (e.status === "duplicate") continue;
    out.actions++;
    if (e.money_state === "settled" && e.amount) out.moneyMoved += e.amount;
    const kind = e.would_decision === "BLOCK" ? "blocked" : e.would_decision === "ASK_HUMAN" ? "asked" : "allowed";
    if (kind === "blocked") out.blocked++;
    if (kind === "asked") out.asked++;
    if (e.observe && kind !== "allowed") out.observeFindings++;
    if (bucket) bucket[kind]++;
  }
  out.pending = get<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE org_id = ? AND status = 'pending'", org.id)!.n;
  return out;
}

// --- per-agent numbers and health ------------------------------------------------

export interface AgentStats {
  agent: Agent;
  actions: number;
  asked: number;
  blocked: number;
  failed: number;
  cost: number;
  lastSeen: number | null;
  health: Health;
}

export interface Health {
  score: number;
  label: "Healthy" | "Watch" | "Needs attention" | "Stopped" | "No activity";
  parts: { label: string; penalty: number; detail: string }[];
}

/**
 * Agent health: one number from errors, blocks, approvals and cost trend.
 * It starts at 100 and loses points for each. The weights are a starting point
 * to tune with design partners, not a measured model.
 */
function health(agent: Agent, s: { actions: number; asked: number; blocked: number; failed: number; costRecent: number; costEarlier: number }): Health {
  if (agent.status === "killed") return { score: 0, label: "Stopped", parts: [{ label: "Kill switch", penalty: 100, detail: "The agent is stopped." }] };
  if (s.actions === 0 && s.costRecent + s.costEarlier === 0) return { score: 100, label: "No activity", parts: [] };
  const parts: Health["parts"] = [];
  const rate = (n: number) => (s.actions ? n / s.actions : 0);
  const add = (label: string, penalty: number, detail: string) => penalty >= 1 && parts.push({ label, penalty: Math.round(penalty), detail });
  add("Failed actions", Math.min(40, rate(s.failed) * 200), `${s.failed} of ${s.actions} actions failed`);
  add("Blocked attempts", Math.min(30, rate(s.blocked) * 150), `${s.blocked} of ${s.actions} actions were, or would have been, blocked`);
  add("Approvals needed", Math.min(15, rate(s.asked) * 40), `${s.asked} of ${s.actions} actions needed a person`);
  // Daily average over the last 3 days against the 4 days before.
  const recent = s.costRecent / 3;
  const earlier = s.costEarlier / 4;
  if (earlier > 0 && recent > earlier * 2) add("Rising AI cost", 10, "Daily AI cost has more than doubled this week");
  if (agent.status === "paused") add("Paused", 15, agent.status_reason ?? "The agent is paused");
  const score = Math.max(0, 100 - parts.reduce((n, p) => n + p.penalty, 0));
  return { score, label: score >= 85 ? "Healthy" : score >= 65 ? "Watch" : "Needs attention", parts };
}

export function agentStats(org: Org, now: number): AgentStats[] {
  const events = recentEvents(org.id, now - 7 * DAY);
  const lastSeen = new Map(all<{ agent_id: string; t: number }>("SELECT agent_id, MAX(created_at) AS t FROM events WHERE org_id = ? GROUP BY agent_id", org.id).map((r) => [r.agent_id, r.t]));
  return listAgents(org.id).map((agent) => {
    const s = { actions: 0, asked: 0, blocked: 0, failed: 0, cost: 0, costRecent: 0, costEarlier: 0 };
    for (const e of events) {
      if (e.agent_id !== agent.id) continue;
      s.cost += e.cost_usd;
      if (e.created_at >= now - 3 * DAY) s.costRecent += e.cost_usd;
      else s.costEarlier += e.cost_usd;
      if (e.status === "duplicate" || (e.action === "ai.completion" && e.would_decision !== "BLOCK")) continue;
      s.actions++;
      if (e.would_decision === "BLOCK") s.blocked++;
      if (e.would_decision === "ASK_HUMAN") s.asked++;
      if (e.status === "failed") s.failed++;
    }
    return { agent, actions: s.actions, asked: s.asked, blocked: s.blocked, failed: s.failed, cost: s.cost, lastSeen: lastSeen.get(agent.id) ?? null, health: health(agent, s) };
  });
}

// --- coverage ----------------------------------------------------------------------

export type Level = "enforced" | "cooperative" | "uncovered";

export const levelOf = (c: Connection): Level => (c === "uncovered" ? "uncovered" : c === "cooperative" ? "cooperative" : "enforced");

// A high-risk tool matters more to the score than a harmless read.
const WEIGHT = { low: 1, medium: 2, high: 4, critical: 6 } as const;

export interface CoverageShare {
  enforced: number;
  cooperative: number;
  uncovered: number;
  tools: number;
}

export interface CoverageRow extends AgentToolView {
  level: Level;
  risk: keyof typeof WEIGHT;
  /** Enforced only holds once the old keys are gone. */
  caveat: string | null;
}

export interface Coverage {
  total: CoverageShare;
  agents: { agent: Agent; share: CoverageShare; rows: CoverageRow[] }[];
  gaps: { agent: Agent; row: CoverageRow; advice: string }[];
}

function share(rows: CoverageRow[]): CoverageShare {
  const w = { enforced: 0, cooperative: 0, uncovered: 0 };
  for (const r of rows) w[r.level] += WEIGHT[r.risk];
  const sum = w.enforced + w.cooperative + w.uncovered;
  if (sum === 0) return { enforced: 0, cooperative: 0, uncovered: 0, tools: 0 };
  const enforced = Math.round((w.enforced / sum) * 100);
  const cooperative = Math.round((w.cooperative / sum) * 100);
  return { enforced, cooperative, uncovered: 100 - enforced - cooperative, tools: rows.length };
}

/** Which agents and tools are enforced, cooperative or not covered, weighted by risk. */
export function coverage(org: Org): Coverage {
  const rotated = new Map(listCredentials(org.id).map((c) => [c.connector, c]));
  const links = listAgentTools(org.id);
  const agents = listAgents(org.id).map((agent) => {
    const rows: CoverageRow[] = links
      .filter((l) => l.agent_id === agent.id)
      .map((l) => {
        const risk = l.status === "confirmed" ? getAction(l.action).risk : "high";
        const level = levelOf(l.connection);
        let caveat: string | null = null;
        const cred = l.connection === "vault" ? rotated.get(l.name.split(".")[0]) : l.connection === "ai_gateway" ? rotated.get("openai") : undefined;
        if (cred && cred.mode === "live" && !cred.keys_rotated) caveat = "Holds once the old key is rotated and exists only in AgentGuard.";
        if (l.connection === "mcp_gateway") caveat = "Holds if the agent cannot reach the MCP server directly.";
        return { ...l, level, risk, caveat };
      });
    return { agent, share: share(rows), rows };
  });
  const gaps: Coverage["gaps"] = [];
  for (const a of agents) {
    for (const row of a.rows) {
      if (row.status !== "confirmed") gaps.push({ agent: a.agent, row, advice: "Classify this tool. Until then every call asks a person." });
      else if (row.level === "uncovered") gaps.push({ agent: a.agent, row, advice: "AgentGuard cannot see or stop this. Route it through a checkpoint, or remove the agent's direct access." });
      else if (row.level === "cooperative" && RISK_ORDER[row.risk] >= RISK_ORDER.high) gaps.push({ agent: a.agent, row, advice: "High-risk and only cooperative: the agent could skip the check. Move it to the vault or a gateway." });
    }
  }
  gaps.sort((x, y) => RISK_ORDER[y.row.risk] - RISK_ORDER[x.row.risk]);
  return { total: share(agents.flatMap((a) => a.rows)), agents, gaps };
}

// --- recommendations and journey ------------------------------------------------------

export interface Recommendation {
  title: string;
  body: string;
  href: string;
  cta: string;
  tone: "warn" | "info";
}

/** Suggestions drawn from real activity. Each one is for a person to accept; nothing changes by itself. */
export function recommendations(org: Org, now: number): Recommendation[] {
  const out: Recommendation[] = [];
  const stats = agentStats(org, now);
  const cov = coverage(org);

  for (const s of stats) {
    if (s.agent.mode === "observe" && s.agent.status === "active" && s.asked + s.blocked > 0) {
      out.push({
        tone: "warn",
        title: `${s.agent.name} is only being observed`,
        body: `In the last 7 days ${s.asked} of its actions would have needed approval and ${s.blocked} would have been blocked. Nothing was stopped.`,
        href: `/activity?agent=${s.agent.id}&decision=ASK_HUMAN`,
        cta: "Review what would have happened",
      });
    }
  }
  const unclassified = cov.gaps.filter((g) => g.row.status !== "confirmed");
  if (unclassified.length) {
    out.push({ tone: "warn", title: `${unclassified.length} ${unclassified.length === 1 ? "tool needs" : "tools need"} classifying`, body: `${unclassified.map((g) => g.row.name).slice(0, 3).join(", ")}. Unclassified tools ask a person on every call.`, href: "/tools", cta: "Classify tools" });
  }
  const risky = cov.gaps.filter((g) => g.row.status === "confirmed" && g.row.level !== "enforced");
  if (risky.length) {
    out.push({ tone: "warn", title: `${risky.length} high-risk ${risky.length === 1 ? "tool is" : "tools are"} not enforced`, body: `${risky[0].agent.name}: ${risky[0].row.name}. ${risky[0].advice}`, href: "/coverage", cta: "See coverage gaps" });
  }

  // Approvals that always end the same way are candidates for a rule.
  const patterns = all<{ action: string; approved: number; rejected: number; top: number | null }>(
    `SELECT e.action AS action,
            SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
            MAX(CASE WHEN a.status = 'approved' THEN e.amount END) AS top
     FROM approvals a JOIN events e ON e.id = a.event_id
     WHERE a.org_id = ? AND a.kind = 'action' AND a.created_at >= ? GROUP BY e.action`,
    org.id,
    now - 30 * DAY,
  );
  for (const p of patterns) {
    if (p.approved >= 5 && p.rejected === 0) {
      out.push({
        tone: "info",
        title: `You approved all ${p.approved} "${getAction(p.action).label.toLowerCase()}" requests`,
        body: `None were rejected${p.top ? `; the largest was ${money(p.top)}` : ""}. If the smaller ones are routine, an allow rule would spare your approvers. Test it with policy replay first.`,
        href: "/rules/new",
        cta: "Draft a rule",
      });
    }
  }

  const budgeted = new Set(listLimits(org.id).filter((l) => l.kind === "cost" && l.enabled).map((l) => l.agent_id ?? "*"));
  const unbudgeted = stats.filter((s) => s.cost > 0 && !budgeted.has("*") && !budgeted.has(s.agent.id));
  if (unbudgeted.length) {
    out.push({ tone: "info", title: `${unbudgeted.length} ${unbudgeted.length === 1 ? "agent has" : "agents have"} no AI budget`, body: `${unbudgeted.map((s) => s.agent.name).join(", ")} can spend on AI models without a ceiling.`, href: "/limits", cta: "Set a budget" });
  }
  if (listRules(org.id).length === 0) {
    out.push({ tone: "info", title: "No rules yet", body: "Start from a template for your kind of agent, then adjust it.", href: "/rules", cta: "Browse templates" });
  }
  return out;
}

export interface JourneyStep {
  id: string;
  name: string;
  gain: string;
  done: boolean;
}

/** The customer journey from the product document, with each step judged from the workspace's own state. */
export function journey(org: Org): JourneyStep[] {
  const agents = listAgents(org.id);
  const hasEvents = !!get("SELECT 1 AS x FROM events WHERE org_id = ? LIMIT 1", org.id);
  const rules = listRules(org.id).filter((r) => r.enabled);
  const enforcing = agents.filter((a) => a.mode === "enforce");
  const enforcedMoney = !!get(
    "SELECT 1 AS x FROM events WHERE org_id = ? AND enforcement = 'enforced' AND action IN ('payment.refund', 'payment.charge', 'payment.payout', 'data.delete', 'crm.delete') AND status = 'executed' LIMIT 1",
    org.id,
  );
  return [
    { id: "observe", name: "Observe", gain: "See actions, costs and risks", done: hasEvents },
    { id: "recommend", name: "Recommend", gain: "Rules suggested from real activity", done: rules.length > 0 },
    { id: "control", name: "Control", gain: "Risky actions need approval", done: rules.length > 0 && enforcing.length > 0 },
    { id: "enforce", name: "Enforce", gain: "Money actions cannot skip the rules", done: enforcedMoney },
    { id: "scale", name: "Scale", gain: "The same rules across every agent", done: enforcing.length >= 3 && !!get("SELECT 1 AS x FROM rules WHERE org_id = ? AND template IS NOT NULL LIMIT 1", org.id) },
  ];
}
