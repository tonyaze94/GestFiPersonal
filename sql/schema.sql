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
  kind text not null check (kind in ('receita','despesa')),
  color text,
  icon text,
  parent_id uuid references categories(id),
  created_at timestamptz not null default now(),
  -- impede duplicados dentro do mesmo tipo; "Emprestimos" pode existir em
  -- despesa E em receita, porque o kind e diferente
  unique (user_id, name, kind)
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
  amount numeric(14,2) not null,           -- positivo = receita, negativo = despesa
  description text,
  occurred_on date not null,
  -- true = conta para o saldo da conta (e dinheiro real que se moveu), mas
  -- fica de fora dos graficos, totais de receitas/despesas e orcamentos
  excluded_from_analysis boolean not null default false,
  excluded_reason text,
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
  amount numeric(14,2) not null check (amount > 0)
);


-- ---------------------------------------------------------------------
-- 2. TRIGGERS
-- ---------------------------------------------------------------------

-- So faz sentido orcamentar despesas. Um check normal nao pode consultar
-- outra tabela, por isso valida-se com um trigger.
create function fn_budgets_categoria_deve_ser_despesa() returns trigger as $$
begin
  if not exists (
    select 1 from categories c
    where c.id = new.category_id and c.kind = 'despesa'
  ) then
    raise exception 'So e possivel definir orcamento para categorias de despesa (category_id=%).', new.category_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_budgets_categoria_despesa
  before insert or update on budgets
  for each row execute function fn_budgets_categoria_deve_ser_despesa();

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
  from transactions t
  where t.excluded_from_analysis = false
    and t.occurred_on >= date_trunc('month', p_month)::date
    and t.occurred_on <  (date_trunc('month', p_month) + interval '1 month')::date
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
-- Movimentos sem categoria aparecem numa linha propria "Sem categoria" com
-- category_id nulo, em vez de desaparecerem silenciosamente do total.
create or replace function public.rpc_category_spend(
  p_month date,
  p_account_id uuid default null
)
returns table (
  category_id uuid,
  category_name text,
  kind text,
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
    select date_trunc('month', p_month)::date as ini,
           (date_trunc('month', p_month) + interval '1 month')::date as fim
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
    where (bg.month = b.ini or bg.month is null)
      and (
            (p_account_id is null     and bg.account_id is null)
         or (p_account_id is not null and bg.account_id = p_account_id)
          )
    order by bg.category_id, (bg.month is null)
  ),
  resultado as (
    select c.id            as category_id,
           c.name          as category_name,
           c.kind          as kind,
           c.color         as color,
           c.icon          as icon,
           coalesce(abs(m.total), 0) as spent,
           o.amount        as budget
    from categories c
    left join mov m on m.category_id = c.id
    left join orc o on o.category_id = c.id
    where m.category_id is not null or o.category_id is not null

    union all

    select null,
           'Sem categoria',
           case when m.total < 0 then 'despesa' else 'receita' end,
           null,
           null,
           abs(m.total),
           null
    from mov m
    where m.category_id is null
  )
  select * from resultado
  order by kind, spent desc, category_name;
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
  from tags tg
  join transaction_tags tt on tt.tag_id = tg.id
  join transactions t on t.id = tt.transaction_id
  where t.excluded_from_analysis = false
    and t.amount < 0
    and t.occurred_on >= date_trunc('month', p_month)::date
    and t.occurred_on <  (date_trunc('month', p_month) + interval '1 month')::date
    and (p_account_id is null or t.account_id = p_account_id)
  group by tg.id, tg.name, tg.color
  order by 4 desc, tg.name;
$$;


-- So um utilizador autenticado pode invocar as funcoes. O RLS ja protegia os
-- dados, mas nao ha razao para as deixar expostas ao role anonimo.
revoke all on function public.rpc_account_balances() from public, anon;
revoke all on function public.rpc_month_summary(date, uuid) from public, anon;
revoke all on function public.rpc_category_spend(date, uuid) from public, anon;
revoke all on function public.rpc_tag_spend(date, uuid) from public, anon;

grant execute on function public.rpc_account_balances() to authenticated;
grant execute on function public.rpc_month_summary(date, uuid) to authenticated;
grant execute on function public.rpc_category_spend(date, uuid) to authenticated;
grant execute on function public.rpc_tag_spend(date, uuid) to authenticated;
