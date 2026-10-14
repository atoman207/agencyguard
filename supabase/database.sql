-- AgentGuard database: the one SQL file for Supabase (Postgres).
--
-- Run it once: Supabase dashboard > SQL Editor > New query > paste > Run.
-- It is safe to run again; nothing is overwritten or duplicated.
--
-- What it does
--   1. Creates the application tables (workspace, users, sessions, agents,
--      events, approvals, audit log ...).
--   2. Locks them away from the public API (row-level security, no policies),
--      so only the server's DATABASE_URL connection can read them.
--   3. Creates the template catalog (read-only to everyone through the API).
--   4. Inserts the workspace and the two sign-in accounts.
--   5. Inserts the template catalog data.
--
-- After running it, set DATABASE_URL on Vercel to the Supabase *Transaction
-- pooler* connection string (port 6543) and redeploy.
--
-- Sign-in accounts (change these passwords before storing real data):
--   admin@gmail.com / adminPASSWORD   owner of the workspace (full access)
--   user@gmail.com  / userPASSWORD    viewer (read-only)
-- Passwords are stored as scrypt hashes, never as plain text. To use a
-- different password, run `node scripts/hash-password.mjs "new password"` and
-- update users.password_hash.
--
-- Epoch timestamps are bigint milliseconds, to match the app's queries.


-- 1. Application tables -------------------------------------------------------

create table if not exists public.organizations (
  id text primary key,
  name text not null,
  settings text not null default '{}',
  created_at bigint not null
);

create table if not exists public.users (
  id text primary key,
  org_id text not null references public.organizations (id),
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null,
  avatar text,
  created_at bigint not null
);

create table if not exists public.sessions (
  token_hash text primary key,
  user_id text not null references public.users (id) on delete cascade,
  created_at bigint not null,
  expires_at bigint not null
);

create table if not exists public.api_keys (
  id text primary key,
  org_id text not null references public.organizations (id),
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  created_at bigint not null,
  revoked_at bigint
);

create table if not exists public.agents (
  id text primary key,
  org_id text not null references public.organizations (id),
  name text not null,
  platform text not null,
  purpose text not null default '',
  owner_user_id text,
  environment text not null,
  mode text not null,
  status text not null,
  handles_private_data integer not null default 0,
  check_responses integer not null default 1,
  parent_agent_id text,
  status_reason text,
  status_changed_at bigint,
  created_at bigint not null
);

create table if not exists public.agent_tokens (
  id text primary key,
  org_id text not null,
  agent_id text not null references public.agents (id),
  name text not null,
  prefix text not null,
  token_hash text not null unique,
  scopes text not null default '["*"]',
  expires_at bigint,
  revoked_at bigint,
  last_used_at bigint,
  created_at bigint not null
);

create table if not exists public.tools (
  id text primary key,
  org_id text not null,
  name text not null,
  action text,
  suggested_action text,
  status text not null,
  first_seen_at bigint not null,
  last_seen_at bigint not null,
  unique (org_id, name)
);

create table if not exists public.agent_tools (
  agent_id text not null,
  tool_id text not null,
  org_id text not null,
  connection text not null,
  declared integer not null default 0,
  permission text not null default 'default',
  last_seen_at bigint,
  primary key (agent_id, tool_id)
);

create table if not exists public.rules (
  id text primary key,
  org_id text not null,
  name text not null,
  description text not null default '',
  agent_id text,
  conditions text not null default '[]',
  effect text not null,
  enabled integer not null default 1,
  template text,
  version integer not null default 1,
  created_by text,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists public.limits (
  id text primary key,
  org_id text not null,
  name text not null,
  kind text not null,
  scope text not null,
  agent_id text,
  action text,
  period text not null,
  value double precision not null,
  on_exceed text not null,
  enabled integer not null default 1,
  template text,
  created_at bigint not null
);

create table if not exists public.events (
  id text primary key,
  org_id text not null,
  agent_id text not null,
  run_id text,
  source text not null,
  enforcement text not null,
  tool text not null,
  action text not null,
  resource text,
  params text not null default '{}',
  params_fingerprint text not null,
  idempotency_key text not null,
  client_key text,
  untrusted_input_seen integer not null default 0,
  risk text not null,
  decision text not null,
  would_decision text not null,
  observe integer not null default 0,
  rules text not null default '[]',
  reason text,
  status text not null,
  amount double precision,
  currency text,
  customer text,
  money_state text not null default 'none',
  cost_usd double precision not null default 0,
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  explanation text,
  result text,
  approval_id text,
  duplicate_of text,
  created_at bigint not null,
  completed_at bigint
);

create index if not exists events_org_time on public.events (org_id, created_at desc);
create index if not exists events_agent_time on public.events (agent_id, created_at desc);
create index if not exists events_key on public.events (org_id, idempotency_key, created_at desc);
create index if not exists events_client_key on public.events (org_id, client_key);
create index if not exists events_run on public.events (org_id, run_id);

create table if not exists public.approvals (
  id text primary key,
  org_id text not null,
  event_id text not null,
  agent_id text not null,
  kind text not null default 'action',
  fingerprint text not null,
  status text not null,
  required integer not null default 1,
  decisions text not null default '[]',
  facts text not null default '[]',
  explanation text,
  expires_at bigint not null,
  escalated_at bigint,
  created_at bigint not null,
  decided_at bigint
);

create index if not exists approvals_org_status on public.approvals (org_id, status, created_at desc);

create table if not exists public.credentials (
  id text primary key,
  org_id text not null,
  connector text not null,
  label text not null,
  mode text not null,
  secret text not null,
  hint text not null default '',
  keys_rotated integer not null default 0,
  created_at bigint not null,
  unique (org_id, connector)
);

create table if not exists public.mcp_servers (
  id text primary key,
  org_id text not null,
  slug text not null,
  name text not null,
  url text not null,
  auth_header text,
  created_at bigint not null,
  unique (org_id, slug)
);

create table if not exists public.runs (
  org_id text not null,
  key text not null,
  agent_id text not null,
  untrusted_input_seen integer not null default 0,
  untrusted_source text,
  last_seen_at bigint not null,
  primary key (org_id, key)
);

create table if not exists public.audit_log (
  seq bigserial primary key,
  org_id text not null,
  actor_type text not null,
  actor_id text,
  actor_label text not null,
  action text not null,
  target_type text not null,
  target_id text,
  details text not null default '{}',
  created_at bigint not null,
  prev_hash text not null,
  hash text not null
);

create index if not exists audit_org on public.audit_log (org_id, seq);

create table if not exists public.alerts (
  id text primary key,
  org_id text not null,
  kind text not null,
  severity text not null,
  title text not null,
  body text not null,
  agent_id text,
  event_id text,
  created_at bigint not null,
  acknowledged_at bigint
);

create index if not exists alerts_org on public.alerts (org_id, created_at desc);

create table if not exists public.outbox (
  id text primary key,
  org_id text not null,
  channel text not null,
  kind text not null,
  payload text not null,
  status text not null,
  detail text,
  created_at bigint not null
);

create table if not exists public.sandbox_charges (
  id text not null,
  org_id text not null,
  customer text not null,
  customer_name text not null,
  customer_email text not null,
  amount double precision not null,
  currency text not null,
  refunded double precision not null default 0,
  description text not null,
  created_at bigint not null,
  primary key (org_id, id)
);

create table if not exists public.sandbox_log (
  id text primary key,
  org_id text not null,
  connector text not null,
  action text not null,
  idempotency_key text not null,
  request text not null,
  response text not null,
  created_at bigint not null,
  unique (org_id, connector, idempotency_key)
);


-- 2. Keep application tables private -----------------------------------------
-- Supabase exposes everything in the public schema through its REST API to the
-- anon and authenticated roles. These tables hold password hashes, sessions and
-- the credential vault, so switch on row-level security with no policies (the
-- API sees nothing) and revoke the API roles' access. The server connects with
-- DATABASE_URL as the database owner, which is not affected by either.

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'users', 'sessions', 'api_keys', 'agents', 'agent_tokens',
    'tools', 'agent_tools', 'rules', 'limits', 'events', 'approvals',
    'credentials', 'mcp_servers', 'runs', 'audit_log', 'alerts', 'outbox',
    'sandbox_charges', 'sandbox_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on sequence public.audit_log_seq_seq from anon, authenticated;


-- 3. Template catalog ---------------------------------------------------------
-- Public reference data (ready-made rules and limits). The app reads it with
-- the publishable key; row-level security allows SELECT and no writes.

create table if not exists public.template_packs (
  id          text primary key,
  name        text not null,
  audience    text not null,
  description text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.template_rules (
  id          bigint generated always as identity primary key,
  pack_id     text not null references public.template_packs (id) on delete cascade,
  position    integer not null,
  name        text not null,
  description text not null default '',
  effect      text not null check (effect in ('allow', 'ask_human', 'ask_two', 'block')),
  conditions  jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  unique (pack_id, position)
);

create table if not exists public.template_limits (
  id          bigint generated always as identity primary key,
  pack_id     text not null references public.template_packs (id) on delete cascade,
  position    integer not null,
  name        text not null,
  kind        text not null check (kind in ('money', 'cost', 'count')),
  scope       text not null check (scope in ('action', 'customer', 'resource', 'agent', 'organization')),
  action      text,
  period      text not null check (period in ('action', 'hour', 'day', 'week', 'month')),
  value       numeric not null check (value > 0),
  on_exceed   text not null check (on_exceed in ('block', 'ask_human')),
  unique (pack_id, position)
);

alter table public.template_packs  enable row level security;
alter table public.template_rules  enable row level security;
alter table public.template_limits enable row level security;

drop policy if exists "template_packs are readable"  on public.template_packs;
drop policy if exists "template_rules are readable"  on public.template_rules;
drop policy if exists "template_limits are readable" on public.template_limits;

create policy "template_packs are readable"  on public.template_packs  for select to anon, authenticated using (true);
create policy "template_rules are readable"  on public.template_rules  for select to anon, authenticated using (true);
create policy "template_limits are readable" on public.template_limits for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.template_packs, public.template_rules, public.template_limits to anon, authenticated;
grant all on public.template_packs, public.template_rules, public.template_limits to service_role;
grant usage, select on all sequences in schema public to service_role;


-- 4. Workspace and sign-in accounts ------------------------------------------
-- The workspace uses the app's default settings ('{}' means "all defaults").
-- The admin is the workspace owner; the user can view but not change anything.
-- Re-running restores the published passwords (adminPASSWORD / userPASSWORD).
-- The Next.js app also upserts these on every sign-in (see SEED_ACCOUNTS).

insert into public.organizations (id, name, settings, created_at)
values ('org_agentguard', 'AgentGuard', '{}', (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do nothing;

insert into public.users (id, org_id, email, name, password_hash, role, created_at)
values
  ('usr_admin', 'org_agentguard', 'admin@gmail.com', 'Admin',
   'scrypt$2ADg4aGRXXABL5Lj1MCLAw==$TNCQdQ6Uh2VKk2DG7SHwI33d6dtzBL4NxAXYOm2a7dWcg5yC6XH0BCMXpU1ahOwX+zyJU/VbCL0LgDXdqkld5A==',
   'owner', (extract(epoch from now()) * 1000)::bigint),
  ('usr_user', 'org_agentguard', 'user@gmail.com', 'User',
   'scrypt$46GGV8y8vd4aHZHnviNwSg==$b2H3HpxtjUUeJVIaqcBgiRGrBtpQIMyhl3oUB87HH6Ry9GCTuFD+dvwi2ZKpiBnFTr2/J+lVMHLi7w2nURgbmw==',
   'viewer', (extract(epoch from now()) * 1000)::bigint)
on conflict (email) do update set
  name = excluded.name,
  password_hash = excluded.password_hash,
  role = excluded.role,
  org_id = excluded.org_id;


-- 5. Template catalog data ----------------------------------------------------
-- Generated from src/lib/template-data.ts by `npm run sql:build`.
-- BEGIN TEMPLATE DATA
insert into public.template_packs (id, name, audience, description, sort_order) values
  ('ecommerce-support', 'E-commerce support', 'Agents that answer customers and issue refunds', 'Small refunds flow through; large ones, repeat refunds to one customer and anything destructive reach a person.', 0),
  ('sales-outreach', 'Sales outreach', 'Agents that send email on your behalf', 'Stops the wrong-list mistake: large sends wait for approval and mass blasts are blocked.', 1),
  ('finance-operations', 'Finance operations', 'Agents that pay invoices or move money', 'Every payment reaches a person, large ones reach two, and there is a hard daily cap.', 2),
  ('customer-support', 'Customer support', 'Agents that handle tickets and orders', 'Everyday order changes are allowed; exporting data is blocked and public posts wait for approval.', 3)
on conflict (id) do update set name = excluded.name, audience = excluded.audience, description = excluded.description, sort_order = excluded.sort_order;

delete from public.template_rules  where pack_id in ('ecommerce-support', 'sales-outreach', 'finance-operations', 'customer-support');
delete from public.template_limits where pack_id in ('ecommerce-support', 'sales-outreach', 'finance-operations', 'customer-support');

insert into public.template_rules (pack_id, position, name, description, effect, conditions) values
  ('ecommerce-support', 0, 'Small refunds are automatic', 'Refunds up to 100 need no approval.', 'allow', '[{"field":"action","op":"is","value":"payment.refund"},{"field":"amount","op":"lte","value":100}]'::jsonb),
  ('ecommerce-support', 1, 'Large refunds need a manager', 'A single refund above 100 waits for a person.', 'ask_human', '[{"field":"action","op":"is","value":"payment.refund"},{"field":"amount","op":"gt","value":100}]'::jsonb),
  ('ecommerce-support', 2, 'Never delete data in production', 'Deleting data in production is blocked outright.', 'block', '[{"field":"action","op":"is","value":"data.delete"},{"field":"environment","op":"is","value":"production"}]'::jsonb),
  ('ecommerce-support', 3, 'Deleting a customer needs a person', '', 'ask_human', '[{"field":"action","op":"is","value":"crm.delete"}]'::jsonb),
  ('sales-outreach', 0, 'Large sends need approval', 'More than 50 recipients in one send waits for a person.', 'ask_human', '[{"field":"action","op":"is","value":"email.send"},{"field":"recipient_count","op":"gt","value":50}]'::jsonb),
  ('sales-outreach', 1, 'No mass blasts', 'More than 500 recipients in one send is blocked.', 'block', '[{"field":"action","op":"is","value":"email.send"},{"field":"recipient_count","op":"gt","value":500}]'::jsonb),
  ('sales-outreach', 2, 'Outreach outside working hours needs approval', '', 'ask_human', '[{"field":"action","op":"is","value":"email.send"},{"field":"hour","op":"not_between","value":"8-19"}]'::jsonb),
  ('finance-operations', 0, 'Payments always need a person', '', 'ask_human', '[{"field":"action","op":"is","value":"payment.payout"}]'::jsonb),
  ('finance-operations', 1, 'Large payments need two people', 'Payments of 1,000 or more need two different approvers.', 'ask_two', '[{"field":"action","op":"is","value":"payment.payout"},{"field":"amount","op":"gte","value":1000}]'::jsonb),
  ('finance-operations', 2, 'Small charges are automatic', '', 'allow', '[{"field":"action","op":"is","value":"payment.charge"},{"field":"amount","op":"lte","value":500}]'::jsonb),
  ('finance-operations', 3, 'Charges above 500 need approval', '', 'ask_human', '[{"field":"action","op":"is","value":"payment.charge"},{"field":"amount","op":"gt","value":500}]'::jsonb),
  ('customer-support', 0, 'Order changes are allowed', '', 'allow', '[{"field":"action","op":"is","value":"order.update"}]'::jsonb),
  ('customer-support', 1, 'Publishing needs approval', '', 'ask_human', '[{"field":"action","op":"is","value":"content.publish"}]'::jsonb),
  ('customer-support', 2, 'No data exports', '', 'block', '[{"field":"action","op":"is","value":"data.export"}]'::jsonb);

insert into public.template_limits (pack_id, position, name, kind, scope, action, period, value, on_exceed) values
  ('ecommerce-support', 0, 'Refunds per customer per week', 'money', 'customer', 'payment.refund', 'week', 150, 'ask_human'),
  ('ecommerce-support', 1, 'Refunds per agent per day', 'money', 'agent', 'payment.refund', 'day', 2000, 'block'),
  ('ecommerce-support', 2, 'Daily AI budget per agent', 'cost', 'agent', null, 'day', 5, 'block'),
  ('sales-outreach', 0, 'Emails per agent per day', 'count', 'agent', 'email.send', 'day', 200, 'block'),
  ('finance-operations', 0, 'Daily payment cap', 'money', 'organization', 'payment.payout', 'day', 10000, 'block'),
  ('customer-support', 0, 'Monthly AI budget', 'cost', 'organization', null, 'month', 200, 'block');
-- END TEMPLATE DATA

notify pgrst, 'reload schema';
