-- =====================================================================
-- Categorias sem tipo e movimentos entre contas.
--
-- - Uma categoria ja nao e de entrada nem de saida: o sinal de cada
--   movimento e que decide (positivo entra na conta, negativo sai).
--   Categorias com o mesmo nome nos dois tipos sao fundidas numa so.
-- - Movimento entre contas: duas linhas em transactions, uma em cada
--   conta, com valores simetricos e o mesmo transfer_id. Criam-se e
--   alteram-se sempre juntas, por rpc_save_transaction.
--
-- Idempotente: pode correr-se mais de uma vez.
-- =====================================================================

-- --- Categorias sem tipo ---------------------------------------------

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

-- Fundir categorias com o mesmo nome: fica a que tem mais movimentos (e,
-- em empate, a mais antiga); movimentos e subcategorias da outra passam
-- para ela, e os orcamentos da outra saem em cascata.
do $$
declare
  r record;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'categories' and column_name = 'kind') then
    return;
  end if;

  for r in
    with contagem as (
      select c.id, c.user_id, c.name, c.created_at,
             (select count(*) from transactions t where t.category_id = c.id) as n
      from categories c
    ), ordenadas as (
      select *, first_value(id) over (partition by user_id, name order by n desc, created_at) as fica
      from contagem
    )
    select id, fica from ordenadas where id <> fica
  loop
    update transactions set category_id = r.fica where category_id = r.id;
    update categories set parent_id = r.fica where parent_id = r.id;
    delete from categories where id = r.id;
  end loop;
end;
$$;

alter table categories drop constraint if exists categories_user_id_name_kind_key;
alter table categories drop constraint if exists categories_kind_check;
alter table categories drop column if exists kind;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_user_id_name_key') then
    alter table categories add constraint categories_user_id_name_key unique (user_id, name);
  end if;
end;
$$;

-- spent: o que saiu em termos liquidos (positivo = saiu, negativo = entrou).
drop function if exists public.rpc_category_spend(date, uuid);

create function public.rpc_category_spend(
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

revoke all on function public.rpc_category_spend(date, uuid) from public, anon;
grant execute on function public.rpc_category_spend(date, uuid) to authenticated;


-- --- Movimentos entre contas -----------------------------------------

alter table transactions add column if not exists transfer_id uuid;

create index if not exists idx_transactions_transfer on transactions (transfer_id)
  where transfer_id is not null;

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

revoke all on function public.rpc_save_transaction(uuid, uuid, numeric, date, uuid, text, boolean, text, uuid, uuid[]) from public, anon;
grant execute on function public.rpc_save_transaction(uuid, uuid, numeric, date, uuid, text, boolean, text, uuid, uuid[]) to authenticated;
