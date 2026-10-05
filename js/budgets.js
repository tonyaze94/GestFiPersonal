// -----------------------------------------------------------------------------
// Ecra "Orcamento": quanto quero que saia por categoria, em cada mes.
//
// Um orcamento com month = NULL e recorrente: aplica-se a todos os meses sem
// ter de ser recriado. Um orcamento com um mes concreto e uma excepcao que
// substitui o recorrente so nesse mes. A funcao rpc_category_spend do
// schema.sql ja devolve o valor em vigor; aqui usa-se a lista completa apenas
// para saber qual das duas linhas se esta a editar.
//
// O teto global mensal (budget_caps) e outro limite, para o total do mes em
// todas as contas: nao depende da soma dos orcamentos por categoria.
//
// Todas as categorias, de saida e de entrada, estao no orcamento: cada uma
// nasce com o orcamento recorrente agregado a 0 (trigger no esquema), que
// depois se altera. Esse orcamento de base nao se apaga -- so as excepcoes
// de um mes ou de uma conta.
// -----------------------------------------------------------------------------
import {
  listarContas, listarCategorias, listarOrcamentos, gastoPorCategoria,
  criarOrcamento, actualizarOrcamento, apagarOrcamento,
  resumoDoMes, listarTetos, tetoEmVigor, definirTeto,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio, chip } from './ui.js';
import { dialogoFormulario, dialogoConfirmar } from './modal.js';
import { formatMoney, rotuloMes } from './format.js';
import { contexto, prepararContexto, selectorContexto, barraOrcamento } from './dashboard.js';

let contas = [];
let categorias = [];

/**
 * Qual dos orcamentos se aplica ao mes e conta em analise.
 * A excepcao do mes ganha ao recorrente -- a mesma regra do SQL.
 */
function orcamentoEmVigor(orcamentos, categoryId) {
  const doAmbito = orcamentos.filter((o) => o.category_id === categoryId
    && (contexto.conta ? o.account_id === contexto.conta : o.account_id === null));

  return doAmbito.find((o) => o.month === contexto.mes)
      || doAmbito.find((o) => o.month === null)
      || null;
}

// -----------------------------------------------------------------------------
// Formulario
// -----------------------------------------------------------------------------

function camposOrcamento(orcamento, categoria) {
  return [
    { nome: 'amount', etiqueta: 'Valor mensal', tipo: 'number',
      valor: orcamento ? Number(orcamento.amount).toFixed(2) : '0.00', obrigatorio: true,
      ajuda: categoria.kind === 'receita'
        ? 'Quanto prevê que entre nesta categoria por mês. Pode ser 0.'
        : 'Quanto quer que saia, no máximo, nesta categoria por mês. Pode ser 0.' },
    { nome: 'ambito', etiqueta: 'Aplica-se a', tipo: 'seleccao',
      valor: orcamento && orcamento.month ? 'mes' : 'sempre',
      opcoes: [
        { valor: 'sempre', etiqueta: 'Todos os meses (recorrente)' },
        { valor: 'mes', etiqueta: 'Só ' + rotuloMes(contexto.mes) },
      ],
      ajuda: 'Um valor só para este mês substitui o recorrente, sem o apagar.' },
  ];
}

function normalizar(valores, categoryId) {
  const bruto = Number(String(valores.amount).replace(',', '.'));
  return {
    category_id: categoryId,
    account_id: contexto.conta || null,
    month: valores.ambito === 'mes' ? contexto.mes : null,
    amount: Math.abs(bruto),
  };
}

function valorInvalido(valores, aceitaZero) {
  const bruto = Number(String(valores.amount).replace(',', '.'));
  if (!Number.isFinite(bruto) || (aceitaZero ? bruto < 0 : bruto <= 0)) {
    return aceitaZero ? 'O orçamento tem de ser zero ou um valor positivo.'
                      : 'O teto tem de ser um valor maior do que zero.';
  }
  return null;
}

/** O orcamento recorrente agregado de cada categoria: existe sempre e nao se apaga. */
function eOrcamentoBase(orcamento) {
  return orcamento.month === null && orcamento.account_id === null;
}

async function definirOrcamento(categoria, orcamento, todos, recarregar) {
  const valores = await dialogoFormulario({
    titulo: (orcamento ? 'Editar orçamento' : 'Novo orçamento') + ' · ' + categoria.name,
    campos: camposOrcamento(orcamento, categoria),
    confirmar: 'Guardar',
  });
  if (!valores) return;

  const erro = valorInvalido(valores, true);
  if (erro) { avisar(erro, 'erro'); return; }

  const dados = normalizar(valores, categoria.id);

  try {
    // Mudar o âmbito (recorrente <-> só este mês) muda a linha de destino.
    // Procura-se a linha que ocupa exactamente esse âmbito: se já existir,
    // actualiza-se; caso contrário cria-se. Sem isto, passar de "só este mês"
    // para "recorrente" com um recorrente já criado dava erro de duplicado,
    // por causa do índice único do esquema.
    const existente = todos.find((o) => o.category_id === dados.category_id
      && o.month === dados.month
      && (o.account_id || null) === dados.account_id);

    if (existente) {
      await actualizarOrcamento(existente.id, { amount: dados.amount });
    } else {
      await criarOrcamento(dados);
    }
    avisar('Orçamento guardado.', 'sucesso');
    await recarregar();
  } catch (e) {
    avisar(traduzErro(e), 'erro');
  }
}

async function removerOrcamento(orcamento, nomeCategoria, recarregar) {
  const ambito = orcamento.month
    ? 'só de ' + rotuloMes(orcamento.month)
    : 'recorrente (todos os meses)';

  const confirmado = await dialogoConfirmar({
    titulo: 'Apagar orçamento',
    mensagem: `Apagar o orçamento ${ambito} de "${nomeCategoria}"? `
            + 'Os movimentos não são afetados.',
    confirmar: 'Apagar',
  });
  if (!confirmado) return;

  try {
    await apagarOrcamento(orcamento.id);
    avisar('Orçamento apagado.', 'sucesso');
    await recarregar();
  } catch (e) {
    avisar(traduzErro(e), 'erro');
  }
}

// -----------------------------------------------------------------------------
// Teto global mensal
// -----------------------------------------------------------------------------

async function editarTeto(tetos, recarregar) {
  const actual = tetoEmVigor(tetos, contexto.mes);
  const valores = await dialogoFormulario({
    titulo: actual ? 'Editar teto global' : 'Definir teto global',
    campos: [
      { nome: 'amount', etiqueta: 'Máximo a sair por mês', tipo: 'number', obrigatorio: true,
        valor: actual ? Number(actual.amount).toFixed(2) : '',
        ajuda: 'Soma de todas as saídas do mês, em todas as contas, independente dos '
             + 'orçamentos por categoria.' },
      { nome: 'ambito', etiqueta: 'Aplica-se a', tipo: 'seleccao',
        valor: actual && actual.month ? 'mes' : 'sempre',
        opcoes: [
          { valor: 'sempre', etiqueta: 'Todos os meses (recorrente)' },
          { valor: 'mes', etiqueta: 'Só ' + rotuloMes(contexto.mes) },
        ],
        ajuda: 'Um valor só para este mês substitui o recorrente, sem o apagar.' },
    ],
    confirmar: 'Guardar',
  });
  if (!valores) return;

  const erro = valorInvalido(valores, false);
  if (erro) { avisar(erro, 'erro'); return; }

  try {
    const valor = Math.abs(Number(String(valores.amount).replace(',', '.')));
    await definirTeto(tetos, valores.ambito === 'mes' ? contexto.mes : null, valor);
    avisar('Teto global guardado.', 'sucesso');
    await recarregar();
  } catch (e) {
    avisar(traduzErro(e), 'erro');
  }
}

/**
 * Progresso do mes face ao teto global. E sempre o total de todas as contas,
 * mesmo com uma conta escolhida no selector: o teto e do mes, nao da conta.
 * A soma dos orcamentos por categoria aparece so como referencia -- pode
 * ficar acima ou abaixo do teto, e nenhum dos dois manda no outro.
 */
function cartaoTeto({ teto, gastoTotal, somaCategorias }, accoes) {
  const definido = teto != null;
  const valor = definido ? Number(teto.amount) : null;
  const excede = definido && gastoTotal > valor;
  const restante = definido ? valor - gastoTotal : null;

  return el('div', { class: 'cartao teto' }, [
    el('h2', { class: 'cartao__titulo', text: 'Gasto global do mês' }),
    el('div', { class: 'teto__topo' }, [
      definido && teto.month
        ? el('span', { class: 'marca', text: 'só este mês' })
        : (definido ? el('span', { class: 'marca marca--fraca', text: 'recorrente' }) : null),
      el('span', { class: 'teto__valores' }, [
        el('span', { class: 'valor teto__gasto', text: formatMoney(gastoTotal) }),
        el('span', { class: 'categoria__orcamento' + (excede ? ' categoria__orcamento--excede' : ''),
          text: definido ? 'de ' + formatMoney(valor) : 'sem teto definido' }),
      ]),
    ]),
    definido ? barraOrcamento(gastoTotal, valor) : null,
    definido
      ? el('p', { class: 'orcamento__nota' + (excede ? ' orcamento__nota--excede' : ''),
          text: excede
            ? 'Teto ultrapassado em ' + formatMoney(Math.abs(restante))
            : 'Faltam ' + formatMoney(restante) + ' para o teto' })
      : null,
    el('p', { class: 'orcamento__nota',
      text: 'Todas as contas. Soma dos orçamentos por categoria: ' + formatMoney(somaCategorias) + '.' }),
    el('div', { class: 'orcamento__accoes' }, [
      el('button', { class: 'btn btn--pequeno', type: 'button',
        text: definido ? 'Editar teto' : 'Definir teto', onclick: accoes.editarTeto }),
    ]),
  ]);
}

// -----------------------------------------------------------------------------
// Desenho
// -----------------------------------------------------------------------------

/** Numa saida, o que falta para o limite; numa entrada, o que falta para o previsto. */
function notaOrcamento(entrada, valor, gasto) {
  const restante = valor - gasto;
  if (entrada) {
    if (restante > 0) return { texto: 'Faltam ' + formatMoney(restante) + ' para o previsto', excede: false };
    return { texto: restante < 0 ? 'Acima do previsto em ' + formatMoney(-restante) : 'Previsto atingido',
      excede: false };
  }
  return restante < 0
    ? { texto: 'Ultrapassado em ' + formatMoney(-restante), excede: true }
    : { texto: 'Faltam ' + formatMoney(restante), excede: false };
}

function linhaOrcamento(item, accoes) {
  const { categoria, gasto, orcamento } = item;
  const definido = orcamento != null;
  const valor = definido ? Number(orcamento.amount) : null;
  const nota = definido ? notaOrcamento(categoria.kind === 'receita', valor, gasto) : null;
  const excede = Boolean(nota && nota.excede);

  return el('div', { class: 'orcamento' }, [
    el('div', { class: 'orcamento__topo' }, [
      chip(categoria.name, categoria.color || '#6B7280', categoria.icon),
      definido && orcamento.month
        ? el('span', { class: 'marca', text: 'só este mês' })
        : (definido ? el('span', { class: 'marca marca--fraca', text: 'recorrente' }) : null),
      el('span', { class: 'orcamento__valores' }, [
        el('span', { class: 'valor', text: formatMoney(gasto) }),
        definido
          ? el('span', { class: 'categoria__orcamento' + (excede ? ' categoria__orcamento--excede' : ''),
              text: 'de ' + formatMoney(valor) })
          : el('span', { class: 'categoria__orcamento', text: 'sem orçamento nesta conta' }),
      ]),
    ]),

    definido ? barraOrcamento(gasto, valor) : null,

    nota
      ? el('p', { class: 'orcamento__nota' + (excede ? ' orcamento__nota--excede' : ''),
          text: nota.texto })
      : null,

    el('div', { class: 'orcamento__accoes' }, [
      el('button', { class: 'btn btn--pequeno', type: 'button',
        text: definido ? 'Editar' : 'Definir orçamento',
        onclick: () => accoes.definir(item) }),
      definido && !eOrcamentoBase(orcamento)
        ? el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar',
            onclick: () => accoes.apagar(item) })
        : null,
    ]),
  ]);
}

export function desenharOrcamentos({ itens, contas, global }, accoes = {}) {
  const fragmento = document.createDocumentFragment();

  fragmento.append(
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Orçamento' }),
    ]),
    selectorContexto(contas, accoes.recarregar),
    cartaoTeto(global, accoes),
  );

  if (!itens.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio('Ainda não há categorias para orçamentar.',
        'Criar categorias', () => { location.hash = '#/definicoes-orcamento'; }),
    ]));
    return fragmento;
  }

  fragmento.append(el('p', { class: 'contexto__nota',
    text: contexto.conta
      ? 'A ver o orçamento específico desta conta.'
      : 'A ver o orçamento agregado de todas as contas.' }));

  for (const [kind, titulo] of [['despesa', 'Saídas'], ['receita', 'Entradas']]) {
    const doTipo = itens.filter((i) => i.categoria.kind === kind);
    if (!doTipo.length) continue;
    fragmento.append(el('div', { class: 'cartao' }, [
      el('h2', { class: 'cartao__titulo', text: titulo }),
      el('div', {}, doTipo.map((i) => linhaOrcamento(i, accoes))),
    ]));
  }

  return fragmento;
}

// -----------------------------------------------------------------------------
// Ligacao ao ecra
// -----------------------------------------------------------------------------

export async function montarOrcamentos(alvo) {
  [contas, categorias] = await Promise.all([
    listarContas(),
    listarCategorias(),
  ]);

  async function recarregar() {
    await prepararContexto();
    const [orcamentos, gastos, tetos, resumoGlobal] = await Promise.all([
      listarOrcamentos(),
      gastoPorCategoria(contexto.mes, contexto.conta),
      listarTetos(),
      resumoDoMes(contexto.mes, null),
    ]);

    const gastoPorId = new Map(gastos.map((g) => [g.category_id, Number(g.spent) || 0]));

    const itens = categorias.map((categoria) => ({
      categoria,
      gasto: gastoPorId.get(categoria.id) || 0,
      orcamento: orcamentoEmVigor(orcamentos, categoria.id),
    }));

    // Primeiro os que estão mais perto do limite; com orçamento 0, qualquer
    // valor já o ultrapassa.
    const razao = (i) => {
      if (!i.orcamento) return -1;
      const valor = Number(i.orcamento.amount);
      if (valor > 0) return i.gasto / valor;
      return i.gasto > 0 ? Infinity : 0;
    };
    itens.sort((a, b) => (razao(b) - razao(a)) || (b.gasto - a.gasto));

    // A soma de referencia e a dos orcamentos agregados (todas as contas), para
    // comparar com o teto na mesma base, seja qual for a conta escolhida.
    const somaCategorias = categorias.filter((c) => c.kind === 'despesa').reduce((s, c) => {
      const o = orcamentos.filter((x) => x.category_id === c.id && x.account_id === null);
      const vigor = o.find((x) => x.month === contexto.mes) || o.find((x) => x.month === null);
      return s + (vigor ? Number(vigor.amount) : 0);
    }, 0);

    const global = {
      teto: tetoEmVigor(tetos, contexto.mes),
      gastoTotal: Number(resumoGlobal.total_despesas) || 0,
      somaCategorias,
    };

    alvo.replaceChildren(desenharOrcamentos({ itens, contas, global }, {
      recarregar,
      editarTeto: () => editarTeto(tetos, recarregar),
      definir: (item) => definirOrcamento(item.categoria, item.orcamento, orcamentos, recarregar),
      apagar: (item) => removerOrcamento(item.orcamento, item.categoria.name, recarregar),
    }));
  }

  await recarregar();
}
