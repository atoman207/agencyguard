import "server-only";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// The roadmap targets PostgreSQL with row-level security. This MVP uses the
// SQLite engine built into Node so it runs with no services to install.
// Every query below filters by org_id; that is the only customer separation.

export const DATA_DIR = process.env.AGENTGUARD_DATA_DIR ?? path.join(process.cwd(), ".data");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  environment TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  handles_private_data INTEGER NOT NULL DEFAULT 0,
  check_responses INTEGER NOT NULL DEFAULT 1,
  parent_agent_id TEXT,
  status_reason TEXT,
  status_changed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '["*"]',
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  action TEXT,
  suggested_action TEXT,
  status TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (org_id, name)
);
CREATE TABLE IF NOT EXISTS agent_tools (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  connection TEXT NOT NULL,
  declared INTEGER NOT NULL DEFAULT 0,
  permission TEXT NOT NULL DEFAULT 'default',
  last_seen_at INTEGER,
  PRIMARY KEY (agent_id, tool_id)
);
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  agent_id TEXT,
  conditions TEXT NOT NULL DEFAULT '[]',
  effect TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  template TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS limits (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  agent_id TEXT,
  action TEXT,
  period TEXT NOT NULL,
  value REAL NOT NULL,
  on_exceed TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  template TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT,
  source TEXT NOT NULL,
  enforcement TEXT NOT NULL,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  params_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  client_key TEXT,
  untrusted_input_seen INTEGER NOT NULL DEFAULT 0,
  risk TEXT NOT NULL,
  decision TEXT NOT NULL,
  would_decision TEXT NOT NULL,
  observe INTEGER NOT NULL DEFAULT 0,
  rules TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  status TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  customer TEXT,
  money_state TEXT NOT NULL DEFAULT 'none',
  cost_usd REAL NOT NULL DEFAULT 0,
  model TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  explanation TEXT,
  result TEXT,
  approval_id TEXT,
  duplicate_of TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS events_org_time ON events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_agent_time ON events (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_key ON events (org_id, idempotency_key, created_at DESC);
CREATE INDEX IF NOT EXISTS events_client_key ON events (org_id, client_key);
CREATE INDEX IF NOT EXISTS events_run ON events (org_id, run_id);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'action',
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  decisions TEXT NOT NULL DEFAULT '[]',
  facts TEXT NOT NULL DEFAULT '[]',
  explanation TEXT,
  expires_at INTEGER NOT NULL,
  escalated_at INTEGER,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS approvals_org_status ON approvals (org_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  connector TEXT NOT NULL,
  label TEXT NOT NULL,
  mode TEXT NOT NULL,
  secret TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  keys_rotated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, connector)
);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  auth_header TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, slug)
);
CREATE TABLE IF NOT EXISTS runs (
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  untrusted_input_seen INTEGER NOT NULL DEFAULT 0,
  untrusted_source TEXT,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, key)
);
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_org ON audit_log (org_id, seq);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  agent_id TEXT,
  event_id TEXT,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_org ON alerts (org_id, created_at DESC);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sandbox_charges (
  id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  customer TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  refunded REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, id)
);
CREATE TABLE IF NOT EXISTS sandbox_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  connector TEXT NOT NULL,
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, connector, idempotency_key)
);
`;

type Globals = typeof globalThis & {
  __agDb?: DatabaseSync;
  __agStatements?: Map<string, StatementSync>;
  __agTxDepth?: number;
};
const g = globalThis as Globals;

export function db(): DatabaseSync {
  if (!g.__agDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const conn = new DatabaseSync(path.join(DATA_DIR, "agentguard.db"));
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    conn.exec(SCHEMA);
    // Older local databases were created before avatar existed.
    try {
      conn.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
    } catch {
      /* column already present */
    }
    g.__agDb = conn;
    g.__agStatements = new Map();
    g.__agTxDepth = 0;
  }
  return g.__agDb;
}

function statement(sql: string): StatementSync {
  const conn = db();
  let st = g.__agStatements!.get(sql);
  if (!st) {
    st = conn.prepare(sql);
    g.__agStatements!.set(sql, st);
  }
  return st;
}

// node:sqlite returns null-prototype objects, which React refuses to pass to
// Client Components, so rows are copied into plain objects.
export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return statement(sql)
    .all(...params)
    .map((row) => ({ ...row })) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  const row = statement(sql).get(...params);
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, ...params: SQLInputValue[]): number {
  return Number(statement(sql).run(...params).changes);
}

/**
 * Runs `fn` atomically. The driver is synchronous and Node is single-threaded,
 * so as long as `fn` does not await, no other request can interleave.
 */
export function tx<T>(fn: () => T): T {
  const conn = db();
  if (g.__agTxDepth! > 0) return fn();
  conn.exec("BEGIN IMMEDIATE");
  g.__agTxDepth = 1;
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  } finally {
    g.__agTxDepth = 0;
  }
}

export function json<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
