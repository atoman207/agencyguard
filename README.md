# AgentGuard

The control layer for AI agents: see, control and approve what every agent does.

This is the MVP described by the three documents in [docs/](docs/), built as one Next.js application: the control center (web app), the public API, the decision engine and the three enforced checkpoints.

## Run it

Needs Node.js 24 or newer (it uses the SQLite engine built into Node, so there is nothing else to install).

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. On the first sign-in a demo workspace is created: a fictional shop, "Himalayan Threads", with four agents and a week of activity.

| Demo account | Role | Email |
|---|---|---|
| Aarav Shrestha | Owner | owner@himalayanthreads.test |
| Bikash Tamang | Admin | admin@himalayanthreads.test |
| Sita Gurung | Approver | manager@himalayanthreads.test |
| Maya Lama | Viewer | viewer@himalayanthreads.test |

Password for all four: `namaste-agentguard`. The login page fills these in for you.

Two more accounts are stored as seed data in the same workspace (added on first run, or the next sign-in on an existing database), with the same development-only rule:

| Account | Role | Email | Password |
|---|---|---|---|
| Admin | Admin | admin@gmail.com | `adminPASSWORD` |
| User | Viewer | user@gmail.com | `userPASSWORD` |

They live in `SEED_ACCOUNTS` in [src/server/seed.ts](src/server/seed.ts). Change the role there if the "User" account should be able to do more than read.

The fastest tour is **Playground**: twelve failure cases from the product document (the $450 refund, a retry storm, split refunds, a changed amount after approval, an unknown tool, a runaway loop, a risky reply, hidden instructions in a web page, the kill switch) run against the real decision engine.

### Two things to know before exposing it

- `npm run dev` binds to `127.0.0.1` only. The demo accounts have a published password, so do not put the dev server on a public address. To allow other machines, run `npx next dev --hostname 0.0.0.0` on a trusted network.
- All data lives in `.data/` (SQLite database and, in development, the vault master key). Delete the folder to start again with fresh demo data.

## Tests

```bash
npm run dev          # in one terminal
npm run test:e2e     # in another: 74 checks against the running server
npm run test:e2e -- --slow   # also waits out a one-minute approval timeout
npm run typecheck
npm run lint
```

The end-to-end suite signs up a fresh workspace each run, so it never touches the demo data. It covers the approval loopholes the roadmap names: changed parameters, retries, split actions, unauthorized approvers, and requests that are asked again after a rejection.

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
| PostgreSQL with row-level security | SQLite (`node:sqlite`); every query filters by organization |
| Redis counters | SQL sums inside one synchronous transaction |
| Temporal / durable queue | Timeouts are applied when approvals are read or decided; there is no background worker |
| OPA or Cedar | A small condition evaluator ([src/lib/rule-fields.ts](src/lib/rule-fields.ts)) |
| Clerk / Auth0 / WorkOS | Email and password with scrypt hashes and server-side sessions |
| Cloud KMS envelope encryption | Envelope encryption with a master key from `AGENTGUARD_MASTER_KEY` |

Because the database is a local file and limits rely on one process, run a single instance. It is not ready for serverless hosting.

## Supabase (template catalog)

The template packs (ready-made rules and limits, shown under Rules) are read from Supabase. If Supabase is unset or unreachable, the app uses the identical built-in copy in [src/lib/template-data.ts](src/lib/template-data.ts), and the Rules page says which one is in use. Workspace data (agents, events, approvals, audit) stays in the local SQLite database: the decision engine depends on synchronous transactions that a network database cannot give it.

One-time setup:

1. Put the project URL, publishable key and secret key in `.env.local` (see `.env.example`).
2. In the Supabase dashboard open **SQL Editor**, paste [supabase/schema.sql](supabase/schema.sql) and run it. It creates three tables with row-level security: anyone may read, nobody but the secret key may write.
3. `npm run supabase:seed` writes the packs. `npm run supabase:check` verifies the connection, that the publishable key can read and cannot write, and that the catalog matches the built-in copy.

The running app uses only the publishable key. The secret key is used by the seed script alone and must never reach a browser.

## Icons and look

All icons come from one set, [src/components/icons.tsx](src/components/icons.tsx): one 24-pixel grid, one stroke weight, one colour. Import from `@/components/icons`; to add one, draw it on the same grid. The interface is white throughout, with the brand colours kept for actions and statuses.

## Configuration

Copy `.env.example` to `.env.local` and adjust.

| Variable | Purpose |
|---|---|
| `AGENTGUARD_MASTER_KEY` | 32 random bytes, base64. Wraps the vault's data keys. Required in production |
| `AGENTGUARD_PUBLIC_URL` | The address people use, for links in notifications |
| `AGENTGUARD_DATA_DIR` | Where the database lives. Default `.data` |
| `AGENTGUARD_SEED_DEMO` | `true` or `false`. Demo data is on in development and off in production by default |

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
| [src/app/(app)/](src/app/(app)/) | The control center pages |
| [src/app/globals.css](src/app/globals.css), [src/components/brand.tsx](src/components/brand.tsx) | The design language: the colours of Nepal, Dhaka weave and the Himalaya |
| [scripts/e2e.mjs](scripts/e2e.mjs) | End-to-end tests |

This project uses Next.js 16 with Cache Components. Read [AGENTS.md](AGENTS.md) before changing page structure: signed-in pages read the session first and each page folder has its own `loading.tsx`.
