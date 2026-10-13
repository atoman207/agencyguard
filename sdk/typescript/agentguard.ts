// AgentGuard TypeScript SDK (early version). No dependencies; needs fetch (Node 18+).
//
//   const guard = new AgentGuard({ baseUrl: "https://your-agentguard-host", token: process.env.AGENTGUARD_TOKEN! });
//   const outcome = await guard.guard(
//     { tool: "gmail.send", action: "email.send", params: { to: ["a@example.com"], subject: "Hi" } },
//     (params) => sendEmail(params),
//   );
//
// This is a cooperative checkpoint: it works because your code asks before
// acting. For money, deletion and other irreversible actions, prefer
// `execute()` (the vault), where AgentGuard performs the action itself.

export interface AgentGuardOptions {
  baseUrl: string;
  token: string;
  /** Shown in the activity log. */
  source?: "sdk" | "n8n" | "make" | "api";
  /** How often to poll while waiting for a person. Default 3 seconds. */
  pollIntervalMs?: number;
  /** How long to wait for a person before giving up locally. Default 15 minutes. */
  approvalTimeoutMs?: number;
}

export interface ActionRequest {
  /** The tool name as your agent knows it. */
  tool?: string;
  /** A catalog action type such as "payment.refund" or "email.send". */
  action?: string;
  /** What is acted on, e.g. "order:5521". Used for duplicate protection on money and deletion. */
  resource?: string;
  params?: Record<string, unknown>;
  idempotencyKey?: string;
  runId?: string;
  /** Set when the agent has read content from outside: web pages, inbound email, uploaded files. */
  untrustedInputSeen?: boolean;
  explanation?: string;
  /** Deliberately repeat an action that already ran. A person must confirm. */
  confirmRepeat?: boolean;
}

export interface Decision {
  decision: "allow" | "block" | "pending";
  event_id: string;
  approval_id: string | null;
  status: string;
  reason: string | null;
  risk: string;
  observe: boolean;
  would: string;
  duplicate: boolean;
  already_executed: boolean;
  enforcement: "enforced" | "cooperative";
  rules: string[];
  fingerprint: string;
  /** The exact parameters this answer covers. Execute these, not a modified copy. */
  params: Record<string, unknown>;
  result: unknown;
}

export interface ApprovalState {
  approval_id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  event_id: string;
  event_status: string;
  reason: string | null;
  params: Record<string, unknown>;
  result: unknown;
}

export type GuardOutcome<T> =
  | { status: "done"; result: T; decision: Decision }
  | { status: "skipped"; reason: "duplicate"; decision: Decision }
  | { status: "blocked" | "rejected" | "expired" | "timeout"; reason: string; decision: Decision };

export class AgentGuardError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "AgentGuardError";
    this.status = status;
    this.code = code;
  }
}

/** AgentGuard could not be reached at all. Decide per action whether to continue or wait. */
export class AgentGuardUnreachable extends Error {
  constructor(cause: unknown) {
    super("AgentGuard could not be reached.");
    this.name = "AgentGuardUnreachable";
    this.cause = cause;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AgentGuard {
  private baseUrl: string;
  private token: string;
  private source: string;
  private pollIntervalMs: number;
  private approvalTimeoutMs: number;

  constructor(options: AgentGuardOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.source = options.source ?? "sdk";
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 15 * 60_000;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new AgentGuardUnreachable(err);
    }
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) throw new AgentGuardError(json?.error?.message ?? `HTTP ${res.status}`, res.status, json?.error?.code ?? "error");
    return json as T;
  }

  private body(req: ActionRequest): Record<string, unknown> {
    return {
      source: this.source,
      tool: req.tool,
      action: req.action,
      resource: req.resource,
      params: req.params ?? {},
      idempotency_key: req.idempotencyKey,
      run_id: req.runId,
      untrusted_input_seen: req.untrustedInputSeen,
      explanation: req.explanation,
      confirm_repeat: req.confirmRepeat,
    };
  }

  /** Ask before acting. Returns allow, block or pending. */
  check(req: ActionRequest): Promise<Decision> {
    return this.request<Decision>("POST", "/v1/check", this.body(req));
  }

  approval(approvalId: string): Promise<ApprovalState> {
    return this.request<ApprovalState>("GET", `/v1/approvals/${encodeURIComponent(approvalId)}`);
  }

  /** Polls until a person decides, the request expires, or the local timeout passes. */
  async waitForApproval(approvalId: string, timeoutMs: number = this.approvalTimeoutMs): Promise<ApprovalState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await this.approval(approvalId);
      if (state.status !== "pending" || Date.now() >= deadline) return state;
      await sleep(this.pollIntervalMs);
    }
  }

  /** Report what happened after acting on an allowed action. Send the parameters you actually used. */
  report(eventId: string, status: "completed" | "failed", details: { result?: unknown; params?: Record<string, unknown> } = {}): Promise<{ event_id: string; status: string; parameter_mismatch: boolean }> {
    return this.request("POST", "/v1/events", { event_id: eventId, status, ...details });
  }

  /** Record an action that ran without asking first. Visibility only. */
  record(req: ActionRequest): Promise<Decision> {
    return this.request<Decision>("POST", "/v1/events", this.body(req));
  }

  /** Enforced: AgentGuard holds the key and performs the action itself, exactly once. */
  execute(connector: string, action: string, params: Record<string, unknown>, options: Pick<ActionRequest, "idempotencyKey" | "runId" | "explanation" | "confirmRepeat"> = {}): Promise<Decision> {
    return this.request<Decision>("POST", `/v1/actions/${encodeURIComponent(connector)}/${encodeURIComponent(action)}`, {
      params,
      idempotency_key: options.idempotencyKey,
      run_id: options.runId,
      explanation: options.explanation,
      confirm_repeat: options.confirmRepeat,
    });
  }

  /** Check a reply before a customer sees it. Send `text` from the result, not your original. */
  checkResponse(text: string, runId?: string): Promise<{ action: string; decision: "allow" | "block" | "pending"; text: string; findings: { type: string; label: string }[]; event_id: string | null; approval_id: string | null; observe: boolean }> {
    return this.request("POST", "/v1/responses/check", { text, run_id: runId, source: this.source });
  }

  /**
   * The whole cooperative flow in one call: ask, wait for a person if needed,
   * run your function with the approved parameters, and report the outcome.
   * `run` receives the parameters AgentGuard approved; use those.
   */
  async guard<T>(req: ActionRequest, run: (params: Record<string, unknown>) => Promise<T>): Promise<GuardOutcome<T>> {
    let decision = await this.check(req);
    if (decision.decision === "pending" && decision.approval_id) {
      const state = await this.waitForApproval(decision.approval_id);
      if (state.status === "pending") return { status: "timeout", reason: "Still waiting for a person. Call guard() again later with the same request.", decision };
      if (state.status !== "approved") return { status: state.status, reason: state.reason ?? `The request was ${state.status}.`, decision };
      // Asking again with the same request turns the approval into a one-time permit.
      decision = await this.check(req);
    }
    if (decision.decision === "block") return { status: "blocked", reason: decision.reason ?? "Blocked by AgentGuard.", decision };
    if (decision.decision === "pending") return { status: "timeout", reason: "Waiting for a person.", decision };
    if (decision.duplicate && decision.already_executed) return { status: "skipped", reason: "duplicate", decision };

    try {
      const result = await run(decision.params);
      await this.report(decision.event_id, "completed", { params: decision.params });
      return { status: "done", result, decision };
    } catch (err) {
      await this.report(decision.event_id, "failed", { result: { error: err instanceof Error ? err.message : String(err) } }).catch(() => undefined);
      throw err;
    }
  }
}
