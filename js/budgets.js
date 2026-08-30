// -----------------------------------------------------------------------------
// Ecra "Orcamento": quanto quero que saia por categoria, em cada mes.
//
// Um orcamento com month = NULL e recorrente: aplica-se a todos os meses sem
// ter de ser recriado. Um orcamento com um mes concreto e uma excepcao que
// substitui o recorrente so nesse mes. A funcao rpc_category_spend do
// schema.sql ja devolve o valor em vigor; aqui usa-se a lista completa apenas
// para saber qual das duas linhas se esta a editar.
//
// So se orcamentam categorias de saida. Nao e uma regra da interface: e um
// trigger no esquema que a impoe, por isso vale mesmo que algo falhe no ecra.
// -----------------------------------------------------------------------------
import {
  listarContas, listarCategorias, listarOrcamentos, gastoPorCategoria,
  criarOrcamento, actualizarOrcamento, apagarOrcamento,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio } from './ui.js';
import { dialogoFormulario, dialogoConfirmar } from './modal.js';
import { formatMoney, rotuloMes } from './format.js';
import { contexto, selectorContexto, barraOrcamento } from './dashboard.js';

let contas = [];
let categoriasSaida = [];

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

function camposOrcamento(orcamento, categoriaFixa) {
  const campos = [];

  if (!categoriaFixa) {
    campos.push({
      nome: 'category_id', etiqueta: 'Categoria', tipo: 'seleccao',
      valor: orcamento?.category_id || (categoriasSaida[0] && categoriasSaida[0].id) || '',
      opcoes: categoriasSaida.map((c) => ({ valor: c.id, etiqueta: c.name })),
      ajuda: 'Só se orçamentam categorias de saída.',
    });
  }

  campos.push(
    { nome: 'amount', etiqueta: 'Valor mensal', tipo: 'number',
      valor: orcamento ? Number(orcamento.amount).toFixed(2) : '', obrigatorio: true,
      ajuda: 'Quanto quer que saia, no máximo, nesta categoria por mês.' },
    { nome: 'ambito', etiqueta: 'Aplica-se a', tipo: 'seleccao',
      valor: orcamento && orcamento.month ? 'mes' : 'sempre',
      opcoes: [
        { valor: 'sempre', etiqueta: 'Todos os meses (recorrente)' },
        { valor: 'mes', etiqueta: 'Só ' + rotuloMes(contexto.mes) },
      ],
      ajuda: 'Um valor só para este mês substitui o recorrente, sem o apagar.' },
  );

  return campos;
}

function normalizar(valores, categoryId) {
  const bruto = Number(String(valores.amount).replace(',', '.'));
  return {
    category_id: categoryId || valores.category_id,
    account_id: contexto.conta || null,
    month: valores.ambito === 'mes' ? contexto.mes : null,
    amount: Math.abs(bruto),
  };
}

function valorInvalido(valores) {
  const bruto = Number(String(valores.amount).replace(',', '.'));
  if (!Number.isFinite(bruto) || Math.abs(bruto) <= 0) {
    return 'O orçamento tem de ser um valor maior do que zero.';
  }
  return null;
}

async function definirOrcamento(linha, orcamento, todos, recarregar) {
  const categoriaFixa = linha ? linha.category_id : null;

  const valores = await dialogoFormulario({
    titulo: orcamento ? 'Editar orçamento' : 'Novo orçamento',
    campos: camposOrcamento(orcamento, categoriaFixa),
    confirmar: 'Guardar',
  });
  if (!valores) return;

  const erro = valorInvalido(valores);
  if (erro) { avisar(erro, 'erro'); return; }

  const dados = normalizar(valores, categoriaFixa);

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
// Desenho
// -----------------------------------------------------------------------------

function linhaOrcamento(item, accoes) {
  const { categoria, gasto, orcamento } = item;
  const definido = orcamento != null;
  const valor = definido ? Number(orcamento.amount) : null;
  const excede = definido && gasto > valor;
  const restante = definido ? valor - gasto : null;

  return el('div', { class: 'orcamento' }, [
    el('div', { class: 'orcamento__topo' }, [
      el('span', { class: 'chip' }, [
        el('span', { class: 'chip__ponto', style: 'background:' + (categoria.color || '#6B7280') }),
        el('span', { text: categoria.name }),
      ]),
      definido && orcamento.month
        ? el('span', { class: 'marca', text: 'só este mês' })
        : (definido ? el('span', { class: 'marca marca--fraca', text: 'recorrente' }) : null),
      el('span', { class: 'orcamento__valores' }, [
        el('span', { class: 'valor', text: formatMoney(gasto) }),
        definido
          ? el('span', { class: 'categoria__orcamento' + (excede ? ' categoria__orcamento--excede' : ''),
              text: 'de ' + formatMoney(valor) })
          : el('span', { class: 'categoria__orcamento', text: 'sem orçamento' }),
      ]),
    ]),

    definido ? barraOrcamento(gasto, valor) : null,

    definido
      ? el('p', { class: 'orcamento__nota' + (excede ? ' orcamento__nota--excede' : ''),
          text: excede
            ? 'Ultrapassado em ' + formatMoney(Math.abs(restante))
            : 'Faltam ' + formatMoney(restante) })
      : null,

    el('div', { class: 'orcamento__accoes' }, [
      el('button', { class: 'btn btn--pequeno', type: 'button',
        text: definido ? 'Editar' : 'Definir orçamento',
        onclick: () => accoes.definir(item) }),
      definido
        ? el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar',
            onclick: () => accoes.apagar(item) })
        : null,
    ]),
  ]);
}

export function desenharOrcamentos({ itens, contas, categoriasSaida }, accoes = {}) {
  const fragmento = document.createDocumentFragment();

  fragmento.append(
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Orçamento' }),
    ]),
    selectorContexto(contas, accoes.recarregar),
  );

  if (!categoriasSaida.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio('Ainda não há categorias de saída para orçamentar.',
        'Criar categorias', () => { location.hash = '#/categorias'; }),
    ]));
    return fragmento;
  }

  const comOrcamento = itens.filter((i) => i.orcamento);
  const semOrcamento = itens.filter((i) => !i.orcamento);

  fragmento.append(el('p', { class: 'contexto__nota',
    text: contexto.conta
      ? 'A ver o orçamento específico desta conta.'
      : 'A ver o orçamento agregado de todas as contas.' }));

  if (comOrcamento.length) {
    fragmento.append(el('div', { class: 'cartao' },
      comOrcamento.map((i) => linhaOrcamento(i, accoes))));
  } else {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio(
        'Ainda não definiu nenhum orçamento ' + (contexto.conta ? 'nesta conta.' : 'agregado.')
        + ' Escolha uma categoria abaixo para começar.',
        null, null,
      ),
    ]));
  }

  if (semOrcamento.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      el('h2', { class: 'cartao__titulo', text: 'Sem orçamento definido' }),
      el('div', {}, semOrcamento.map((i) => linhaOrcamento(i, accoes))),
    ]));
  }

  return fragmento;
}

// -----------------------------------------------------------------------------
// Ligacao ao ecra
// -----------------------------------------------------------------------------

export async function montarOrcamentos(alvo) {
  [contas, categoriasSaida] = await Promise.all([
    listarContas(),
    listarCategorias('despesa'),
  ]);

  async function recarregar() {
    const [orcamentos, gastos] = await Promise.all([
      listarOrcamentos(),
      gastoPorCategoria(contexto.mes, contexto.conta),
    ]);

    const gastoPorId = new Map(gastos.map((g) => [g.category_id, Number(g.spent) || 0]));

    const itens = categoriasSaida.map((categoria) => ({
      categoria,
      gasto: gastoPorId.get(categoria.id) || 0,
      orcamento: orcamentoEmVigor(orcamentos, categoria.id),
    }));

    // Primeiro os que estão mais perto do limite.
    itens.sort((a, b) => {
      const ra = a.orcamento ? a.gasto / Number(a.orcamento.amount) : -1;
      const rb = b.orcamento ? b.gasto / Number(b.orcamento.amount) : -1;
      return rb - ra;
    });

    alvo.replaceChildren(desenharOrcamentos({ itens, contas, categoriasSaida }, {
      recarregar,
      definir: (item) => definirOrcamento(
        { category_id: item.categoria.id }, item.orcamento, orcamentos, recarregar),
      apagar: (item) => removerOrcamento(item.orcamento, item.categoria.name, recarregar),
    }));
  }

  await recarregar();
}
