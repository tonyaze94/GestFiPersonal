-- =====================================================================
-- Mes financeiro: o salario entra no ultimo dia util do mes, por isso
-- esse dia e os seguintes ate ao fim do mes contam ja para o mes seguinte.
--
-- Ex.: "outubro de 2026" vai de 30/09/2026 (ultimo dia util de setembro)
-- ate 29/10/2026 (vespera do ultimo dia util de outubro).
--
-- Dia util = segunda a sexta, fora dos feriados nacionais portugueses.
-- Idempotente: pode correr-se mais de uma vez.
-- =====================================================================

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


-- --- Agregacoes passam a usar o mes financeiro --------------------------

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

revoke all on function public.rpc_financial_month(date) from public, anon;
revoke all on function public.rpc_month_bounds(date) from public, anon;
grant execute on function public.rpc_financial_month(date) to authenticated;
grant execute on function public.rpc_month_bounds(date) to authenticated;
