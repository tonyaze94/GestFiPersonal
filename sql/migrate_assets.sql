-- Migracao de dados do projeto Supabase "Ativos" para as tabelas asset_*
-- desta base. CSV_DIR e USER_ID sao substituidos pelo caller antes de correr.
-- Corre tudo numa unica sessao/transaccao (os staging e mapas sao TEMP).

create temp table stg_grupos(id bigint, nome text, descricao text, criado_em timestamptz);
create temp table stg_categorias(id bigint, nome text, tipo text, criado_em timestamptz);
create temp table stg_parceiros(id bigint, nome text, criado_em timestamptz);
create temp table stg_ativos(id bigint, grupo_id bigint, nome text, descricao text, estado text, data_aquisicao date, data_venda date, valor_previsto_venda numeric, percentagem_lucro numeric, motivo_venda text, criado_em timestamptz);
create temp table stg_ativo_parceiros(id bigint, ativo_id bigint, parceiro_id bigint, percentagem_lucro numeric, criado_em timestamptz);
create temp table stg_movimentos(id bigint, ativo_id bigint, categoria_id bigint, tipo text, valor numeric, data date, descricao text, criado_em timestamptz, valor_proprio numeric);
create temp table stg_movimento_parceiros(id bigint, movimento_id bigint, parceiro_id bigint, valor numeric, criado_em timestamptz);

\copy stg_grupos from 'CSV_DIR\grupos.csv' csv header
\copy stg_categorias from 'CSV_DIR\categorias.csv' csv header
\copy stg_parceiros from 'CSV_DIR\parceiros.csv' csv header
\copy stg_ativos from 'CSV_DIR\ativos.csv' csv header
\copy stg_ativo_parceiros from 'CSV_DIR\ativo_parceiros.csv' csv header
\copy stg_movimentos from 'CSV_DIR\movimentos.csv' csv header
\copy stg_movimento_parceiros from 'CSV_DIR\movimento_parceiros.csv' csv header

begin;

-- mapas de id antigo (bigint) -> id novo (uuid), gerados antes de inserir
-- para que o mesmo uuid fique tanto no mapa como na linha final
create temp table map_grupos as select id as old_id, gen_random_uuid() as new_id from stg_grupos;
create temp table map_categorias as select id as old_id, gen_random_uuid() as new_id from stg_categorias;
create temp table map_parceiros as select id as old_id, gen_random_uuid() as new_id from stg_parceiros;
create temp table map_ativos as select id as old_id, gen_random_uuid() as new_id from stg_ativos;
create temp table map_movimentos as select id as old_id, gen_random_uuid() as new_id from stg_movimentos;

insert into asset_groups (id, user_id, name, description, created_at)
select m.new_id, 'USER_ID', g.nome, g.descricao, g.criado_em
from stg_grupos g join map_grupos m on m.old_id = g.id;

insert into asset_categories (id, user_id, name, kind, created_at)
select m.new_id, 'USER_ID', c.nome, c.tipo, c.criado_em
from stg_categorias c join map_categorias m on m.old_id = c.id;

insert into asset_partners (id, user_id, name, created_at)
select m.new_id, 'USER_ID', p.nome, p.criado_em
from stg_parceiros p join map_parceiros m on m.old_id = p.id;

insert into assets (id, user_id, group_id, name, description, status, acquired_on, sold_on, expected_sale_value, profit_pct, sale_reason, created_at)
select ma.new_id, 'USER_ID', mg.new_id, a.nome, a.descricao, a.estado, a.data_aquisicao, a.data_venda, a.valor_previsto_venda, a.percentagem_lucro, a.motivo_venda, a.criado_em
from stg_ativos a
join map_ativos ma on ma.old_id = a.id
join map_grupos mg on mg.old_id = a.grupo_id;

insert into asset_partner_shares (id, user_id, asset_id, partner_id, profit_pct, created_at)
select gen_random_uuid(), 'USER_ID', ma.new_id, mp.new_id, ap.percentagem_lucro, ap.criado_em
from stg_ativo_parceiros ap
join map_ativos ma on ma.old_id = ap.ativo_id
join map_parceiros mp on mp.old_id = ap.parceiro_id;

insert into asset_movements (id, user_id, asset_id, category_id, kind, amount, own_amount, occurred_on, description, created_at)
select mm.new_id, 'USER_ID', ma.new_id, mc.new_id, mv.tipo, mv.valor, mv.valor_proprio, mv.data, mv.descricao, mv.criado_em
from stg_movimentos mv
join map_movimentos mm on mm.old_id = mv.id
join map_ativos ma on ma.old_id = mv.ativo_id
join map_categorias mc on mc.old_id = mv.categoria_id;

insert into asset_movement_partners (id, user_id, movement_id, partner_id, amount, created_at)
select gen_random_uuid(), 'USER_ID', mm.new_id, mp.new_id, mvp.valor, mvp.criado_em
from stg_movimento_parceiros mvp
join map_movimentos mm on mm.old_id = mvp.movimento_id
join map_parceiros mp on mp.old_id = mvp.parceiro_id;

select 'asset_groups' t, count(*) from asset_groups
union all select 'asset_categories', count(*) from asset_categories
union all select 'asset_partners', count(*) from asset_partners
union all select 'assets', count(*) from assets
union all select 'asset_partner_shares', count(*) from asset_partner_shares
union all select 'asset_movements', count(*) from asset_movements
union all select 'asset_movement_partners', count(*) from asset_movement_partners;

commit;
