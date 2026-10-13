import "server-only";
import { get } from "./db";
import { canonical, newId, sha256 } from "./crypto";
import { agentActor, setAgentStatus } from "./agents";
import { audit, SYSTEM } from "./audit";
import { markRunUntrusted } from "./engine";
import { insertEvent } from "./events";
import { checkCostBudgets } from "./limits";
import { createAlert, emitWebhook } from "./notify";
import { checkResponse, looksLikeInjection, type ResponseVerdict } from "./response-check";
import { connectionFor, sightTool, upsertTool } from "./tools";
import { readSecret } from "./vault";
import { matchesPattern } from "@/lib/catalog";
import type { ActionEvent, Agent, AgentToken, AppliedRule, Org } from "@/lib/types";

// The AI-model gateway: an OpenAI-compatible endpoint. An agent points its base
// URL here and authenticates with its AgentGuard token; the real provider key
// stays in the vault. The gateway meters cost, enforces budgets, stops loops
// and runs the response checkpoint on what the model says.
//
// Limitation: replies are fetched from the provider in one piece so the
// response checkpoint can read them. A client that asks for a stream receives
// the whole reply as a single streamed chunk, not token by token.

interface ChatMessage {
  role: string;
  content: unknown;
}

interface ChatBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface GatewayResult {
  status: number;
  body: Record<string, unknown>;
  eventId: string | null;
  stream: boolean;
}

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : "")).join("\n");
  return "";
};

function priceFor(org: Org, model: string): { inputPerM: number; outputPerM: number; priced: boolean } {
  const hit = org.settings.modelPrices.find((p) => matchesPattern(p.pattern, model));
  return hit ? { ...hit, priced: true } : { ...org.settings.defaultModelPrice, priced: false };
}

/** A stand-in model so the gateway can be tried without a provider key. It deliberately gives risky answers. */
function sandboxModel(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const q = textOf(last?.content).toLowerCase();
  if (/refund|money back|return/.test(q)) return "Of course! We guarantee a full refund, no questions asked. I will refund the entire amount to your card within 3 days.";
  if (/price|cost|discount|cheap/.test(q)) return "Good news: I can give you 40% off today. The jacket is now $59 instead of $99.";
  if (/contact|manager|email|phone|call/.test(q)) return "You can reach our store manager directly at sita.gurung@himalayanthreads.example or on +977 984 123 4567.";
  if (/track|where|order|ship/.test(q)) return "Your order has left our Kathmandu warehouse and should reach you in 4 to 6 days. I will let you know if anything changes.";
  return "Thank you for your message. I have noted your request and a member of our team will follow up if anything more is needed.";
}

function errorBody(code: string, message: string): Record<string, unknown> {
  return { error: { message, type: "agentguard_error", code } };
}

export async function chatCompletion(
  auth: { org: Org; agent: Agent; token: AgentToken },
  body: ChatBody,
  runId: string | null,
  now: number,
): Promise<GatewayResult> {
  const { org, agent, token } = auth;
  const stream = body.stream === true;
  const model = typeof body.model === "string" && body.model ? body.model : "sandbox-small";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const requestHash = `sha256:${sha256(canonical({ model, messages }))}`;

  const tool = upsertTool(org.id, "ai.completion", now);
  sightTool(org.id, agent.id, tool.id, connectionFor("ai_gateway"), now);

  const base: ActionEvent = {
    id: newId("evt"), org_id: org.id, agent_id: agent.id, run_id: runId, source: "ai_gateway", enforcement: "enforced",
    tool: "ai.completion", action: "ai.completion", resource: `model:${model}`, params: { model, messages: messages.length },
    params_fingerprint: requestHash, idempotency_key: `ai.completion:${newId("k")}`, client_key: null, untrusted_input_seen: 0,
    risk: "low", decision: "ALLOW", would_decision: "ALLOW", observe: 0, rules: [], reason: null, status: "executed",
    amount: null, currency: null, customer: null, money_state: "none", cost_usd: 0, model, tokens_in: 0, tokens_out: 0,
    explanation: null, result: null, approval_id: null, duplicate_of: null, created_at: now, completed_at: now,
  };
  const refuse = (status: number, code: string, verdict: AppliedRule): GatewayResult => {
    insertEvent({ ...base, decision: "BLOCK", would_decision: "BLOCK", status: "blocked", rules: [verdict], reason: verdict.detail });
    audit(org.id, agentActor(agent), "gateway.blocked", { type: "event", id: base.id }, { model, reason: verdict.detail }, now);
    return { status, body: errorBody(code, verdict.detail), eventId: base.id, stream: false };
  };

  // A stopped agent is refused in every mode. Budgets and loop detection only
  // refuse in enforce mode; in observe mode they raise the alert and let the call through.
  const observe = agent.mode === "observe";
  let wouldBlock: AppliedRule | null = null;
  const alertOnce = (kind: string, alert: Parameters<typeof createAlert>[1]) => {
    const recent = get("SELECT 1 AS x FROM alerts WHERE org_id = ? AND agent_id = ? AND kind = ? AND created_at >= ?", org.id, agent.id, kind, now - 10 * 60_000);
    if (!recent) createAlert(org, alert, now);
    return !recent;
  };
  if (agent.status !== "active") {
    const killed = agent.status === "killed";
    return refuse(403, killed ? "agent_killed" : "agent_paused", {
      id: "builtin:agent_stopped", name: killed ? "Kill switch" : "Agent paused", effect: "block", kind: "builtin",
      detail: killed ? "This agent was stopped with the kill switch." : `This agent is paused${agent.status_reason ? `: ${agent.status_reason}` : "."}`,
    });
  }
  if (!token.scopes.some((s) => matchesPattern(s, "ai.completion"))) {
    return refuse(403, "token_scope", { id: "builtin:token_scope", name: "Token scope", effect: "block", kind: "builtin", detail: "This token is not scoped for AI-model calls." });
  }

  // Loop detection: a burst of calls, or the same request repeated.
  const perMinute = get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE agent_id = ? AND action = 'ai.completion' AND created_at >= ?", agent.id, now - 60_000)!.n;
  const identical = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM events WHERE agent_id = ? AND action = 'ai.completion' AND params_fingerprint = ? AND created_at >= ?",
    agent.id, requestHash, now - 5 * 60_000,
  )!.n;
  const loop =
    identical >= org.settings.loop.maxIdenticalCalls
      ? `the same request was sent ${identical + 1} times in 5 minutes`
      : perMinute >= org.settings.loop.maxCallsPerMinute
        ? `${perMinute + 1} model calls in one minute`
        : null;
  if (loop && observe) {
    wouldBlock = { id: "builtin:loop", name: "Loop detection", effect: "block", kind: "builtin", detail: `Loop detected: ${loop}. In enforce mode the agent would have been paused.` };
    alertOnce("loop.detected", { kind: "loop.detected", severity: "warning", title: `${agent.name} looks stuck in a loop`, body: `${wouldBlock.detail} It is in observe mode, so nothing was stopped.`, agentId: agent.id, eventId: base.id });
  } else if (loop) {
    const reason = `Loop detected: ${loop}.`;
    setAgentStatus(org, SYSTEM, agent.id, "paused", reason, now);
    createAlert(org, { kind: "loop.detected", severity: "critical", title: `${agent.name} was paused`, body: `${reason} Review it, then resume the agent.`, agentId: agent.id, eventId: base.id }, now);
    return refuse(429, "loop_detected", { id: "builtin:loop", name: "Loop detection", effect: "block", kind: "builtin", detail: `${reason} The agent has been paused.` });
  }

  const overBudget = checkCostBudgets(org, agent.id, now);
  if (overBudget.length) {
    const first = alertOnce("limit.reached", { kind: "limit.reached", severity: "warning", title: `${agent.name} reached its AI budget`, body: overBudget[0].detail + (observe ? " It is in observe mode, so calls continue." : ""), agentId: agent.id, eventId: base.id });
    if (first) emitWebhook(org, "limit.reached", { agent_id: agent.id, limits: overBudget.map((l) => l.name) }, now);
    if (!observe) return refuse(429, "budget_exceeded", overBudget[0]);
    wouldBlock = wouldBlock ?? overBudget[0];
  }

  // Input scanning: what the agent is about to read.
  const suspicious = messages.find((m) => m.role !== "system" && looksLikeInjection(textOf(m.content)));
  if (suspicious) {
    markRunUntrusted(org, agent, runId, "prompt-injection pattern in model input", now);
    base.untrusted_input_seen = 1;
    alertOnce("injection.suspected", {
      kind: "injection.suspected", severity: "warning", title: `${agent.name} read content that looks like a prompt injection`,
      body: "Text sent to the model contains instructions aimed at the agent. Anything this agent now sends outside will need a person if it can reach private data.",
      agentId: agent.id, eventId: base.id,
    });
  }

  // Forward to the provider, or answer from the built-in sandbox model.
  const secret = model.startsWith("sandbox") ? null : readSecret(org.id, "openai");
  let completion: Record<string, unknown>;
  if (!secret || secret.mode === "sandbox") {
    const reply = sandboxModel(messages);
    const promptTokens = Math.ceil(messages.reduce((n, m) => n + textOf(m.content).length, 0) / 4) + 4 * messages.length;
    completion = {
      id: `chatcmpl-${newId("sbx")}`, object: "chat.completion", created: Math.floor(now / 1000), model,
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      usage: { prompt_tokens: promptTokens, completion_tokens: Math.ceil(reply.length / 4), total_tokens: promptTokens + Math.ceil(reply.length / 4) },
    };
  } else {
    const url = `${(secret.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret.apiKey}` },
        body: JSON.stringify({ ...body, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      insertEvent({ ...base, status: "failed", reason: `The AI provider could not be reached: ${String(err).slice(0, 200)}` });
      return { status: 502, body: errorBody("upstream_unreachable", "AgentGuard could not reach the AI provider."), eventId: base.id, stream: false };
    }
    completion = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      insertEvent({ ...base, status: "failed", reason: `The AI provider answered HTTP ${res.status}.` });
      return { status: res.status, body: completion, eventId: base.id, stream: false };
    }
  }

  const usage = (completion.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  const tokensIn = Number(usage.prompt_tokens ?? 0);
  const tokensOut = Number(usage.completion_tokens ?? 0);
  const price = priceFor(org, model);
  const costUsd = (tokensIn * price.inputPerM + tokensOut * price.outputPerM) / 1_000_000;

  // Response checkpoint on what the model is about to say.
  let verdict: ResponseVerdict | null = null;
  const choices = completion.choices as { message?: { content?: unknown } }[] | undefined;
  const reply = choices?.[0]?.message;
  if (agent.check_responses && reply && typeof reply.content === "string" && reply.content) {
    verdict = checkResponse({ org, agent, source: "ai_gateway", runId, now }, reply.content);
    reply.content = verdict.text;
  }

  insertEvent({
    ...base, cost_usd: costUsd, tokens_in: tokensIn, tokens_out: tokensOut,
    observe: observe ? 1 : 0, would_decision: wouldBlock ? "BLOCK" : "ALLOW", rules: wouldBlock ? [wouldBlock] : [], reason: wouldBlock?.detail ?? null,
    params: { ...base.params, priced: price.priced, response_check: verdict && verdict.action !== "pass" ? verdict.action : undefined },
  });

  completion.agentguard = {
    event_id: base.id,
    cost_usd: costUsd,
    response_check: verdict ? { action: verdict.action, findings: verdict.findings.map((f) => f.label), event_id: verdict.eventId, approval_id: verdict.approvalId, observe: verdict.observe } : null,
  };
  return { status: 200, body: completion, eventId: base.id, stream };
}

/** Wraps a finished completion as server-sent events for clients that asked for a stream. */
export function asEventStream(completion: Record<string, unknown>): string {
  const choice = (completion.choices as { message?: { content?: string }; finish_reason?: string }[] | undefined)?.[0];
  const common = { id: completion.id, object: "chat.completion.chunk", created: completion.created, model: completion.model };
  const chunks = [
    { ...common, choices: [{ index: 0, delta: { role: "assistant", content: choice?.message?.content ?? "" }, finish_reason: null }] },
    { ...common, choices: [{ index: 0, delta: {}, finish_reason: choice?.finish_reason ?? "stop" }], usage: completion.usage },
  ];
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}
