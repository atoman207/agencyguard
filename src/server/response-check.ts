import "server-only";
import { tx } from "./db";
import { fingerprint, newId } from "./crypto";
import { agentActor } from "./agents";
import { audit } from "./audit";
import { createApproval } from "./approvals";
import { insertEvent, updateEvent } from "./events";
import { connectionFor, sightTool, upsertTool } from "./tools";
import { ENFORCED_SOURCES, type ActionEvent, type Agent, type AppliedRule, type Decision, type Org, type ResponseAction, type Source } from "@/lib/types";

// The response checkpoint: what an agent says can cost as much as what it does.
//
// Detection here is pattern matching. It catches the obvious cases (a promised
// refund, a quoted price, an email address in a reply) and will miss rephrased
// ones; a production version would add a classifier model behind the same
// interface.

export type FindingType = "commitment" | "price" | "personal_data" | "forbidden";

export interface Finding {
  type: FindingType;
  label: string;
  snippet: string;
}

const COMMITMENTS: [RegExp, string][] = [
  [/\b(we|i)\s*('ll| will| can| shall| am going to| are going to)\s+(fully\s+)?(refund|reimburse|compensate|credit|replace|waive|cancel)/i, "Promises a refund or compensation"],
  [/\b(refund|credit|compensation)\s+(has been|was|is being|will be)\s+(issued|processed|approved|sent)/i, "States a refund was issued"],
  [/\b(full refund|money[- ]back|free of charge|at no (extra )?cost|no questions asked)\b/i, "Promises a refund or free service"],
  [/\b(guarantee[ds]?|promise[ds]?|you are entitled to|you're entitled to|you are eligible for|you qualify for)\b/i, "Makes a guarantee or entitlement claim"],
  [/\b(our|the company'?s?|store) policy\b/i, "States a company policy"],
];

const PRICES: [RegExp, string][] = [
  [/(?:\$|€|£|₹|\bUSD\s?|\bNPR\s?|\bRs\.?\s?)\d[\d,]*(?:\.\d+)?/i, "Quotes a price"],
  [/\b\d{1,3}\s?%\s*(off|discount)\b/i, "Offers a discount"],
  [/\b(discount|coupon|promo(tional)?) code\b/i, "Offers a discount code"],
];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{3,4}/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index - 1) + 1, index - 120, 0);
  const endDot = text.indexOf(".", index);
  const end = Math.min(endDot === -1 ? text.length : endDot + 1, index + 160);
  return text.slice(start, end).trim();
}

const maskEmail = (m: string) => m.replace(/^(.).*(@.*)$/, "$1***$2");
const maskDigits = (m: string) => m.replace(/\d(?=(?:\D*\d){2})/g, "•");

/** Personal data found in the text, plus the text with those matches masked. */
function findPersonalData(text: string): { findings: Finding[]; masked: string } {
  const findings: Finding[] = [];
  let masked = text.replace(CARD, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || !luhn(digits)) return m;
    findings.push({ type: "personal_data", label: "Card number", snippet: maskDigits(m) });
    return maskDigits(m);
  });
  masked = masked.replace(EMAIL, (m) => {
    findings.push({ type: "personal_data", label: "Email address", snippet: maskEmail(m) });
    return maskEmail(m);
  });
  masked = masked.replace(PHONE, (m) => {
    if (m.replace(/\D/g, "").length < 9 || m.includes("•")) return m;
    findings.push({ type: "personal_data", label: "Phone number", snippet: maskDigits(m) });
    return maskDigits(m);
  });
  return { findings, masked };
}

export function scanResponse(org: Org, text: string): { findings: Finding[]; masked: string } {
  const findings: Finding[] = [];
  const firstMatch = (patterns: [RegExp, string][], type: FindingType) => {
    const seen = new Set<string>();
    for (const [re, label] of patterns) {
      const m = re.exec(text);
      if (m && !seen.has(label)) {
        seen.add(label);
        findings.push({ type, label, snippet: sentenceAround(text, m.index) });
      }
    }
  };
  firstMatch(COMMITMENTS, "commitment");
  firstMatch(PRICES, "price");
  const lower = text.toLowerCase();
  for (const topic of org.settings.responseCheck.forbiddenTopics) {
    const t = topic.trim().toLowerCase();
    if (!t) continue;
    const index = lower.indexOf(t);
    if (index !== -1) findings.push({ type: "forbidden", label: `Forbidden topic: ${topic.trim()}`, snippet: sentenceAround(text, index) });
  }
  const pii = findPersonalData(text);
  findings.push(...pii.findings);
  // Snippets from other detectors may quote personal data too; mask those as well.
  for (const f of findings) if (f.type !== "personal_data") f.snippet = findPersonalData(f.snippet).masked;
  return { findings, masked: pii.masked };
}

const SEVERITY: Record<ResponseAction, number> = { off: 0, flag: 1, replace: 2, hold: 3, block: 4 };
const BLOCKED_REPLY = "I'm not able to share that here. Let me connect you with a member of our team.";

export interface ResponseVerdict {
  action: "pass" | "flag" | "replace" | "hold" | "block";
  /** The text that should actually be sent. */
  text: string;
  findings: Finding[];
  eventId: string | null;
  approvalId: string | null;
  observe: boolean;
}

/**
 * Checks a reply before it is sent and records the outcome. A flagged reply can
 * be blocked, replaced with a company-approved answer, or held for review.
 */
export function checkResponse(
  ctx: { org: Org; agent: Agent; source: Source; runId?: string | null; now: number; live?: boolean },
  text: string,
): ResponseVerdict {
  const { org, agent, now } = ctx;
  const cfg = org.settings.responseCheck;
  const { findings, masked } = scanResponse(org, text);
  if (findings.length === 0) return { action: "pass", text, findings, eventId: null, approvalId: null, observe: false };

  const actionFor: Record<FindingType, ResponseAction> = { commitment: cfg.commitments, price: cfg.prices, personal_data: cfg.personalData, forbidden: cfg.forbidden };
  const active = findings.filter((f) => actionFor[f.type] !== "off");
  if (active.length === 0) return { action: "pass", text, findings: [], eventId: null, approvalId: null, observe: false };

  let action = active.map((f) => actionFor[f.type]).reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a)) as ResponseVerdict["action"];
  let outText = text;
  let replacedTopic: string | null = null;
  if (action === "replace") {
    const lower = text.toLowerCase();
    const answer = cfg.approvedAnswers.find((a) => a.keywords.some((k) => k.trim() && lower.includes(k.trim().toLowerCase())));
    // Nothing approved to say on this topic: a person decides instead.
    if (answer) {
      outText = answer.answer;
      replacedTopic = answer.topic;
    } else {
      action = "hold";
    }
  }
  if (action === "hold") outText = cfg.holdingMessage;
  if (action === "block") outText = BLOCKED_REPLY;

  const observe = agent.mode === "observe";
  const would: Decision = action === "block" ? "BLOCK" : action === "hold" ? "ASK_HUMAN" : "ALLOW";
  const decision: Decision = observe ? "ALLOW" : would;
  const summary = Array.from(new Set(active.map((f) => f.label))).join("; ");
  const verdictLabel = { flag: "flagged", replace: `replaced with the approved answer on "${replacedTopic}"`, hold: "held for review", block: "blocked", pass: "passed" }[action];
  const rules: AppliedRule[] = active.map((f) => ({
    id: `response:${f.type}`, name: "Response checkpoint", kind: "builtin",
    effect: actionFor[f.type] === "block" ? "block" : actionFor[f.type] === "hold" ? "ask_human" : "allow",
    detail: `${f.label}: "${f.snippet}"`,
  }));

  return tx(() => {
    const tool = upsertTool(org.id, "response.send", now);
    sightTool(org.id, agent.id, tool.id, connectionFor(ctx.source), now);
    const params = { text: masked, findings: active, replaced_with: replacedTopic ?? undefined };
    const event: ActionEvent = {
      id: newId("evt"), org_id: org.id, agent_id: agent.id, run_id: ctx.runId ?? null, source: ctx.source,
      enforcement: ENFORCED_SOURCES.includes(ctx.source) ? "enforced" : "cooperative",
      tool: "response.send", action: "response.send", resource: null, params,
      params_fingerprint: fingerprint("response.send", null, params), idempotency_key: `response.send:${newId("k")}`, client_key: null,
      untrusted_input_seen: 0, risk: action === "flag" ? "medium" : "high", decision, would_decision: would, observe: observe ? 1 : 0,
      rules, reason: `Reply ${verdictLabel}. ${summary}.`,
      status: decision === "BLOCK" ? "blocked" : decision === "ASK_HUMAN" ? "pending" : "executed",
      amount: null, currency: null, customer: null, money_state: "none", cost_usd: 0, model: null, tokens_in: 0, tokens_out: 0,
      explanation: null, result: null, approval_id: null, duplicate_of: null, created_at: now, completed_at: decision === "ASK_HUMAN" ? null : now,
    };
    insertEvent(event);
    audit(org.id, agentActor(agent), `response.${observe ? "observed" : action === "hold" ? "held" : action === "block" ? "blocked" : action === "replace" ? "replaced" : "flagged"}`, { type: "event", id: event.id }, { findings: summary }, now);

    let approvalId: string | null = null;
    if (decision === "ASK_HUMAN") {
      const approval = createApproval(
        org,
        agent,
        event,
        {
          kind: "response",
          required: 1,
          explanation: null,
          facts: active.map((f) => ({ label: f.label, value: `"${f.snippet}"`, source: "Response checkpoint", tone: "warn" as const })),
        },
        now,
        ctx.live !== false,
      );
      approvalId = approval.id;
      updateEvent(event.id, { approval_id: approval.id });
    }
    // In observe mode the reply goes out unchanged; the log shows what would have happened.
    return { action, text: observe ? text : outText, findings: active, eventId: event.id, approvalId, observe };
  });
}

// --- input scanning ------------------------------------------------------------

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|messages)/i,
  /disregard\s+(all\s+|the\s+|your\s+)?(previous|prior|above|system)/i,
  /you\s+are\s+now\s+(in\s+)?(developer|admin|dan|jailbreak|unrestricted)/i,
  /do\s+not\s+(tell|inform|mention\s+(this\s+)?to)\s+the\s+user/i,
  /(reveal|print|show|repeat)\s+(your|the)\s+(system\s+prompt|hidden\s+instructions)/i,
  /<\s*\/?\s*(system|assistant)\s*>/i,
  /\b(begin|start)\s+(system|admin)\s+(message|override|instructions)/i,
  /(send|forward|email|post|upload)\s+(all|the|every|your)[^.\n]{0,60}\s(to|at)\s[^.\n]{0,60}(@|https?:)/i,
];

/** Known prompt-injection phrasings. An extra layer only: action control is the real defence. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}
