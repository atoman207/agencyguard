import "server-only";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import postgres, { type Sql } from "postgres";

// Local: SQLite in .data/. Vercel (DATABASE_URL set): Supabase Postgres via the
// transaction pooler. Callers always use async get/all/run/tx. Every query
// still filters by org_id for customer separation.

export const DATA_DIR = process.env.AGENTGUARD_DATA_DIR ?? path.join(process.cwd(), ".data");

export function usesPostgres(): boolean {
  return !!process.env.DATABASE_URL;
}

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
  __agPg?: Sql;
  __agPgTx?: Sql | null;
};
const g = globalThis as Globals;

function toPgParams(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}

function pg(): Sql {
  if (!g.__agPg) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    g.__agPg = postgres(url, {
      prepare: false, // required for Supabase transaction pooler
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    g.__agPgTx = null;
  }
  return g.__agPgTx ?? g.__agPg;
}

function sqliteDb(): DatabaseSync {
  if (!g.__agDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const conn = new DatabaseSync(path.join(DATA_DIR, "agentguard.db"));
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    conn.exec(SCHEMA);
    try {
      conn.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
    } catch {
      /* already present */
    }
    g.__agDb = conn;
    g.__agStatements = new Map();
    g.__agTxDepth = 0;
  }
  return g.__agDb;
}

function sqliteStatement(sql: string): StatementSync {
  const conn = sqliteDb();
  let st = g.__agStatements!.get(sql);
  if (!st) {
    st = conn.prepare(sql);
    g.__agStatements!.set(sql, st);
  }
  return st;
}

/** @deprecated Prefer async get/all/run. Kept for rare sync-only call sites during migration. */
export function db(): DatabaseSync {
  if (usesPostgres()) throw new Error("db() is only available with local SQLite. Use get/all/run with DATABASE_URL.");
  return sqliteDb();
}

export async function all<T>(sql: string, ...params: SQLInputValue[]): Promise<T[]> {
  if (usesPostgres()) {
    const rows = await pg().unsafe(toPgParams(sql), params as never[]);
    return rows.map((row) => normalizeRow(row as Record<string, unknown>) as T);
  }
  return sqliteStatement(sql)
    .all(...params)
    .map((row) => ({ ...row })) as T[];
}

export async function get<T>(sql: string, ...params: SQLInputValue[]): Promise<T | undefined> {
  if (usesPostgres()) {
    const rows = await pg().unsafe(toPgParams(sql), params as never[]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? (normalizeRow(row) as T) : undefined;
  }
  const row = sqliteStatement(sql).get(...params);
  return row ? ({ ...row } as T) : undefined;
}

export async function run(sql: string, ...params: SQLInputValue[]): Promise<number> {
  if (usesPostgres()) {
    const result = await pg().unsafe(toPgParams(sql), params as never[]);
    return Number(result.count ?? 0);
  }
  return Number(sqliteStatement(sql).run(...params).changes);
}

/**
 * Runs `fn` atomically. With Postgres, nested get/all/run inside `fn` use the
 * same transaction connection.
 */
export async function tx<T>(fn: () => Promise<T> | T): Promise<T> {
  if (usesPostgres()) {
    if (g.__agTxDepth! > 0) return (await fn()) as T;
    return (await pg().begin(async (sql) => {
      g.__agPgTx = sql as unknown as Sql;
      g.__agTxDepth = 1;
      try {
        return (await fn()) as T;
      } finally {
        g.__agPgTx = null;
        g.__agTxDepth = 0;
      }
    })) as T;
  }

  const conn = sqliteDb();
    if (g.__agTxDepth! > 0) return (await fn()) as T;
  conn.exec("BEGIN IMMEDIATE");
  g.__agTxDepth = 1;
  try {
    const result = await fn();
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
