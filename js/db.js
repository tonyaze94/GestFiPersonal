// -----------------------------------------------------------------------------
// Acesso aos dados. Camada fina sobre o cliente Supabase, para os ecras nao
// terem consultas espalhadas pelo meio do codigo de interface.
//
// O user_id nunca e enviado pelo cliente: a coluna tem "default auth.uid()" e o
// RLS valida-o do lado do servidor. Mesmo que este codigo tentasse forjar outro
// user_id, a politica "with check" rejeitava a operacao.
// -----------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';

/** Levanta o erro da Supabase para ser apanhado pelo ecra que chamou. */
function verificar({ data, error }) {
  if (error) throw error;
  return data;
}

// --- Tipos de conta ----------------------------------------------------------

export const TIPOS_CONTA = [
  { valor: 'conta_corrente',  etiqueta: 'Conta à ordem' },
  { valor: 'poupanca',        etiqueta: 'Poupança' },
  { valor: 'investimento',    etiqueta: 'Investimentos' },
  { valor: 'cartao_credito',  etiqueta: 'Cartão de crédito' },
  { valor: 'dinheiro',        etiqueta: 'Dinheiro' },
  { valor: 'outro',           etiqueta: 'Outro' },
];

export function etiquetaTipoConta(valor) {
  const tipo = TIPOS_CONTA.find((t) => t.valor === valor);
  return tipo ? tipo.etiqueta : valor;
}

// --- Contas ------------------------------------------------------------------

export async function listarContas() {
  return verificar(await supabase
    .from('accounts')
    .select('id, name, type, currency, initial_balance, created_at')
    .order('created_at', { ascending: true }));
}

export async function criarConta(conta) {
  return verificar(await supabase.from('accounts').insert(conta).select().single());
}

export async function actualizarConta(id, alteracoes) {
  return verificar(await supabase.from('accounts').update(alteracoes).eq('id', id).select().single());
}

export async function apagarConta(id) {
  return verificar(await supabase.from('accounts').delete().eq('id', id));
}

/** Quantos movimentos existem numa conta -- para avisar antes de a apagar. */
export async function contarMovimentosDaConta(id) {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', id);
  if (error) throw error;
  return count ?? 0;
}

/** Insercao em lote das contas de partida, num unico pedido. */
export async function criarContasEmLote(contas) {
  return verificar(await supabase.from('accounts').insert(contas).select());
}

// --- Categorias --------------------------------------------------------------

// Uma categoria nao e de entrada nem de saida: o sinal de cada movimento e
// que decide (positivo entra na conta, negativo sai).

export async function listarCategorias() {
  return verificar(await supabase
    .from('categories')
    .select('id, name, color, icon, parent_id, created_at')
    .order('name', { ascending: true }));
}

export async function criarCategoria(categoria) {
  return verificar(await supabase.from('categories').insert(categoria).select().single());
}

export async function actualizarCategoria(id, alteracoes) {
  return verificar(await supabase.from('categories').update(alteracoes).eq('id', id).select().single());
}

export async function apagarCategoria(id) {
  return verificar(await supabase.from('categories').delete().eq('id', id));
}

/**
 * Insercao em lote das categorias de partida, num unico pedido.
 * ignoreDuplicates evita rebentar se algumas ja existirem: a restricao
 * unique (user_id, name) do esquema trata da deteccao.
 */
export async function criarCategoriasEmLote(categorias) {
  return verificar(await supabase
    .from('categories')
    .upsert(categorias, { onConflict: 'user_id,name', ignoreDuplicates: true })
    .select());
}

// --- Etiquetas ---------------------------------------------------------------

export async function listarEtiquetas() {
  return verificar(await supabase
    .from('tags')
    .select('id, name, color')
    .order('name', { ascending: true }));
}

export async function criarEtiqueta(etiqueta) {
  return verificar(await supabase.from('tags').insert(etiqueta).select().single());
}

export async function actualizarEtiqueta(id, alteracoes) {
  return verificar(await supabase.from('tags').update(alteracoes).eq('id', id).select().single());
}

export async function apagarEtiqueta(id) {
  return verificar(await supabase.from('tags').delete().eq('id', id));
}

// --- Agregacoes (funcoes do schema.sql) --------------------------------------

// As somas por conta, mes, categoria e etiqueta sao feitas em Postgres, nunca
// em JavaScript depois de trazer os movimentos todos. As funcoes sao "security
// invoker", por isso o RLS continua a aplicar-se dentro delas.

/** Saldo actual de cada conta: inicial + soma de todos os movimentos. */
export async function saldosPorConta() {
  return verificar(await supabase.rpc('rpc_account_balances'));
}

// O mes e financeiro, nao de calendario: comeca no ultimo dia util do mes
// anterior, quando entra o salario (regra e feriados em fn_month_bounds).

/** Mes financeiro (dia 1) a que uma data pertence. */
export async function mesFinanceiro(dia) {
  return verificar(await supabase.rpc('rpc_financial_month', { p_day: dia }));
}

/** Primeiro e ultimo dia (inclusivo) de um mes financeiro. */
export async function limitesDoMes(mes) {
  const linhas = verificar(await supabase.rpc('rpc_month_bounds', { p_month: mes }));
  return linhas[0];
}

/** Totais de entradas, saidas e saldo de um mes. */
export async function resumoDoMes(mes, conta = null) {
  const linhas = verificar(await supabase.rpc('rpc_month_summary', {
    p_month: mes, p_account_id: conta || null,
  }));
  return linhas[0] || { total_receitas: 0, total_despesas: 0, saldo: 0 };
}

/** Gasto do mes por categoria, ja com o orcamento em vigor ao lado. */
export async function gastoPorCategoria(mes, conta = null) {
  return verificar(await supabase.rpc('rpc_category_spend', {
    p_month: mes, p_account_id: conta || null,
  }));
}

/** Totais do mes por etiqueta. */
export async function gastoPorEtiqueta(mes, conta = null) {
  return verificar(await supabase.rpc('rpc_tag_spend', {
    p_month: mes, p_account_id: conta || null,
  }));
}

// --- Orcamentos --------------------------------------------------------------

export async function listarOrcamentos() {
  return verificar(await supabase
    .from('budgets')
    .select('id, category_id, account_id, month, amount,'
          + ' categories(id, name, color, icon), accounts(id, name)')
    .order('month', { ascending: true, nullsFirst: true }));
}

export async function criarOrcamento(orcamento) {
  return verificar(await supabase.from('budgets').insert(orcamento).select().single());
}

export async function actualizarOrcamento(id, alteracoes) {
  return verificar(await supabase.from('budgets').update(alteracoes).eq('id', id).select().single());
}

export async function apagarOrcamento(id) {
  return verificar(await supabase.from('budgets').delete().eq('id', id));
}

// --- Teto global mensal ------------------------------------------------------

// Limite para o total que sai no mes, independente dos orcamentos por
// categoria. month = NULL e o recorrente; uma linha com mes substitui-o so
// nesse mes (a mesma regra dos orcamentos).

export async function listarTetos() {
  return verificar(await supabase
    .from('budget_caps')
    .select('id, month, amount')
    .order('month', { ascending: true, nullsFirst: true }));
}

/** O teto em vigor num mes: o do proprio mes, senao o recorrente. */
export function tetoEmVigor(tetos, mes) {
  return tetos.find((t) => t.month === mes) || tetos.find((t) => t.month === null) || null;
}

/** Cria ou actualiza o teto do ambito indicado (mes = null -> recorrente). */
export async function definirTeto(tetos, mes, valor) {
  const existente = tetos.find((t) => t.month === mes);
  if (existente) {
    return verificar(await supabase.from('budget_caps').update({ amount: valor })
      .eq('id', existente.id).select().single());
  }
  return verificar(await supabase.from('budget_caps').insert({ month: mes, amount: valor })
    .select().single());
}

export async function apagarTeto(id) {
  return verificar(await supabase.from('budget_caps').delete().eq('id', id));
}

// --- Movimentos --------------------------------------------------------------

export const POR_PAGINA = 40;

/**
 * Listagem paginada e filtrada de movimentos.
 *
 * A paginacao usa range(), por isso nunca se traz a tabela inteira para o
 * cliente. As etiquetas de cada linha sao pedidas a parte, so para os ids da
 * pagina actual (ver etiquetasDeMovimentos), o que mantem esta consulta simples
 * e o segundo pedido limitado ao tamanho da pagina.
 *
 * @returns {{ movimentos: Array, total: number }}
 */
export async function listarMovimentos(filtros = {}) {
  const {
    pagina = 0, conta, categoria, etiqueta,
    de, ate, texto, estado = 'todos',
  } = filtros;

  const colunas = 'id, account_id, category_id, amount, description, occurred_on,'
                + ' excluded_from_analysis, excluded_reason, transfer_id,'
                + ' accounts(name), categories(id, name, color, icon)';

  // Filtrar por etiqueta obriga a juncao interna sobre a tabela de ligacao.
  const seleccao = etiqueta
    ? colunas + ', transaction_tags!inner(tag_id)'
    : colunas;

  let consulta = supabase
    .from('transactions')
    .select(seleccao, { count: 'exact' })
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (conta) consulta = consulta.eq('account_id', conta);
  if (categoria === 'sem') consulta = consulta.is('category_id', null);
  else if (categoria) consulta = consulta.eq('category_id', categoria);
  if (etiqueta) consulta = consulta.eq('transaction_tags.tag_id', etiqueta);
  if (de) consulta = consulta.gte('occurred_on', de);
  if (ate) consulta = consulta.lte('occurred_on', ate);
  if (texto) consulta = consulta.ilike('description', '%' + texto + '%');
  if (estado === 'visiveis') consulta = consulta.eq('excluded_from_analysis', false);
  else if (estado === 'ocultos') consulta = consulta.eq('excluded_from_analysis', true);

  const inicio = pagina * POR_PAGINA;
  const { data, error, count } = await consulta.range(inicio, inicio + POR_PAGINA - 1);
  if (error) throw error;

  return { movimentos: data ?? [], total: count ?? 0 };
}

/**
 * Etiquetas dos movimentos indicados, agrupadas por movimento.
 * @returns {Map<string, Array>}
 */
export async function etiquetasDeMovimentos(ids) {
  if (!ids.length) return new Map();

  const data = verificar(await supabase
    .from('transaction_tags')
    .select('transaction_id, tags(id, name, color)')
    .in('transaction_id', ids));

  const porMovimento = new Map();
  for (const linha of data) {
    if (!linha.tags) continue;
    const lista = porMovimento.get(linha.transaction_id) || [];
    lista.push(linha.tags);
    porMovimento.set(linha.transaction_id, lista);
  }
  return porMovimento;
}

/** Etiquetas associadas a um movimento, para preencher o formulario. */
export async function etiquetasDoMovimento(id) {
  const data = verificar(await supabase
    .from('transaction_tags')
    .select('tag_id')
    .eq('transaction_id', id));
  return data.map((l) => l.tag_id);
}

// Movimento entre contas: duas linhas, uma em cada conta, com valores
// simetricos e o mesmo transfer_id. Criam-se, alteram-se e apagam-se sempre
// juntas -- a gravacao e feita por rpc_save_transaction, numa so transaccao.

/**
 * Conta do outro lado de cada movimento entre contas da pagina.
 * @returns {Map<string, {account_id: string, name: string}>} por id do movimento
 */
export async function contrapartidasDeMovimentos(movimentos) {
  const transferencias = [...new Set(movimentos.map((m) => m.transfer_id).filter(Boolean))];
  if (!transferencias.length) return new Map();

  const data = verificar(await supabase
    .from('transactions')
    .select('id, transfer_id, account_id, accounts(name)')
    .in('transfer_id', transferencias));

  const porMovimento = new Map();
  for (const m of movimentos) {
    if (!m.transfer_id) continue;
    const outra = data.find((l) => l.transfer_id === m.transfer_id && l.id !== m.id);
    if (outra) porMovimento.set(m.id, { account_id: outra.account_id, name: outra.accounts?.name || '?' });
  }
  return porMovimento;
}

/**
 * Cria (id nulo) ou altera um movimento. Com contrapartida, a linha simetrica
 * na outra conta e criada ou acertada; sem ela, e apagada se existisse.
 */
export async function guardarMovimento(id, movimento, contrapartida, tagIds = []) {
  return verificar(await supabase.rpc('rpc_save_transaction', {
    p_id: id || null,
    p_account_id: movimento.account_id,
    p_amount: movimento.amount,
    p_occurred_on: movimento.occurred_on,
    p_category_id: movimento.category_id,
    p_description: movimento.description,
    p_excluded: movimento.excluded_from_analysis,
    p_excluded_reason: movimento.excluded_reason,
    p_counter_account_id: contrapartida || null,
    p_tag_ids: tagIds,
  }));
}

/** Apaga o movimento e, se for entre contas, a linha da outra conta. */
export async function apagarMovimento(movimento) {
  const consulta = supabase.from('transactions').delete();
  return verificar(await (movimento.transfer_id
    ? consulta.eq('transfer_id', movimento.transfer_id)
    : consulta.eq('id', movimento.id)));
}

/** Liga ou desliga "ocultar da análise" sem abrir o formulário (nas duas linhas, se for entre contas). */
export async function alternarOculto(movimento, oculto, motivo) {
  const consulta = supabase.from('transactions').update({
    excluded_from_analysis: oculto,
    excluded_reason: oculto ? (motivo || null) : null,
  });
  return verificar(await (movimento.transfer_id
    ? consulta.eq('transfer_id', movimento.transfer_id)
    : consulta.eq('id', movimento.id)));
}

// -----------------------------------------------------------------------------
// Ativos -- acompanhamento de investimentos partilhados com parceiros.
//
// Ao contrario das contas do dia-a-dia, aqui o dinheiro que entra e um custo
// e o que sai e receita (ver TIPOS_MOVIMENTO_ATIVO). Apagar um grupo ou um
// ativo apaga em cascata tudo o que depende dele (definido no schema), por
// isso essas duas funcoes sao so um DELETE -- nao ha logica de cascata aqui.
// -----------------------------------------------------------------------------

export const TIPOS_MOVIMENTO_ATIVO = [
  { valor: 'custo',   etiqueta: 'Custo' },
  { valor: 'receita', etiqueta: 'Receita' },
];

export const ESTADOS_ATIVO = [
  { valor: 'em_carteira', etiqueta: 'Em carteira' },
  { valor: 'vendido',     etiqueta: 'Vendido' },
];

// --- Grupos --------------------------------------------------------------

export async function listarGruposAtivos() {
  return verificar(await supabase.from('asset_groups').select('id, name, description, created_at')
    .order('name', { ascending: true }));
}

export async function criarGrupoAtivos(dados) {
  return verificar(await supabase.from('asset_groups').insert(dados).select().single());
}

export async function actualizarGrupoAtivos(id, dados) {
  return verificar(await supabase.from('asset_groups').update(dados).eq('id', id).select().single());
}

export async function apagarGrupoAtivos(id) {
  return verificar(await supabase.from('asset_groups').delete().eq('id', id));
}

// --- Parceiros -------------------------------------------------------------

export async function listarParceirosAtivos() {
  return verificar(await supabase.from('asset_partners').select('id, name, created_at')
    .order('name', { ascending: true }));
}

export async function criarParceiroAtivos(dados) {
  return verificar(await supabase.from('asset_partners').insert(dados).select().single());
}

export async function actualizarParceiroAtivos(id, dados) {
  return verificar(await supabase.from('asset_partners').update(dados).eq('id', id).select().single());
}

/** Ao contrario do grupo/ativo, apagar um parceiro nao e cascata no schema:
 * as divisoes que o referenciam sao removidas primeiro, para o movimento e
 * o ativo continuarem a existir sem esse parceiro. */
export async function apagarParceiroAtivos(id) {
  verificar(await supabase.from('asset_movement_partners').delete().eq('partner_id', id));
  verificar(await supabase.from('asset_partner_shares').delete().eq('partner_id', id));
  return verificar(await supabase.from('asset_partners').delete().eq('id', id));
}

// --- Categorias --------------------------------------------------------------

export async function listarCategoriasAtivos(tipo) {
  let consulta = supabase.from('asset_categories').select('id, name, kind, color, created_at')
    .order('name', { ascending: true });
  if (tipo) consulta = consulta.eq('kind', tipo);
  return verificar(await consulta);
}

export async function criarCategoriaAtivos(dados) {
  return verificar(await supabase.from('asset_categories').insert(dados).select().single());
}

export async function actualizarCategoriaAtivos(id, dados) {
  return verificar(await supabase.from('asset_categories').update(dados).eq('id', id).select().single());
}

/** Recusa apagar se houver movimentos a usar a categoria -- tal como nas categorias normais. */
export async function contarMovimentosDaCategoriaAtivos(id) {
  const { count, error } = await supabase.from('asset_movements')
    .select('id', { count: 'exact', head: true }).eq('category_id', id);
  if (error) throw error;
  return count ?? 0;
}

export async function apagarCategoriaAtivos(id) {
  return verificar(await supabase.from('asset_categories').delete().eq('id', id));
}

/** Devolve a categoria com este nome/tipo, criando-a se ainda nao existir
 * (usada na troca, que regista sempre uma categoria "Troca"). */
export async function obterOuCriarCategoriaAtivos(nome, tipo) {
  const { data } = await supabase.from('asset_categories').select('id')
    .eq('name', nome).eq('kind', tipo).limit(1).maybeSingle();
  if (data) return data.id;
  const nova = await criarCategoriaAtivos({ name: nome, kind: tipo });
  return nova.id;
}

// --- Ativos ------------------------------------------------------------------

export async function listarAtivos(grupoId) {
  return verificar(await supabase.from('assets')
    .select('id, group_id, name, description, status, acquired_on, sold_on,'
          + ' expected_sale_value, profit_pct, sale_reason, created_at')
    .eq('group_id', grupoId)
    .order('status', { ascending: true })
    .order('acquired_on', { ascending: true }));
}

/** Todos os ativos, para as agregacoes do resumo (sem filtrar por grupo). */
export async function listarTodosAtivos() {
  return verificar(await supabase.from('assets')
    .select('id, status, group_id, expected_sale_value, profit_pct'));
}

export async function obterAtivo(id) {
  return verificar(await supabase.from('assets').select('*').eq('id', id).single());
}

export async function criarAtivo(dados) {
  return verificar(await supabase.from('assets').insert(dados).select().single());
}

export async function actualizarAtivo(id, dados) {
  return verificar(await supabase.from('assets').update(dados).eq('id', id).select().single());
}

/** Apaga o ativo e, em cascata (definido no schema), os seus movimentos,
 * divisoes de movimento e percentagens de parceiro. */
export async function apagarAtivo(id) {
  return verificar(await supabase.from('assets').delete().eq('id', id));
}

// --- Percentagens de parceiro por ativo --------------------------------------

export async function listarPartesAtivo(ativoId) {
  const linhas = verificar(await supabase.from('asset_partner_shares')
    .select('partner_id, profit_pct, asset_partners(name)').eq('asset_id', ativoId));
  return linhas.map((l) => ({ partner_id: l.partner_id, profit_pct: Number(l.profit_pct),
    name: l.asset_partners ? l.asset_partners.name : '?' }));
}

/** Substitui por completo a divisao de lucro do ativo entre parceiros. */
export async function definirPartesAtivo(ativoId, partes) {
  verificar(await supabase.from('asset_partner_shares').delete().eq('asset_id', ativoId));
  const limpas = partes.filter((p) => p.partner_id)
    .map((p) => ({ asset_id: ativoId, partner_id: p.partner_id, profit_pct: p.profit_pct }));
  if (limpas.length) verificar(await supabase.from('asset_partner_shares').insert(limpas));
}

// --- Movimentos de ativos -----------------------------------------------------

export async function listarMovimentosAtivo(ativoId) {
  return verificar(await supabase.from('asset_movements')
    .select('id, category_id, kind, amount, own_amount, occurred_on, description,'
          + ' asset_categories(name, color),'
          + ' asset_movement_partners(id, partner_id, amount, asset_partners(name))')
    .eq('asset_id', ativoId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false }));
}

/** Todos os movimentos de todos os ativos, para o resumo e a analise. */
export async function listarTodosMovimentosAtivos() {
  return verificar(await supabase.from('asset_movements')
    .select('asset_id, kind, amount, own_amount, occurred_on, assets(group_id)'));
}

export async function criarMovimentoAtivo(dados) {
  return verificar(await supabase.from('asset_movements').insert(dados).select().single());
}

export async function actualizarMovimentoAtivo(id, dados) {
  return verificar(await supabase.from('asset_movements').update(dados).eq('id', id).select().single());
}

export async function apagarMovimentoAtivo(id) {
  return verificar(await supabase.from('asset_movements').delete().eq('id', id));
}

/** Substitui por completo a divisao de um movimento entre parceiros. */
export async function definirParceirosMovimento(movimentoId, partes) {
  verificar(await supabase.from('asset_movement_partners').delete().eq('movement_id', movimentoId));
  const limpas = partes.filter((p) => p.amount > 0.009)
    .map((p) => ({ movement_id: movimentoId, partner_id: p.partner_id, amount: p.amount }));
  if (limpas.length) verificar(await supabase.from('asset_movement_partners').insert(limpas));
}
