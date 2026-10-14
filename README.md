# AgentGuard

The control layer for AI agents: see, control and approve what every agent does.

This is the MVP described by the three documents in [docs/](docs/), built as one Next.js application: the control center (web app), the public API, the decision engine and the three enforced checkpoints.

## Run it

Needs Node.js 24 or newer (it uses the SQLite engine built into Node, in memory — nothing else to install).

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. On first request a demo workspace is created in memory: a fictional shop, "Himalayan Threads", with four agents and a week of activity. There is no external database and no `.env` file.

| Account | Role | Email | Password |
|---|---|---|---|
| Admin | Owner | admin@gmail.com | `adminPASSWORD` |
| User | Viewer | user@gmail.com | `userPASSWORD` |

Optional overrides (process environment only — no env files are shipped):

| Variable | Default |
|---|---|
| `AGENTGUARD_ADMIN_EMAIL` | `admin@gmail.com` |
| `AGENTGUARD_ADMIN_PASSWORD` | `adminPASSWORD` |
| `AGENTGUARD_USER_EMAIL` | `user@gmail.com` |
| `AGENTGUARD_USER_PASSWORD` | `userPASSWORD` |

Demo accounts (same workspace):

| Demo account | Role | Email |
|---|---|---|
| Aarav Shrestha | Owner | owner@himalayanthreads.test |
| Bikash Tamang | Admin | admin@himalayanthreads.test |
| Sita Gurung | Approver | manager@himalayanthreads.test |
| Maya Lama | Viewer | viewer@himalayanthreads.test |

Password for the four demo accounts: `namaste-agentguard`.

The fastest tour is **Playground**: twelve failure cases from the product document run against the real decision engine.

### Two things to know before exposing it

- `npm run dev` binds to `127.0.0.1` only. Published passwords are for demos; do not put the server on a public address without changing them.
- All workspace data lives in process memory and is re-seeded on each cold start. Sessions use signed cookies so Admin/User sign-in still works after a restart.

## Tests

```bash
npm run dev          # in one terminal
npm run test:e2e     # in another: checks against the running server
npm run test:e2e -- --slow   # also waits out a one-minute approval timeout
npm run typecheck
npm run lint
```

The end-to-end suite signs up a fresh workspace each run, so it never depends on the demo seed alone. It covers the approval loopholes the roadmap names: changed parameters, retries, split actions, unauthorized approvers, and requests that are asked again after a rejection.

## What is built

| From the documents | Status |
|---|---|
| Agent registry, scoped/expiring/revocable tokens, pause, kill switch | Built |
| Observe mode, live activity log, run timeline ("why did it do this?") | Built |
| Tamper-evident audit trail (hash chain), verification, CSV/JSON export | Built |
| Rules: visual builder, plain-language read-back, templates, policy replay | Built |
| Unknown tools ask a person; tool classification with suggestions | Built (suggestions are keyword matching, not a model) |
| Per-action and cumulative limits; reserve-then-settle; duplicate protection | Built |
| Approvals locked to the parameter fingerprint; verified approvers; two-person approval; timeouts and escalation | Built |
| Facts-first approval page behind login | Built |
| AI-cost budgets, loop detection, cost metering | Built |
| Response checkpoint; approved-answers library | Built (pattern matching, not a classifier) |
| Untrusted-content guard; risk checks can only raise risk | Built |
| Coverage score; agent health score; recommendations | Built |
| Public API (`/v1/check`, `/v1/approvals/{id}`, `/v1/events`, `/v1/actions/{connector}/{action}`, `/v1/agents`, `/v1/rules`, `/v1/limits`, pause/resume/kill) and webhooks | Built |
| AI-model gateway (OpenAI-compatible) | Built. Replies are returned in one piece even to streaming clients, so the response checkpoint can read them |
| MCP gateway | Built for request/response messages over Streamable HTTP. Server-initiated streams are not proxied |
| Credential vault with Stripe, Slack, HubSpot | Built. Sandbox mode is tested; **live mode calls the real APIs and has not been tested against real accounts** |
| TypeScript SDK | Built, single file in [sdk/typescript/](sdk/typescript/) |
| Organizations, members, roles (owner, admin, approver, viewer) | Built |

## What is not built

- **Slack app with approve buttons.** Slack gets a message with a link to the review page (incoming webhook). Deciding always happens on that page, after sign-in.
- **Email delivery.** Approval emails are recorded in an outbox (Settings → Notifications) but not sent; no mail provider is wired up. Member invitations work by setting a starting password.
- **n8n nodes, Make app, Python SDK, LangGraph and OpenAI Agents SDK integrations.** The Connect page shows the plain HTTP recipe for each.
- **OpenTelemetry import, Anthropic-native gateway endpoint, Shopify and Gmail connectors.**
- **Single sign-on, multi-factor sign-in, data-retention periods, automatic masking of stored personal data.**
- **Agency workspaces, oversight reports, plain-English rules, earned limits, discovery of unregistered agents** (all "after launch" in the roadmap).

## Where this differs from the roadmap's technology choices

The roadmap lists a separate backend, Go gateways, PostgreSQL, Redis, Temporal, OPA or Cedar, and a managed auth provider. This MVP runs everything in one Next.js process so it can be started with one command:

| Roadmap | Here |
|---|---|
| PostgreSQL with row-level security | In-memory SQLite; every query filters by organization |
| Redis counters | SQL sums inside a transaction |
| Temporal / durable queue | Timeouts are applied when approvals are read or decided; there is no background worker |
| OPA or Cedar | A small condition evaluator ([src/lib/rule-fields.ts](src/lib/rule-fields.ts)) |
| Clerk / Auth0 / WorkOS | Email and password with scrypt hashes and signed session cookies |
| Cloud KMS envelope encryption | Envelope encryption with a built-in or `AGENTGUARD_MASTER_KEY` master key |

Template packs on the Rules page come from [src/lib/template-data.ts](src/lib/template-data.ts).

## Icons and look

All icons come from one set, [src/components/icons.tsx](src/components/icons.tsx): one 24-pixel grid, one stroke weight, one colour. Import from `@/components/icons`; to add one, draw it on the same grid. The interface is white throughout, with the brand colours kept for actions and statuses.

## Code map

| Path | What is there |
|---|---|
| [src/server/engine.ts](src/server/engine.ts) | The decision flow: duplicate check, agent, tool, limits, rules, risk, then allow / block / ask a human |
| [src/server/approvals.ts](src/server/approvals.ts), [src/server/execution.ts](src/server/execution.ts) | Human approval and exactly-once execution |
| [src/server/vault.ts](src/server/vault.ts) | Credential storage and connectors |
| [src/server/gateway.ts](src/server/gateway.ts), [src/server/mcp.ts](src/server/mcp.ts) | The AI-model and MCP gateways |
| [src/server/response-check.ts](src/server/response-check.ts) | The response checkpoint and input scanning |
| [src/server/audit.ts](src/server/audit.ts) | The hash-chained audit log |
| [src/server/scenarios.ts](src/server/scenarios.ts), [src/server/seed.ts](src/server/seed.ts) | Playground scenarios and demo data |
| [src/lib/catalog.ts](src/lib/catalog.ts) | The action catalog: standard action types and default risk |
| [src/app/v1/](src/app/v1/), [src/app/gateway/](src/app/gateway/), [src/app/mcp/](src/app/mcp/) | Agent-facing API routes |
| [src/app/(app)/](src/app/(app)/) | The control-center pages |
| [sdk/typescript/](sdk/typescript/) | The TypeScript SDK |
