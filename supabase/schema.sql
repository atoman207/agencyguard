-- AgentGuard template catalog.
--
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- It is safe to run again. Then load the data with `npm run supabase:seed`.
--
-- The catalog is public reference data (ready-made rules and limits). The app
-- reads it with the publishable key, so row-level security allows SELECT for
-- everyone and no writes at all; the secret key bypasses RLS and is only used
-- by the seed script.

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

-- Ask the API to pick up the new tables straight away.
notify pgrst, 'reload schema';
