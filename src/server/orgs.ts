import "server-only";
import { get, json, run } from "./db";
import type { Org, OrgSettings } from "@/lib/types";

export const DEFAULT_SETTINGS: OrgSettings = {
  timezone: "Asia/Kathmandu",
  defaultAgentMode: "observe",
  approvalTimeoutMinutes: 60,
  timeoutBehaviour: "reject",
  twoPersonThreshold: 1000,
  duplicateWindowHours: 24,
  unknownToolsAskHuman: true,
  strictIrreversible: true,
  untrustedExfiltrationGuard: true,
  failureBehaviour: { lowRisk: "continue", highRisk: "wait" },
  loop: { maxCallsPerMinute: 30, maxIdenticalCalls: 5 },
  responseCheck: {
    commitments: "hold",
    prices: "flag",
    personalData: "block",
    forbidden: "block",
    forbiddenTopics: [],
    holdingMessage: "Thank you for your patience. I need to confirm this with a member of our team and will get back to you shortly.",
    approvedAnswers: [],
  },
  notifications: { slackWebhookUrl: "", webhookUrl: "", webhookSecret: "" },
  // Prices are per million tokens. Only the built-in sandbox models are listed;
  // add the models you use with the rates on your provider contract.
  modelPrices: [
    { pattern: "sandbox-small", inputPerM: 0.5, outputPerM: 1.5 },
    { pattern: "sandbox-large", inputPerM: 5, outputPerM: 15 },
  ],
  defaultModelPrice: { inputPerM: 3, outputPerM: 15 },
};

function withDefaults(stored: Partial<OrgSettings>): OrgSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    failureBehaviour: { ...DEFAULT_SETTINGS.failureBehaviour, ...stored.failureBehaviour },
    loop: { ...DEFAULT_SETTINGS.loop, ...stored.loop },
    responseCheck: { ...DEFAULT_SETTINGS.responseCheck, ...stored.responseCheck },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
  };
}

interface OrgRow {
  id: string;
  name: string;
  settings: string;
  created_at: number;
}

export async function getOrg(id: string): Promise<Org> {
  const row = await get<OrgRow>("SELECT * FROM organizations WHERE id = ?", id);
  if (!row) throw new Error("Organization not found.");
  return { ...row, settings: withDefaults(json<Partial<OrgSettings>>(row.settings, {})) };
}

export async function saveSettings(orgId: string, settings: OrgSettings): Promise<void> {
  await run("UPDATE organizations SET settings = ? WHERE id = ?", JSON.stringify(settings), orgId);
}

export async function renameOrg(orgId: string, name: string): Promise<void> {
  await run("UPDATE organizations SET name = ? WHERE id = ?", name, orgId);
}
