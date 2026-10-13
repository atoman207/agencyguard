import { Ban, Check, CircleDashed, CopyCheck, Eye, Hand, Lock, OctagonX, Pause, Radio, ShieldCheck, ShieldQuestion, TriangleAlert, Unplug, X } from "@/components/icons";
import { Badge } from "./ui";
import type { AgentMode, AgentStatus, ApprovalStatus, Connection, Decision, Enforcement, EventStatus, Risk } from "@/lib/types";

// State is never shown by colour alone: every badge carries an icon and a word.

const I = "h-3.5 w-3.5";

export function DecisionBadge({ decision, observe }: { decision: Decision; observe?: boolean }) {
  if (decision === "ALLOW") return <Badge tone="good" icon={<Check className={I} />}>{observe ? "Would allow" : "Allowed"}</Badge>;
  if (decision === "BLOCK") return <Badge tone="danger" icon={<Ban className={I} />}>{observe ? "Would block" : "Blocked"}</Badge>;
  if (decision === "ASK_HUMAN") return <Badge tone="warn" icon={<Hand className={I} />}>{observe ? "Would ask a person" : "Asked a person"}</Badge>;
  return <Badge icon={<Eye className={I} />}>Reported</Badge>;
}

const STATUS: Record<EventStatus, { tone: "neutral" | "good" | "warn" | "danger" | "info"; label: string }> = {
  allowed: { tone: "info", label: "Permit issued" },
  pending: { tone: "warn", label: "Waiting" },
  approved: { tone: "good", label: "Approved" },
  executing: { tone: "info", label: "Running" },
  executed: { tone: "good", label: "Done" },
  failed: { tone: "danger", label: "Failed" },
  blocked: { tone: "danger", label: "Blocked" },
  rejected: { tone: "danger", label: "Rejected" },
  expired: { tone: "neutral", label: "Timed out" },
  duplicate: { tone: "neutral", label: "Duplicate" },
  observed: { tone: "neutral", label: "Reported" },
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const s = STATUS[status];
  const icon =
    status === "pending" ? <CircleDashed className={I} /> : status === "duplicate" ? <CopyCheck className={I} /> : s.tone === "danger" ? <X className={I} /> : s.tone === "good" ? <Check className={I} /> : undefined;
  return <Badge tone={s.tone} icon={icon}>{s.label}</Badge>;
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  if (status === "pending") return <Badge tone="warn" icon={<CircleDashed className={I} />}>Waiting</Badge>;
  if (status === "approved") return <Badge tone="good" icon={<Check className={I} />}>Approved</Badge>;
  if (status === "rejected") return <Badge tone="danger" icon={<X className={I} />}>Rejected</Badge>;
  return <Badge>Timed out</Badge>;
}

export function RiskBadge({ risk }: { risk: Risk }) {
  const tone = risk === "critical" || risk === "high" ? "danger" : risk === "medium" ? "warn" : "neutral";
  return (
    <Badge tone={tone} icon={risk === "low" ? undefined : <TriangleAlert className={I} />}>
      {risk[0].toUpperCase() + risk.slice(1)} risk
    </Badge>
  );
}

export function ModeBadge({ mode }: { mode: AgentMode }) {
  return mode === "enforce" ? <Badge tone="info" icon={<ShieldCheck className={I} />}>Enforcing</Badge> : <Badge icon={<Eye className={I} />}>Observing</Badge>;
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  if (status === "active") return <Badge tone="good" icon={<Radio className={I} />}>Active</Badge>;
  if (status === "paused") return <Badge tone="warn" icon={<Pause className={I} />}>Paused</Badge>;
  return <Badge tone="dark" icon={<OctagonX className={I} />}>Stopped</Badge>;
}

export function EnforcementBadge({ level }: { level: Enforcement }) {
  return level === "enforced" ? <Badge tone="info" icon={<Lock className={I} />}>Enforced</Badge> : <Badge icon={<ShieldQuestion className={I} />}>Cooperative</Badge>;
}

export const CONNECTION_LABEL: Record<Connection, string> = {
  vault: "Credential vault",
  ai_gateway: "AI-model gateway",
  mcp_gateway: "MCP gateway",
  cooperative: "Cooperative check",
  uncovered: "Not covered",
};

export function ConnectionBadge({ connection }: { connection: Connection }) {
  if (connection === "uncovered") return <Badge tone="danger" icon={<Unplug className={I} />}>Not covered</Badge>;
  if (connection === "cooperative") return <Badge icon={<ShieldQuestion className={I} />}>Cooperative</Badge>;
  return <Badge tone="info" icon={<Lock className={I} />}>{CONNECTION_LABEL[connection]}</Badge>;
}
