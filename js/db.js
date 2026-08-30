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

// --- Tipos de categoria ------------------------------------------------------

// A base de dados guarda 'despesa' e 'receita' (a restricao check do esquema
// exige esses valores), mas a interface fala sempre em Saida e Entrada.
// Numa conta de investimentos o dinheiro que entra e um custo e o que sai e
// lucro, por isso "despesa" e "receita" seriam enganadores no ecra.
export const TIPOS_CATEGORIA = [
  { valor: 'despesa', etiqueta: 'Saída' },
  { valor: 'receita', etiqueta: 'Entrada' },
];

/** 'despesa' -> 'Saída' */
export function etiquetaTipoCategoria(kind) {
  const tipo = TIPOS_CATEGORIA.find((t) => t.valor === kind);
  return tipo ? tipo.etiqueta : kind;
}

/** 'despesa' -> 'Saídas' */
export function etiquetaTipoCategoriaPlural(kind) {
  return kind === 'receita' ? 'Entradas' : 'Saídas';
}

/** 'despesa' -> 'saída' (para usar dentro de uma frase) */
export function etiquetaTipoCategoriaMinuscula(kind) {
  return kind === 'receita' ? 'entrada' : 'saída';
}

// --- Categorias --------------------------------------------------------------

export async function listarCategorias(tipo) {
  let consulta = supabase
    .from('categories')
    .select('id, name, kind, color, icon, parent_id, created_at')
    .order('name', { ascending: true });
  if (tipo) consulta = consulta.eq('kind', tipo);
  return verificar(await consulta);
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
 * unique (user_id, name, kind) do esquema trata da deteccao.
 */
export async function criarCategoriasEmLote(categorias) {
  return verificar(await supabase
    .from('categories')
    .upsert(categorias, { onConflict: 'user_id,name,kind', ignoreDuplicates: true })
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
          + ' categories(id, name, color, kind), accounts(id, name)')
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
                + ' excluded_from_analysis, excluded_reason,'
                + ' accounts(name), categories(id, name, color, kind)';

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

/** Substitui as etiquetas de um movimento, sempre em lote. */
async function definirEtiquetas(transactionId, tagIds) {
  verificar(await supabase.from('transaction_tags').delete().eq('transaction_id', transactionId));
  if (!tagIds.length) return;
  verificar(await supabase.from('transaction_tags').insert(
    tagIds.map((tag_id) => ({ transaction_id: transactionId, tag_id })),
  ));
}

export async function criarMovimento(movimento, tagIds = []) {
  const criado = verificar(await supabase.from('transactions').insert(movimento).select().single());
  if (tagIds.length) await definirEtiquetas(criado.id, tagIds);
  return criado;
}

export async function actualizarMovimento(id, alteracoes, tagIds = null) {
  const actualizado = verificar(await supabase
    .from('transactions')
    .update({ ...alteracoes, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single());
  if (tagIds) await definirEtiquetas(id, tagIds);
  return actualizado;
}

export async function apagarMovimento(id) {
  return verificar(await supabase.from('transactions').delete().eq('id', id));
}

/** Liga ou desliga "ocultar da análise" sem abrir o formulário completo. */
export async function alternarOculto(id, oculto, motivo) {
  return actualizarMovimento(id, {
    excluded_from_analysis: oculto,
    excluded_reason: oculto ? (motivo || null) : null,
  });
}
