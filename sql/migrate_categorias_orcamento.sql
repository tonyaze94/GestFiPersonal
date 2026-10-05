-- =====================================================================
-- Categorias, orcamentos e movimentos coerentes entre si.
--
-- - Todas as categorias (saida e entrada) tem orcamento: ao criar uma
--   categoria nasce o orcamento recorrente agregado a 0, que depois se
--   altera. Por isso o valor pode ser 0.
-- - Uma categoria de entrada tambem pode ter movimentos negativos (e uma
--   de saida positivos): o valor do mes e a soma com sinal, orientada pelo
--   tipo da categoria, sem abs().
-- - Subcategoria: um so nivel e o mesmo tipo da mae. Apagar a mae deixa as
--   filhas como categorias de topo, em vez de falhar na chave estrangeira.
--
-- Idempotente: pode correr-se mais de uma vez.
-- =====================================================================

-- --- Orcamento a 0 e para qualquer tipo de categoria ------------------

alter table budgets drop constraint if exists budgets_amount_check;
alter table budgets add constraint budgets_amount_check check (amount >= 0);

drop trigger if exists trg_budgets_categoria_despesa on budgets;
drop function if exists fn_budgets_categoria_deve_ser_despesa();


-- --- Categoria-mae: apagar nao falha, e o tipo bate certo --------------

alter table categories drop constraint if exists categories_parent_id_fkey;
alter table categories add constraint categories_parent_id_fkey
  foreign key (parent_id) references categories(id) on delete set null;

create or replace function public.fn_categories_valida_mae() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Uma categoria nao pode ser mae de si propria.';
    end if;
    if not exists (select 1 from categories p
                   where p.id = new.parent_id and p.kind = new.kind and p.parent_id is null) then
      raise exception 'A categoria-mae tem de ser do mesmo tipo e nao pode ser ela propria uma subcategoria.';
    end if;
    if exists (select 1 from categories f where f.parent_id = new.id) then
      raise exception 'Uma categoria com subcategorias nao pode passar a subcategoria.';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.kind <> old.kind
     and exists (select 1 from categories f where f.parent_id = new.id) then
    raise exception 'Mude primeiro o tipo das subcategorias, ou retire-as desta categoria.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_categories_valida_mae on categories;
create trigger trg_categories_valida_mae
  before insert or update on categories
  for each row execute function fn_categories_valida_mae();


-- --- Cada categoria nasce com orcamento a 0 ----------------------------

create or replace function public.fn_categories_orcamento_inicial() returns trigger
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

drop trigger if exists trg_categories_orcamento_inicial on categories;
create trigger trg_categories_orcamento_inicial
  after insert on categories
  for each row execute function fn_categories_orcamento_inicial();

-- categorias que ja existiam e ainda nao tinham orcamento recorrente agregado
insert into budgets (user_id, category_id, account_id, month, amount)
select c.user_id, c.id, null, null, 0
from categories c
where not exists (select 1 from budgets b
                  where b.category_id = c.id and b.account_id is null and b.month is null);


-- --- Valor do mes por categoria, com sinal -----------------------------
--
-- spent e o valor no sentido da categoria: numa de saida e o que saiu
-- (negativo se entrou mais do que saiu), numa de entrada e o que entrou
-- (negativo se saiu mais do que entrou).

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
           case when c.kind = 'despesa' then -coalesce(m.total, 0)
                else coalesce(m.total, 0) end as spent,
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
