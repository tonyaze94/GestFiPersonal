// -----------------------------------------------------------------------------
// Ecra "Movimentos": registo, listagem paginada e filtros.
//
// O sinal do valor guardado na base de dados e que distingue entrada de
// saida: positivo entra, negativo sai. No formulario pede-se o tipo e um
// valor sempre positivo, para nao haver enganos com sinais a mao.
//
// A interface nunca fala em "receita" ou "despesa": numa conta de
// investimentos o dinheiro que entra e um custo e o que sai e lucro, por isso
// os termos neutros Entrada e Saida servem todas as contas.
// -----------------------------------------------------------------------------
import {
  listarMovimentos, etiquetasDeMovimentos, etiquetasDoMovimento,
  criarMovimento, actualizarMovimento, apagarMovimento, alternarOculto,
  listarContas, listarCategorias, listarEtiquetas, POR_PAGINA,
  etiquetaTipoCategoriaMinuscula,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio } from './ui.js';
import { dialogoFormulario, dialogoConfirmar } from './modal.js';
import { formatMoney, formatDate, hojeISO } from './format.js';

/** Estado dos filtros, mantido enquanto o ecra estiver aberto. */
const filtros = {
  pagina: 0, conta: '', categoria: '', etiqueta: '',
  de: '', ate: '', texto: '', estado: 'todos',
};

/**
 * Substitui os filtros de uma vez, limpando os que nao vierem indicados.
 * Serve o "ver movimentos desta categoria" a partir do ecra de resumo.
 */
export function definirFiltros(parciais = {}) {
  Object.assign(filtros, {
    pagina: 0, conta: '', categoria: '', etiqueta: '',
    de: '', ate: '', texto: '', estado: 'todos',
  }, parciais);
}

/** Listas de apoio, lidas uma vez por visita ao ecra. */
let contas = [];
let categorias = [];
let etiquetas = [];

// -----------------------------------------------------------------------------
// Formulario
// -----------------------------------------------------------------------------

function camposMovimento(movimento = {}, etiquetasEscolhidas = []) {
  const valor = Number(movimento.amount ?? 0);

  return [
    { nome: 'occurred_on', etiqueta: 'Data', tipo: 'date',
      valor: movimento.occurred_on || hojeISO(), obrigatorio: true },

    { nome: 'account_id', etiqueta: 'Conta', tipo: 'seleccao',
      valor: movimento.account_id || (contas[0] && contas[0].id) || '',
      opcoes: contas.map((c) => ({ valor: c.id, etiqueta: c.name })) },

    { nome: 'tipo', etiqueta: 'Tipo', tipo: 'seleccao',
      valor: valor > 0 ? 'receita' : 'despesa',
      opcoes: [
        { valor: 'despesa', etiqueta: 'Saída (sai dinheiro da conta)' },
        { valor: 'receita', etiqueta: 'Entrada (entra dinheiro na conta)' },
      ] },

    { nome: 'amount', etiqueta: 'Valor', tipo: 'number',
      valor: valor ? Math.abs(valor).toFixed(2) : '', obrigatorio: true,
      ajuda: 'Sempre positivo. O tipo acima é que define se entra ou sai.' },

    { nome: 'category_id', etiqueta: 'Categoria', tipo: 'seleccao',
      valor: movimento.category_id || '',
      opcoes: [
        { valor: '', etiqueta: '— sem categoria —' },
        ...categorias.map((c) => ({
          valor: c.id,
          etiqueta: c.name + ' · ' + etiquetaTipoCategoriaMinuscula(c.kind),
        })),
      ] },

    { nome: 'description', etiqueta: 'Descrição', tipo: 'text',
      valor: movimento.description || '', maximo: 120 },

    { nome: 'etiquetas', etiqueta: 'Etiquetas', tipo: 'etiquetas',
      valor: etiquetasEscolhidas, opcoes: etiquetas },

    { nome: 'excluded_from_analysis', etiqueta: 'Ocultar da análise', tipo: 'interruptor',
      valor: Boolean(movimento.excluded_from_analysis),
      ajuda: 'Continua a contar para o saldo da conta, mas fica de fora dos gráficos, '
           + 'dos totais e da comparação com o orçamento.' },

    { nome: 'excluded_reason', etiqueta: 'Motivo', tipo: 'texto-longo',
      valor: movimento.excluded_reason || '', maximo: 140,
      dependeDe: 'excluded_from_analysis',
      ajuda: 'Opcional. Ex.: transferência entre as minhas contas.' },
  ];
}

/** Converte os valores do formulario para o formato da base de dados. */
function normalizar(valores) {
  const bruto = Number(String(valores.amount).replace(',', '.'));
  const absoluto = Number.isFinite(bruto) ? Math.abs(bruto) : 0;
  const oculto = Boolean(valores.excluded_from_analysis);

  return {
    occurred_on: valores.occurred_on,
    account_id: valores.account_id,
    category_id: valores.category_id || null,
    amount: valores.tipo === 'receita' ? absoluto : -absoluto,
    description: valores.description || null,
    excluded_from_analysis: oculto,
    excluded_reason: oculto ? (valores.excluded_reason || null) : null,
  };
}

function valorInvalido(valores) {
  const bruto = Number(String(valores.amount).replace(',', '.'));
  if (!Number.isFinite(bruto) || Math.abs(bruto) === 0) return 'Indique um valor diferente de zero.';
  if (!valores.account_id) return 'Escolha a conta do movimento.';
  if (!valores.occurred_on) return 'Indique a data do movimento.';
  return null;
}

async function novoMovimento(recarregar) {
  if (!contas.length) {
    avisar('Crie primeiro uma conta em Contas.', 'erro');
    return;
  }

  const valores = await dialogoFormulario({
    titulo: 'Novo movimento',
    campos: camposMovimento(),
    confirmar: 'Registar',
  });
  if (!valores) return;

  const erro = valorInvalido(valores);
  if (erro) { avisar(erro, 'erro'); return; }

  try {
    await criarMovimento(normalizar(valores), valores.etiquetas);
    avisar('Movimento registado.', 'sucesso');
    await recarregar();
  } catch (e) {
    avisar(traduzErro(e), 'erro');
  }
}

async function editarMovimento(movimento, recarregar) {
  let escolhidas = [];
  try {
    escolhidas = await etiquetasDoMovimento(movimento.id);
  } catch { /* sem etiquetas se a leitura falhar; o resto do formulário abre na mesma */ }

  const valores = await dialogoFormulario({
    titulo: 'Editar movimento',
    campos: camposMovimento(movimento, escolhidas),
    confirmar: 'Guardar alterações',
  });
  if (!valores) return;

  const erro = valorInvalido(valores);
  if (erro) { avisar(erro, 'erro'); return; }

  try {
    await actualizarMovimento(movimento.id, normalizar(valores), valores.etiquetas);
    avisar('Movimento atualizado.', 'sucesso');
    await recarregar();
  } catch (e) {
    avisar(traduzErro(e), 'erro');
  }
}

async function removerMovimento(movimento, recarregar) {
  const confirmado = await dialogoConfirmar({
    titulo: 'Apagar movimento',
    mensagem: `Apagar "${movimento.description || 'movimento sem descrição'}" de `
            + `${formatMoney(movimento.amount)}, de ${formatDate(movimento.occurred_on)}?`,
    confirmar: 'Apagar',
  });
  if (!confirmado) return;

  try {
    await apagarMovimento(movimento.id);
    avisar('Movimento apagado.', 'sucesso');
    await recarregar();
  } catch (e) {
    avisar(traduzErro(e), 'erro');
  }
}

async function alternarAnalise(movimento, recarregar) {
  const passaAOcultar = !movimento.excluded_from_analysis;
  let motivo = movimento.excluded_reason || '';

  if (passaAOcultar) {
    const valores = await dialogoFormulario({
      titulo: 'Ocultar da análise',
      campos: [{ nome: 'motivo', etiqueta: 'Motivo', tipo: 'texto-longo', valor: motivo,
        maximo: 140,
        ajuda: 'Opcional. Continua a contar para o saldo da conta.' }],
      confirmar: 'Ocultar',
    });
    if (!valores) return;
    motivo = valores.motivo;
  }

  try {
    await alternarOculto(movimento.id, passaAOcultar, motivo);
    avisar(passaAOcultar ? 'Movimento oculto da análise.' : 'Movimento incluído na análise.', 'sucesso');
    await recarregar();
  } catch (e) {
    avisar(traduzErro(e), 'erro');
  }
}

// -----------------------------------------------------------------------------
// Desenho
// -----------------------------------------------------------------------------

/** Olho cortado: assinala um movimento fora da analise. */
function iconeOculto(motivo) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'oculto');
  // Olho desenhado com uma pupila vazada (evenodd), mais um risco por cima.
  const olho = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  olho.setAttribute('fill-rule', 'evenodd');
  olho.setAttribute('d', 'M12 6.5c-4 0-7.4 2.3-9 5.5 1.6 3.2 5 5.5 9 5.5s7.4-2.3 9-5.5'
    + 'c-1.6-3.2-5-5.5-9-5.5m0 9a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7');
  svg.append(olho);

  const risco = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  risco.setAttribute('d', 'M4.4 19.1 19.1 4.4l1.4 1.4L5.8 20.5z');
  svg.append(risco);
  const titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  titulo.textContent = motivo
    ? 'Fora da análise: ' + motivo
    : 'Fora da análise (conta na mesma para o saldo)';
  svg.append(titulo);
  return svg;
}

export function linhaMovimento(movimento, etiquetasDaLinha = [], accoes = {}) {
  const categoria = movimento.categories;
  const conta = movimento.accounts;
  const negativo = Number(movimento.amount) < 0;

  const meta = el('div', { class: 'movimento__meta' }, [
    el('span', { text: formatDate(movimento.occurred_on) }),
    conta ? el('span', { text: '· ' + conta.name }) : null,
    categoria
      ? el('span', { class: 'chip' }, [
          el('span', { class: 'chip__ponto', style: 'background:' + (categoria.color || '#6B7280') }),
          el('span', { text: categoria.name }),
        ])
      : el('span', { class: 'chip' }, [
          el('span', { class: 'chip__ponto' }),
          el('span', { text: 'sem categoria' }),
        ]),
  ]);

  for (const etiqueta of etiquetasDaLinha) {
    meta.append(el('span', { class: 'etiqueta-marca' }, [
      el('span', { class: 'chip__ponto', style: 'background:' + (etiqueta.color || '#6B7280') }),
      el('span', { text: etiqueta.name }),
    ]));
  }

  return el('li', { class: 'lista__linha movimento' }, [
    el('div', { class: 'lista__principal' }, [
      el('div', { class: 'movimento__topo' }, [
        el('span', { class: 'lista__nome', text: movimento.description || 'Sem descrição' }),
        movimento.excluded_from_analysis ? iconeOculto(movimento.excluded_reason) : null,
      ]),
      meta,
    ]),
    el('span', {
      class: 'valor lista__valor ' + (negativo ? 'valor--negativo' : 'valor--positivo'),
      text: formatMoney(movimento.amount, { sinal: true }),
    }),
    el('div', { class: 'lista__accoes' }, [
      el('button', {
        class: 'btn btn--pequeno', type: 'button',
        text: movimento.excluded_from_analysis ? 'Incluir' : 'Ocultar',
        title: movimento.excluded_from_analysis
          ? 'Voltar a incluir nos totais e gráficos'
          : 'Manter no saldo, mas fora dos totais e gráficos',
        onclick: () => accoes.alternar && accoes.alternar(movimento),
      }),
      el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar',
        onclick: () => accoes.editar && accoes.editar(movimento) }),
      el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar',
        onclick: () => accoes.apagar && accoes.apagar(movimento) }),
    ]),
  ]);
}

function barraFiltros(aoMudar) {
  function selector(nome, etiqueta, opcoes) {
    const select = el('select', { name: nome, 'aria-label': etiqueta });
    for (const opcao of opcoes) {
      const item = el('option', { value: opcao.valor, text: opcao.etiqueta });
      if (String(opcao.valor) === String(filtros[nome])) item.selected = true;
      select.append(item);
    }
    select.addEventListener('change', () => {
      filtros[nome] = select.value;
      filtros.pagina = 0;
      aoMudar();
    });
    return select;
  }

  const procura = el('input', {
    type: 'search', name: 'texto', value: filtros.texto,
    placeholder: 'Procurar na descrição', 'aria-label': 'Procurar na descrição',
  });
  let temporizador;
  procura.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      filtros.texto = procura.value.trim();
      filtros.pagina = 0;
      aoMudar();
    }, 350);
  });

  function data(nome, etiqueta) {
    const campo = el('input', { type: 'date', name: nome, value: filtros[nome], 'aria-label': etiqueta });
    campo.addEventListener('change', () => {
      filtros[nome] = campo.value;
      filtros.pagina = 0;
      aoMudar();
    });
    return campo;
  }

  return el('div', { class: 'filtros cartao' }, [
    procura,
    selector('conta', 'Conta', [
      { valor: '', etiqueta: 'Todas as contas' },
      ...contas.map((c) => ({ valor: c.id, etiqueta: c.name })),
    ]),
    selector('categoria', 'Categoria', [
      { valor: '', etiqueta: 'Todas as categorias' },
      { valor: 'sem', etiqueta: 'Sem categoria' },
      ...categorias.map((c) => ({ valor: c.id, etiqueta: c.name })),
    ]),
    selector('etiqueta', 'Etiqueta', [
      { valor: '', etiqueta: 'Todas as etiquetas' },
      ...etiquetas.map((t) => ({ valor: t.id, etiqueta: t.name })),
    ]),
    selector('estado', 'Estado', [
      { valor: 'todos', etiqueta: 'Visíveis e ocultos' },
      { valor: 'visiveis', etiqueta: 'Só os visíveis' },
      { valor: 'ocultos', etiqueta: 'Só os ocultos' },
    ]),
    data('de', 'Data inicial'),
    data('ate', 'Data final'),
  ]);
}

function paginacao(total, aoMudar) {
  const primeiro = filtros.pagina * POR_PAGINA + 1;
  const ultimo = Math.min(total, (filtros.pagina + 1) * POR_PAGINA);
  const haMais = ultimo < total;

  return el('div', { class: 'paginacao' }, [
    el('button', {
      class: 'btn btn--pequeno', type: 'button', text: 'Anteriores',
      disabled: filtros.pagina === 0 || null,
      onclick: () => { filtros.pagina -= 1; aoMudar(); },
    }),
    el('span', { class: 'paginacao__conta',
      text: `${primeiro}–${ultimo} de ${total}` }),
    el('button', {
      class: 'btn btn--pequeno', type: 'button', text: 'Seguintes',
      disabled: haMais ? null : true,
      onclick: () => { filtros.pagina += 1; aoMudar(); },
    }),
  ]);
}

function haFiltrosActivos() {
  return Boolean(filtros.conta || filtros.categoria || filtros.etiqueta
    || filtros.de || filtros.ate || filtros.texto || filtros.estado !== 'todos');
}

export function desenharMovimentos({ movimentos, total, etiquetasPorMovimento }, accoes = {}) {
  const fragmento = document.createDocumentFragment();

  fragmento.append(
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Movimentos' }),
      el('button', { class: 'btn btn--primario', type: 'button', text: 'Novo movimento',
        onclick: () => accoes.novo && accoes.novo() }),
    ]),
    barraFiltros(accoes.recarregar),
  );

  if (!movimentos.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      haFiltrosActivos()
        ? estadoVazio('Nenhum movimento corresponde a estes filtros.', 'Limpar filtros',
            () => accoes.limpar && accoes.limpar())
        : estadoVazio('Ainda não há movimentos registados.', 'Registar o primeiro movimento',
            () => accoes.novo && accoes.novo()),
    ]));
    return fragmento;
  }

  fragmento.append(
    el('ul', { class: 'lista cartao' }, movimentos.map((m) =>
      linhaMovimento(m, etiquetasPorMovimento.get(m.id) || [], accoes))),
    paginacao(total, accoes.recarregar),
  );

  return fragmento;
}

// -----------------------------------------------------------------------------
// Ligacao ao ecra
// -----------------------------------------------------------------------------

export async function montarMovimentos(alvo) {
  // Listas de apoio dos filtros e do formulário.
  [contas, categorias, etiquetas] = await Promise.all([
    listarContas(), listarCategorias(), listarEtiquetas(),
  ]);

  async function recarregar() {
    const { movimentos, total } = await listarMovimentos(filtros);
    // Segundo pedido limitado aos movimentos desta página.
    const etiquetasPorMovimento = await etiquetasDeMovimentos(movimentos.map((m) => m.id));

    alvo.replaceChildren(desenharMovimentos(
      { movimentos, total, etiquetasPorMovimento },
      {
        novo:       () => novoMovimento(recarregar),
        editar:     (m) => editarMovimento(m, recarregar),
        apagar:     (m) => removerMovimento(m, recarregar),
        alternar:   (m) => alternarAnalise(m, recarregar),
        recarregar,
        limpar: () => {
          Object.assign(filtros, {
            pagina: 0, conta: '', categoria: '', etiqueta: '',
            de: '', ate: '', texto: '', estado: 'todos',
          });
          recarregar();
        },
      },
    ));
  }

  await recarregar();
}
