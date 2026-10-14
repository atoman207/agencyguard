// Shared types. Safe to import from client and server code.

export type Role = "owner" | "admin" | "approver" | "viewer";
export type AgentStatus = "active" | "paused" | "killed";
export type AgentMode = "observe" | "enforce";
export type Environment = "production" | "staging" | "development";
export type Source = "vault" | "ai_gateway" | "mcp_gateway" | "sdk" | "n8n" | "make" | "api";
export type Enforcement = "enforced" | "cooperative";
export type Decision = "ALLOW" | "BLOCK" | "ASK_HUMAN" | "NONE";
export type EventStatus =
  | "allowed" // permit issued, completion not yet reported
  | "pending" // waiting for a human
  | "approved" // approved, not yet executed
  | "executing"
  | "executed"
  | "failed"
  | "blocked"
  | "rejected"
  | "expired"
  | "duplicate"
  | "observed"; // reported after the fact, visibility only
export type MoneyState = "none" | "reserved" | "settled" | "released";
export type Risk = "low" | "medium" | "high" | "critical";
export type Connection = "vault" | "ai_gateway" | "mcp_gateway" | "cooperative" | "uncovered";
export type ToolPermission = "default" | "allow" | "ask" | "deny";
export type RuleEffect = "allow" | "ask_human" | "ask_two" | "block";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type ResponseAction = "off" | "flag" | "replace" | "hold" | "block";

export const ENFORCED_SOURCES: Source[] = ["vault", "ai_gateway", "mcp_gateway"];

export interface ApprovedAnswer {
  id: string;
  topic: string;
  keywords: string[];
  answer: string;
}

export interface OrgSettings {
  timezone: string;
  defaultAgentMode: AgentMode;
  approvalTimeoutMinutes: number;
  timeoutBehaviour: "reject" | "escalate";
  twoPersonThreshold: number | null;
  duplicateWindowHours: number;
  unknownToolsAskHuman: boolean;
  strictIrreversible: boolean;
  untrustedExfiltrationGuard: boolean;
  failureBehaviour: { lowRisk: "continue" | "wait"; highRisk: "continue" | "wait" };
  loop: { maxCallsPerMinute: number; maxIdenticalCalls: number };
  responseCheck: {
    commitments: ResponseAction;
    prices: ResponseAction;
    personalData: ResponseAction;
    forbidden: ResponseAction;
    forbiddenTopics: string[];
    holdingMessage: string;
    approvedAnswers: ApprovedAnswer[];
  };
  notifications: { slackWebhookUrl: string; webhookUrl: string; webhookSecret: string };
  modelPrices: { pattern: string; inputPerM: number; outputPerM: number }[];
  defaultModelPrice: { inputPerM: number; outputPerM: number };
}

export interface Org {
  id: string;
  name: string;
  settings: OrgSettings;
  created_at: number;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: Role;
  /** Public path like `/avatars/usr_….jpg`, or null for the default mark. */
  avatar: string | null;
  created_at: number;
}

export interface Agent {
  id: string;
  org_id: string;
  name: string;
  platform: string;
  purpose: string;
  owner_user_id: string | null;
  environment: Environment;
  mode: AgentMode;
  status: AgentStatus;
  handles_private_data: number;
  check_responses: number;
  parent_agent_id: string | null;
  status_reason: string | null;
  status_changed_at: number | null;
  created_at: number;
}

export interface AgentToken {
  id: string;
  org_id: string;
  agent_id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
  created_at: number;
}

export interface Tool {
  id: string;
  org_id: string;
  name: string;
  action: string | null;
  suggested_action: string | null;
  status: "unclassified" | "confirmed";
  first_seen_at: number;
  last_seen_at: number;
}

export interface AgentTool {
  agent_id: string;
  tool_id: string;
  org_id: string;
  connection: Connection;
  declared: number;
  permission: ToolPermission;
  last_seen_at: number | null;
}

export interface Condition {
  field: string;
  op: string;
  value: string | number | boolean | string[];
}

export interface Rule {
  id: string;
  org_id: string;
  name: string;
  description: string;
  agent_id: string | null;
  conditions: Condition[];
  effect: RuleEffect;
  enabled: number;
  template: string | null;
  version: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export type LimitKind = "money" | "cost" | "count";
export type LimitScope = "action" | "customer" | "resource" | "agent" | "organization";
export type LimitPeriod = "action" | "hour" | "day" | "week" | "month";

export interface Limit {
  id: string;
  org_id: string;
  name: string;
  kind: LimitKind;
  scope: LimitScope;
  agent_id: string | null;
  action: string | null;
  period: LimitPeriod;
  value: number;
  on_exceed: "block" | "ask_human";
  enabled: number;
  template: string | null;
  created_at: number;
}

export interface AppliedRule {
  id: string;
  name: string;
  effect: "allow" | "ask_human" | "block";
  detail: string;
  kind: "rule" | "limit" | "builtin" | "permission";
  /** The rule asks for two approvers. */
  two?: boolean;
}

export interface ActionEvent {
  id: string;
  org_id: string;
  agent_id: string;
  run_id: string | null;
  source: Source;
  enforcement: Enforcement;
  tool: string;
  action: string;
  resource: string | null;
  params: Record<string, unknown>;
  params_fingerprint: string;
  idempotency_key: string;
  client_key: string | null;
  untrusted_input_seen: number;
  risk: Risk;
  decision: Decision;
  would_decision: Decision;
  observe: number;
  rules: AppliedRule[];
  reason: string | null;
  status: EventStatus;
  amount: number | null;
  currency: string | null;
  customer: string | null;
  money_state: MoneyState;
  cost_usd: number;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  explanation: string | null;
  result: unknown;
  approval_id: string | null;
  duplicate_of: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Fact {
  label: string;
  value: string;
  source: string;
  tone?: "neutral" | "warn" | "danger" | "good";
}

export interface ApprovalDecision {
  user_id: string;
  user_name: string;
  decision: "approve" | "reject";
  note: string;
  channel: "dashboard" | "email" | "slack";
  at: number;
}

export interface Approval {
  id: string;
  org_id: string;
  event_id: string;
  agent_id: string;
  kind: "action" | "response";
  fingerprint: string;
  status: ApprovalStatus;
  required: number;
  decisions: ApprovalDecision[];
  facts: Fact[];
  explanation: string | null;
  expires_at: number;
  escalated_at: number | null;
  created_at: number;
  decided_at: number | null;
}

export interface AuditEntry {
  seq: number;
  org_id: string;
  actor_type: "user" | "agent" | "system";
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: number;
  prev_hash: string;
  hash: string;
}

export interface Alert {
  id: string;
  org_id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  agent_id: string | null;
  event_id: string | null;
  created_at: number;
  acknowledged_at: number | null;
}

export interface Credential {
  id: string;
  org_id: string;
  connector: string;
  label: string;
  mode: "sandbox" | "live";
  hint: string;
  keys_rotated: number;
  created_at: number;
}

export interface McpServer {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  url: string;
  created_at: number;
}
