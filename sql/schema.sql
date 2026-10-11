-- =====================================================================
-- App de Financas Pessoais - esquema completo
--
-- Correr de uma so vez no SQL Editor da Supabase, num projeto novo.
-- Deve terminar com "Success. No rows returned".
--
-- NOTA DE SEGURANCA: o codigo do frontend e publico (GitHub Pages) e a
-- anon key vai la dentro por design. O que protege os dados e o Row Level
-- Security definido na seccao 4 deste ficheiro, mais o registo publico
-- desativado no dashboard. A service_role key nunca entra no repositorio.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  type text not null check (type in ('conta_corrente','poupanca','investimento','cartao_credito','dinheiro','outro')),
  currency text not null default 'EUR',
  initial_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  -- sem tipo: o sinal de cada movimento e que diz se entra ou sai
  color text,
  icon text,
  parent_id uuid references categories(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  color text,
  unique (user_id, name)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  account_id uuid not null references accounts(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  amount numeric(14,2) not null,           -- positivo entra na conta, negativo sai
  description text,
  occurred_on date not null,
  -- true = conta para o saldo da conta (e dinheiro real que se moveu), mas
  -- fica de fora dos graficos, totais de receitas/despesas e orcamentos
  excluded_from_analysis boolean not null default false,
  excluded_reason text,
  -- movimento entre contas: as duas linhas (uma em cada conta, com valores
  -- simetricos) partilham este id; ver rpc_save_transaction
  transfer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table transaction_tags (
  transaction_id uuid not null references transactions(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (transaction_id, tag_id)
);

-- month = NULL      -> orcamento recorrente, aplica-se a todos os meses
-- month = uma data  -> excecao so nesse mes (normalizada ao dia 1 por trigger)
-- account_id = NULL -> orcamento agregado (todas as contas)
create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  category_id uuid not null references categories(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  month date,
  -- 0 e valido: cada categoria nasce com orcamento recorrente a 0 (trigger
  -- trg_categories_orcamento_inicial) e o valor ajusta-se depois
  amount numeric(14,2) not null check (amount >= 0)
);


-- ---------------------------------------------------------------------
-- 2. TRIGGERS
-- ---------------------------------------------------------------------

-- Subcategoria: um so nivel.
create function fn_categories_valida_mae() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Uma categoria nao pode ser mae de si propria.';
    end if;
    if not exists (select 1 from categories p
                   where p.id = new.parent_id and p.parent_id is null) then
      raise exception 'A categoria-mae nao pode ser ela propria uma subcategoria.';
    end if;
    if exists (select 1 from categories f where f.parent_id = new.id) then
      raise exception 'Uma categoria com subcategorias nao pode passar a subcategoria.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_categories_valida_mae
  before insert or update on categories
  for each row execute function fn_categories_valida_mae();

-- Todas as categorias entram no orcamento: ao criar uma,
-- nasce o orcamento recorrente agregado a 0.
create function fn_categories_orcamento_inicial() returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into budgets (user_id, category_id, account_id, month, amount)
  values (new.user_id, new.id, null, null, 0)
  on conflict do nothing;
  return new;
end;
$$;

create trigger trg_categories_orcamento_inicial
  after insert on categories
  for each row execute function fn_categories_orcamento_inicial();

-- Normaliza o mes ao dia 1, para o indice unico e as queries baterem certo
-- mesmo que a app envie uma data a meio do mes.
create function fn_budgets_normaliza_mes() returns trigger as $$
begin
  if new.month is not null then
    new.month := date_trunc('month', new.month)::date;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_budgets_normaliza_mes
  before insert or update on budgets
  for each row execute function fn_budgets_normaliza_mes();

create function fn_set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_transactions_updated_at
  before update on transactions
  for each row execute function fn_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. INDICES
-- ---------------------------------------------------------------------

-- account_id e month sao ambos opcionais, e o Postgres trata cada NULL como
-- distinto num unique normal. Usam-se valores-sentinela para os tornar
-- comparaveis e garantir que nao ha dois orcamentos para o mesmo âmbito.
create unique index budgets_unique on budgets (
  user_id,
  coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  category_id,
  coalesce(month, '0001-01-01'::date)
);

create index idx_transactions_user_date on transactions (user_id, occurred_on desc);
create index idx_transactions_user_account on transactions (user_id, account_id);
create index idx_transactions_user_category on transactions (user_id, category_id);
create index idx_transactions_transfer on transactions (transfer_id) where transfer_id is not null;

-- indice parcial: as queries de analise filtram sempre por "nao ocultos",
-- por isso um indice mais pequeno e especifico e mais eficiente
create index idx_transactions_analise on transactions (user_id, occurred_on desc)
  where excluded_from_analysis = false;

create index idx_budgets_user_month on budgets (user_id, month);
create index idx_budgets_user_account_month on budgets (user_id, account_id, month);

-- a chave primaria e (transaction_id, tag_id) e nao serve a direcao do join
-- usado na analise por tag
create index idx_transaction_tags_tag on transaction_tags (tag_id);


-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
--    Esta e a protecao real dos dados. Sem isto, a anon key publica dava
--    acesso de leitura e escrita a qualquer pessoa.
-- ---------------------------------------------------------------------

alter table accounts enable row level security;
alter table categories enable row level security;
alter table tags enable row level security;
alter table transactions enable row level security;
alter table transaction_tags enable row level security;
alter table budgets enable row level security;

create policy "owner_only" on accounts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on categories for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on tags for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on transactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_only" on budgets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- transaction_tags nao tem user_id direto; valida atraves do movimento
create policy "owner_only" on transaction_tags for all
  using (exists (select 1 from transactions t where t.id = transaction_id and t.user_id = auth.uid()))
  with check (exists (select 1 from transactions t where t.id = transaction_id and t.user_id = auth.uid()));


-- ---------------------------------------------------------------------
-- 5. FUNCOES DE AGREGACAO (RPC)
--
--    security invoker => o RLS continua a aplicar-se dentro da funcao,
--    ou seja, estas funcoes nao sao uma porta lateral aos dados.
--    Existem para agregar no lado da base de dados e nunca trazer a
--    tabela de movimentos inteira para o browser.
-- ---------------------------------------------------------------------

-- Mes financeiro: o salario entra no ultimo dia util do mes, por isso esse
-- dia e os seguintes contam ja para o mes seguinte. Todas as agregacoes
-- mensais usam fn_month_bounds em vez do mes de calendario.

-- Domingo de Pascoa (algoritmo de Gauss/Meeus para o calendario gregoriano).
create or replace function public.fn_easter(p_year int)
returns date
language sql
immutable
set search_path = public
as $$
  with v as (
    select p_year % 19 as a, p_year / 100 as b, p_year % 100 as c
  ), w as (
    select a, b, c, b / 4 as d, b % 4 as e, (b + 8) / 25 as f, c / 4 as i, c % 4 as k from v
  ), x as (
    select a, b, c, d, e, i, k, (b - f + 1) / 3 as g from w
  ), y as (
    select a, e, i, k, (19 * a + b - d - g + 15) % 30 as h from x
  ), z as (
    select a, h, (32 + 2 * e + 2 * i - h - k) % 7 as l from y
  ), m as (
    select h, l, (a + 11 * h + 22 * l) / 451 as mm from z
  )
  select make_date(p_year, (h + l - 7 * mm + 114) / 31, ((h + l - 7 * mm + 114) % 31) + 1)
  from m;
$$;

-- Feriados nacionais obrigatorios em Portugal (fixos e moveis).
create or replace function public.fn_is_pt_holiday(p_day date)
returns boolean
language sql
immutable
set search_path = public
as $$
  select to_char(p_day, 'MM-DD') in (
           '01-01', '04-25', '05-01', '06-10', '08-15',
           '10-05', '11-01', '12-01', '12-08', '12-25')
      or p_day = fn_easter(extract(year from p_day)::int) - 2   -- Sexta-feira Santa
      or p_day = fn_easter(extract(year from p_day)::int)       -- Pascoa
      or p_day = fn_easter(extract(year from p_day)::int) + 60; -- Corpo de Deus
$$;

-- Ultimo dia util do mes da data indicada.
create or replace function public.fn_last_business_day(p_month date)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  d date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  while extract(isodow from d) >= 6 or fn_is_pt_holiday(d) loop
    d := d - 1;
  end loop;
  return d;
end;
$$;

-- Limites do mes financeiro: [ini, fim[ (fim exclusivo).
create or replace function public.fn_month_bounds(p_month date)
returns table (ini date, fim date)
language sql
immutable
set search_path = public
as $$
  select fn_last_business_day((date_trunc('month', p_month) - interval '1 month')::date),
         fn_last_business_day(p_month);
$$;

-- Para o browser: mes financeiro de uma data (dia 1) e limites de um mes
-- (fim inclusivo, que e o que o filtro de datas dos movimentos usa).
create or replace function public.rpc_financial_month(p_day date)
returns date
language sql
immutable
set search_path = public
as $$
  select case when p_day >= fn_last_business_day(p_day)
              then (date_trunc('month', p_day) + interval '1 month')::date
              else date_trunc('month', p_day)::date end;
$$;

create or replace function public.rpc_month_bounds(p_month date)
returns table (ini date, fim date)
language sql
immutable
set search_path = public
as $$
  select b.ini, b.fim - 1 from fn_month_bounds(p_month) b;
$$;


-- Saldo de todas as contas de uma vez.
-- Inclui deliberadamente os movimentos ocultos da analise: eles sao dinheiro
-- real que se moveu e contam para o saldo. E o unico sitio onde isso acontece.
create or replace function public.rpc_account_balances()
returns table (
  account_id uuid,
  name text,
  type text,
  currency text,
  initial_balance numeric,
  balance numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  select a.id,
         a.name,
         a.type,
         a.currency,
         a.initial_balance,
         a.initial_balance + coalesce(sum(t.amount), 0)
  from accounts a
  left join transactions t on t.account_id = a.id
  group by a.id, a.name, a.type, a.currency, a.initial_balance, a.created_at
  order by a.created_at;
$$;


-- Totais de receita e despesa de um mes.
-- p_account_id NULL = todas as contas. As despesas vem como valor positivo
-- (magnitude), que e o que os graficos e os totais precisam.
create or replace function public.rpc_month_summary(
  p_month date,
  p_account_id uuid default null
)
returns table (
  total_receitas numeric,
  total_despesas numeric,
  saldo numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    coalesce(sum(t.amount) filter (where t.amount > 0), 0),
    coalesce(-sum(t.amount) filter (where t.amount < 0), 0),
    coalesce(sum(t.amount), 0)
  from transactions t, fn_month_bounds(p_month) b
  where t.excluded_from_analysis = false
    and t.occurred_on >= b.ini
    and t.occurred_on <  b.fim
    and (p_account_id is null or t.account_id = p_account_id);
$$;


-- Gasto por categoria num mes, ja cruzado com o orcamento efetivo.
--
-- Orcamento efetivo: a linha do mes especifico sobrepoe-se a linha recorrente
-- (month is null). O distinct on resolve isso ordenando por (month is null),
-- que coloca primeiro o override do mes, porque false ordena antes de true.
--
-- O ambito da conta e correspondencia exata: ao ver "Todas as contas" usam-se
-- os orcamentos agregados (account_id is null); ao ver uma conta especifica
-- usam-se os orcamentos dessa conta. Um orcamento agregado nao e comparado
-- com o gasto de uma so conta, porque isso daria uma leitura enganadora.
--
-- spent e o liquido do mes, no sentido de "saiu": positivo se saiu mais do
-- que entrou, negativo se entrou mais. As categorias nao tem tipo.
--
-- Movimentos sem categoria aparecem numa linha propria "Sem categoria" com
-- category_id nulo, em vez de desaparecerem silenciosamente do total.
create or replace function public.rpc_category_spend(
  p_month date,
  p_account_id uuid default null
)
returns table (
  category_id uuid,
  category_name text,
  color text,
  icon text,
  spent numeric,
  budget numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  with bounds as (
    select ini, fim, date_trunc('month', p_month)::date as mes
    from fn_month_bounds(p_month)
  ),
  mov as (
    select t.category_id, sum(t.amount) as total
    from transactions t, bounds b
    where t.excluded_from_analysis = false
      and t.occurred_on >= b.ini
      and t.occurred_on <  b.fim
      and (p_account_id is null or t.account_id = p_account_id)
    group by t.category_id
  ),
  orc as (
    select distinct on (bg.category_id) bg.category_id, bg.amount
    from budgets bg, bounds b
    where (bg.month = b.mes or bg.month is null)
      and (
            (p_account_id is null     and bg.account_id is null)
         or (p_account_id is not null and bg.account_id = p_account_id)
          )
    order by bg.category_id, (bg.month is null)
  ),
  resultado as (
    select c.id                   as category_id,
           c.name                 as category_name,
           c.color                as color,
           c.icon                 as icon,
           -coalesce(m.total, 0)  as spent,
           o.amount               as budget
    from categories c
    left join mov m on m.category_id = c.id
    left join orc o on o.category_id = c.id
    where m.category_id is not null or o.category_id is not null

    union all

    select null, 'Sem categoria', null, null, -m.total, null
    from mov m
    where m.category_id is null
  )
  select * from resultado
  order by spent desc, category_name;
$$;


-- Gasto agrupado por tag num mes. So despesas, que e o que interessa analisar.
create or replace function public.rpc_tag_spend(
  p_month date,
  p_account_id uuid default null
)
returns table (
  tag_id uuid,
  tag_name text,
  color text,
  spent numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  select tg.id,
         tg.name,
         tg.color,
         -sum(t.amount)
  from fn_month_bounds(p_month) b,
       tags tg
  join transaction_tags tt on tt.tag_id = tg.id
  join transactions t on t.id = tt.transaction_id
  where t.excluded_from_analysis = false
    and t.amount < 0
    and t.occurred_on >= b.ini
    and t.occurred_on <  b.fim
    and (p_account_id is null or t.account_id = p_account_id)
  group by tg.id, tg.name, tg.color
  order by 4 desc, tg.name;
$$;


-- Cria (p_id nulo) ou altera um movimento e, se houver conta de
-- contrapartida, a linha simetrica nessa conta. Sem contrapartida, uma
-- linha simetrica que existisse e apagada. As duas linhas ficam com a mesma
-- data, categoria, descricao, estado de analise e etiquetas.
create or replace function public.rpc_save_transaction(
  p_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_occurred_on date,
  p_category_id uuid,
  p_description text,
  p_excluded boolean,
  p_excluded_reason text,
  p_counter_account_id uuid,
  p_tag_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id       uuid := p_id;
  v_transfer uuid;
  v_counter  uuid;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'O valor tem de ser diferente de zero.';
  end if;
  if p_counter_account_id = p_account_id then
    raise exception 'A conta de contrapartida tem de ser diferente da conta do movimento.';
  end if;

  if v_id is null then
    insert into transactions (account_id, amount, occurred_on, category_id, description,
                              excluded_from_analysis, excluded_reason)
    values (p_account_id, p_amount, p_occurred_on, p_category_id, p_description,
            p_excluded, p_excluded_reason)
    returning id into v_id;
  else
    select transfer_id into v_transfer from transactions where id = v_id;
    if not found then
      raise exception 'Movimento nao encontrado.';
    end if;
    update transactions
       set account_id = p_account_id, amount = p_amount, occurred_on = p_occurred_on,
           category_id = p_category_id, description = p_description,
           excluded_from_analysis = p_excluded, excluded_reason = p_excluded_reason
     where id = v_id;
    if v_transfer is not null then
      select id into v_counter from transactions where transfer_id = v_transfer and id <> v_id;
    end if;
  end if;

  if p_counter_account_id is null then
    if v_counter is not null then
      delete from transactions where id = v_counter;
      v_counter := null;
    end if;
    update transactions set transfer_id = null where id = v_id and transfer_id is not null;
  else
    if v_transfer is null then
      v_transfer := gen_random_uuid();
      update transactions set transfer_id = v_transfer where id = v_id;
    end if;
    if v_counter is null then
      insert into transactions (account_id, amount, occurred_on, category_id, description,
                                excluded_from_analysis, excluded_reason, transfer_id)
      values (p_counter_account_id, -p_amount, p_occurred_on, p_category_id, p_description,
              p_excluded, p_excluded_reason, v_transfer)
      returning id into v_counter;
    else
      update transactions
         set account_id = p_counter_account_id, amount = -p_amount, occurred_on = p_occurred_on,
             category_id = p_category_id, description = p_description,
             excluded_from_analysis = p_excluded, excluded_reason = p_excluded_reason
       where id = v_counter;
    end if;
  end if;

  delete from transaction_tags where transaction_id in (v_id, v_counter);
  insert into transaction_tags (transaction_id, tag_id)
  select l.id, g.tag_id
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as g(tag_id)
  cross join (values (v_id), (v_counter)) as l(id)
  where l.id is not null;

  return v_id;
end;
$$;


-- So um utilizador autenticado pode invocar as funcoes. O RLS ja protegia os
-- dados, mas nao ha razao para as deixar expostas ao role anonimo.
revoke all on function public.rpc_account_balances() from public, anon;
revoke all on function public.rpc_month_summary(date, uuid) from public, anon;
revoke all on function public.rpc_category_spend(date, uuid) from public, anon;
revoke all on function public.rpc_tag_spend(date, uuid) from public, anon;
revoke all on function public.rpc_save_transaction(uuid, uuid, numeric, date, uuid, text, boolean, text, uuid, uuid[]) from public, anon;

grant execute on function public.rpc_account_balances() to authenticated;
grant execute on function public.rpc_month_summary(date, uuid) to authenticated;
grant execute on function public.rpc_category_spend(date, uuid) to authenticated;
grant execute on function public.rpc_tag_spend(date, uuid) to authenticated;
grant execute on function public.rpc_save_transaction(uuid, uuid, numeric, date, uuid, text, boolean, text, uuid, uuid[]) to authenticated;

revoke all on function public.rpc_financial_month(date) from public, anon;
revoke all on function public.rpc_month_bounds(date) from public, anon;
grant execute on function public.rpc_financial_month(date) to authenticated;
grant execute on function public.rpc_month_bounds(date) to authenticated;


-- ---------------------------------------------------------------------
-- 6. TETO GLOBAL MENSAL
--
--    Limite para o total que sai num mes, independente dos orcamentos por
--    categoria: a soma desses pode ficar acima ou abaixo deste valor. E
--    sempre agregado (todas as contas) e compara-se com o total_despesas de
--    rpc_month_summary(p_month, null).
--
--    Mesma regra de ambito que budgets: month = NULL e o recorrente, uma
--    linha com mes substitui-o so nesse mes.
-- ---------------------------------------------------------------------

create table budget_caps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  month date,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create unique index budget_caps_unique on budget_caps (
  user_id,
  coalesce(month, '0001-01-01'::date)
);

-- fn_budgets_normaliza_mes so toca em new.month, por isso serve tal e qual
create trigger trg_budget_caps_normaliza_mes
  before insert or update on budget_caps
  for each row execute function fn_budgets_normaliza_mes();

alter table budget_caps enable row level security;

create policy "owner_only" on budget_caps for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
