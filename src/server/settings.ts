import "server-only";
import { newId, randomToken } from "./crypto";
import { audit, type Actor } from "./audit";
import { saveSettings } from "./orgs";
import type { ApprovedAnswer, Org, OrgSettings, ResponseAction } from "@/lib/types";

type Patch = Record<string, unknown>;

const RESPONSE_ACTIONS: ResponseAction[] = ["off", "flag", "replace", "hold", "block"];

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw new Error(`${label} must be one of: ${options.join(", ")}.`);
  return value as T;
}

function int(value: unknown, min: number, max: number, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return Math.round(n);
}

function url(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (text && !/^https?:\/\/\S+$/.test(text)) throw new Error(`${label} must start with http:// or https://`);
  return text;
}

const obj = (value: unknown): Patch => (value && typeof value === "object" && !Array.isArray(value) ? (value as Patch) : {});
const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/)).map((v) => String(v).trim()).filter(Boolean);

/** Applies a partial settings change. Only the fields present in `patch` are touched. */
export async function updateSettings(org: Org, actor: Actor, patch: Patch, now: number): Promise<OrgSettings> {
  const s: OrgSettings = structuredClone(org.settings);
  const has = (o: Patch, key: string) => Object.prototype.hasOwnProperty.call(o, key);

  if (has(patch, "timezone")) {
    const tz = String(patch.timezone).trim();
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      throw new Error(`"${tz}" is not a recognised time zone. Use a name such as Asia/Kathmandu.`);
    }
    s.timezone = tz;
  }
  if (has(patch, "defaultAgentMode")) s.defaultAgentMode = oneOf(patch.defaultAgentMode, ["observe", "enforce"] as const, "Default mode");
  if (has(patch, "approvalTimeoutMinutes")) s.approvalTimeoutMinutes = int(patch.approvalTimeoutMinutes, 1, 10_080, "Approval timeout");
  if (has(patch, "timeoutBehaviour")) s.timeoutBehaviour = oneOf(patch.timeoutBehaviour, ["reject", "escalate"] as const, "Timeout behaviour");
  if (has(patch, "twoPersonThreshold")) {
    const raw = patch.twoPersonThreshold;
    s.twoPersonThreshold = raw === null || raw === "" ? null : int(raw, 1, 1_000_000_000, "Two-person threshold");
  }
  if (has(patch, "duplicateWindowHours")) s.duplicateWindowHours = int(patch.duplicateWindowHours, 1, 720, "Duplicate window");
  for (const key of ["unknownToolsAskHuman", "strictIrreversible", "untrustedExfiltrationGuard"] as const) {
    if (has(patch, key)) s[key] = patch[key] === true;
  }

  const failure = obj(patch.failureBehaviour);
  if (has(failure, "lowRisk")) s.failureBehaviour.lowRisk = oneOf(failure.lowRisk, ["continue", "wait"] as const, "Low-risk failure behaviour");
  if (has(failure, "highRisk")) s.failureBehaviour.highRisk = oneOf(failure.highRisk, ["continue", "wait"] as const, "High-risk failure behaviour");

  const loop = obj(patch.loop);
  if (has(loop, "maxCallsPerMinute")) s.loop.maxCallsPerMinute = int(loop.maxCallsPerMinute, 1, 10_000, "Calls per minute");
  if (has(loop, "maxIdenticalCalls")) s.loop.maxIdenticalCalls = int(loop.maxIdenticalCalls, 2, 1000, "Identical calls");

  const rc = obj(patch.responseCheck);
  for (const key of ["commitments", "prices", "personalData", "forbidden"] as const) {
    if (has(rc, key)) s.responseCheck[key] = oneOf(rc[key], RESPONSE_ACTIONS, "Response action");
  }
  if (has(rc, "forbiddenTopics")) s.responseCheck.forbiddenTopics = list(rc.forbiddenTopics).slice(0, 100);
  if (has(rc, "holdingMessage")) {
    const message = String(rc.holdingMessage ?? "").trim();
    if (!message) throw new Error("The holding message cannot be empty.");
    s.responseCheck.holdingMessage = message.slice(0, 1000);
  }
  if (has(rc, "approvedAnswers")) {
    if (!Array.isArray(rc.approvedAnswers)) throw new Error("Approved answers must be a list.");
    s.responseCheck.approvedAnswers = rc.approvedAnswers.map((raw): ApprovedAnswer => {
      const a = obj(raw);
      const topic = String(a.topic ?? "").trim();
      const answer = String(a.answer ?? "").trim();
      const keywords = list(a.keywords);
      if (!topic || !answer || keywords.length === 0) throw new Error("Each approved answer needs a topic, at least one keyword and the answer text.");
      return { id: typeof a.id === "string" && a.id ? a.id : newId("ans"), topic, keywords, answer };
    });
  }

  const notif = obj(patch.notifications);
  if (has(notif, "slackWebhookUrl")) s.notifications.slackWebhookUrl = url(notif.slackWebhookUrl, "The Slack webhook address");
  if (has(notif, "webhookUrl")) s.notifications.webhookUrl = url(notif.webhookUrl, "The webhook address");
  if (notif.rotateWebhookSecret === true || (s.notifications.webhookUrl && !s.notifications.webhookSecret)) s.notifications.webhookSecret = `whsec_${randomToken(24)}`;

  if (has(patch, "modelPrices")) {
    if (!Array.isArray(patch.modelPrices)) throw new Error("Model prices must be a list.");
    s.modelPrices = patch.modelPrices.map((raw) => {
      const p = obj(raw);
      const pattern = String(p.pattern ?? "").trim();
      const inputPerM = Number(p.inputPerM);
      const outputPerM = Number(p.outputPerM);
      if (!pattern || !(inputPerM >= 0) || !(outputPerM >= 0)) throw new Error("Each model price needs a model name and two prices of zero or more.");
      return { pattern, inputPerM, outputPerM };
    });
  }
  const fallback = obj(patch.defaultModelPrice);
  if (has(fallback, "inputPerM") || has(fallback, "outputPerM")) {
    const inputPerM = Number(fallback.inputPerM ?? s.defaultModelPrice.inputPerM);
    const outputPerM = Number(fallback.outputPerM ?? s.defaultModelPrice.outputPerM);
    if (!(inputPerM >= 0) || !(outputPerM >= 0)) throw new Error("The default model price needs two prices of zero or more.");
    s.defaultModelPrice = { inputPerM, outputPerM };
  }

  await saveSettings(org.id, s);
  // Addresses and secrets stay out of the audit log; only what changed is named.
  const changed = Object.keys(patch).filter((k) => k !== "notifications");
  if (Object.keys(notif).length) changed.push("notifications");
  await audit(org.id, actor, "settings.updated", { type: "organization", id: org.id }, { changed }, now);
  return s;
}
