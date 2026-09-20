-- =====================================================================
-- Modulo "Ativos" -- acompanhamento de investimentos partilhados com
-- parceiros (ex: compra/venda de carros a dividir lucro).
--
-- Migrado do projeto Supabase separado "Ativos" (pnnkbrwmkgqartysvojh)
-- para esta base unica. Segue exactamente o mesmo padrao de accounts/
-- categories/transactions em schema.sql: uuid, user_id com
-- default auth.uid(), RLS owner_only.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

create table asset_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table asset_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  kind text not null check (kind in ('custo','receita')),
  created_at timestamptz not null default now()
);

create table asset_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  group_id uuid not null references asset_groups(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'em_carteira' check (status in ('em_carteira','vendido')),
  acquired_on date,
  sold_on date,
  expected_sale_value numeric(10,2),
  profit_pct numeric(5,2) not null default 100,
  sale_reason text,
  created_at timestamptz not null default now()
);

create table asset_partner_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  asset_id uuid not null references assets(id) on delete cascade,
  partner_id uuid not null references asset_partners(id) on delete cascade,
  profit_pct numeric(5,2) not null default 0 check (profit_pct >= 0 and profit_pct <= 100),
  created_at timestamptz not null default now(),
  unique (asset_id, partner_id)
);

create table asset_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  asset_id uuid not null references assets(id) on delete cascade,
  category_id uuid not null references asset_categories(id),
  kind text not null check (kind in ('custo','receita')),
  amount numeric(10,2) not null check (amount > 0),
  own_amount numeric(10,2),
  occurred_on date not null,
  description text,
  created_at timestamptz not null default now()
);

create table asset_movement_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  movement_id uuid not null references asset_movements(id) on delete cascade,
  partner_id uuid not null references asset_partners(id),
  amount numeric(10,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. INDICES
-- ---------------------------------------------------------------------

create index idx_assets_user_group on assets (user_id, group_id);
create index idx_asset_movements_user_asset on asset_movements (user_id, asset_id);
create index idx_asset_movements_user_date on asset_movements (user_id, occurred_on desc);
create index idx_asset_partner_shares_asset on asset_partner_shares (asset_id);
create index idx_asset_movement_partners_movement on asset_movement_partners (movement_id);


-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table asset_groups enable row level security;
alter table asset_categories enable row level security;
alter table asset_partners enable row level security;
alter table assets enable row level security;
alter table asset_partner_shares enable row level security;
alter table asset_movements enable row level security;
alter table asset_movement_partners enable row level security;

create policy "owner_only" on asset_groups for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on asset_categories for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on asset_partners for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on assets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on asset_partner_shares for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on asset_movements for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on asset_movement_partners for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
