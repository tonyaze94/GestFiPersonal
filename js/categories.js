// -----------------------------------------------------------------------------
// Ecra "Definicoes > Orcamento": o teto global mensal e as categorias
// (criar, editar nome/icone/cor, apagar).
//
// Uma categoria nao e de entrada nem de saida: o sinal de cada movimento e
// que decide. Pode ter uma categoria-mae, para subcategorias.
// -----------------------------------------------------------------------------
import {
  listarCategorias, criarCategoria, actualizarCategoria,
  apagarCategoria, criarCategoriasEmLote,
  listarTetos, definirTeto, apagarTeto,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio, abas, chip } from './ui.js';
import { dialogoFormulario, dialogoConfirmar, PALETA } from './modal.js';
import { formatMoney, rotuloMes } from './format.js';
import { ABAS_GESTAO } from './accounts.js';

/** Categorias de partida, criadas de uma vez atraves da propria aplicacao. */
const CATEGORIAS_SUGERIDAS = [
  { name: 'Diversos',            color: '#6B7280' },
  { name: 'Carro e Transportes', color: '#2B5CB8' },
  { name: 'Levantamentos',       color: '#9C7A5B' },
  { name: 'Restaurantes',        color: '#D9483C' },
  { name: 'Bares',               color: '#C4589B' },
  { name: 'Discotecas',          color: '#8A5BC4' },
  { name: 'Cinema',              color: '#5B63C4' },
  { name: 'Combustível',         color: '#E8A33D' },
  { name: 'Contabilista',        color: '#3AA6A6' },
  { name: 'Taxas',               color: '#E3C84B' },
  { name: 'Empréstimos',         color: '#7BB661' },
  { name: 'Casa',                color: '#1F9D6B' },
  { name: 'Salário',             color: '#1F9D6B' },
  { name: 'Outros',              color: '#6B7280' },
];



// -----------------------------------------------------------------------------
// Formulario
// -----------------------------------------------------------------------------

function camposCategoria(categoria = {}, todas = []) {
  // Uma categoria nao pode ser mae de si propria.
  const possiveisMaes = todas
    .filter((c) => c.id !== categoria.id && !c.parent_id);

  return [
    { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: categoria.name || '',
      obrigatorio: true, maximo: 40 },
    { nome: 'icon', etiqueta: 'Ícone', tipo: 'icone', valor: categoria.icon || '' },
    { nome: 'color', etiqueta: 'Cor', tipo: 'cor', valor: categoria.color || PALETA[0] },
    { nome: 'parent_id', etiqueta: 'Categoria-mãe', tipo: 'seleccao',
      valor: categoria.parent_id || '',
      opcoes: [{ valor: '', etiqueta: '— nenhuma —' },
        ...possiveisMaes.map((c) => ({ valor: c.id, etiqueta: c.name }))],
      ajuda: 'Opcional. Use para criar uma subcategoria.' },
  ];
}

function normalizar(valores) {
  return {
    name: valores.name,
    icon: valores.icon || null,
    color: valores.color,
    parent_id: valores.parent_id || null,
  };
}

async function novaCategoria(todas, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Nova categoria',
    campos: camposCategoria({}, todas),
    confirmar: 'Criar categoria',
  });
  if (!valores) return;

  try {
    await criarCategoria(normalizar(valores));
    avisar('Categoria criada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function editarCategoria(categoria, todas, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Editar categoria',
    campos: camposCategoria(categoria, todas),
    confirmar: 'Guardar alterações',
  });
  if (!valores) return;

  try {
    await actualizarCategoria(categoria.id, normalizar(valores));
    avisar('Categoria atualizada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function removerCategoria(categoria, recarregar) {
  const confirmado = await dialogoConfirmar({
    titulo: 'Apagar categoria',
    mensagem: `Apagar a categoria "${categoria.name}"? Os movimentos que a usavam ficam `
            + 'sem categoria, mas não são apagados; os orçamentos dela são apagados e as '
            + 'subcategorias passam a categorias de topo.',
    confirmar: 'Apagar',
  });
  if (!confirmado) return;

  try {
    await apagarCategoria(categoria.id);
    avisar('Categoria apagada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function criarSugeridas(recarregar) {
  const confirmado = await dialogoConfirmar({
    titulo: 'Criar categorias de partida',
    mensagem: 'Vão ser criadas 14 categorias, cada uma com a sua cor. '
            + 'As que já existirem são ignoradas. Pode editar ou apagar qualquer uma a seguir.',
    confirmar: 'Criar categorias',
    perigo: false,
  });
  if (!confirmado) return;

  try {
    // Insercao em lote: um unico pedido com as 14 categorias.
    await criarCategoriasEmLote(CATEGORIAS_SUGERIDAS);
    avisar('Categorias criadas.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

// -----------------------------------------------------------------------------
// Teto global mensal
//
// Aqui gere-se o valor recorrente e as excepcoes ja criadas. Uma excepcao
// para um mes concreto cria-se no ecra Orcamento, com esse mes aberto.
// -----------------------------------------------------------------------------

async function editarTetoRecorrente(tetos, recarregar) {
  const actual = tetos.find((t) => t.month === null);
  const valores = await dialogoFormulario({
    titulo: 'Teto global mensal',
    campos: [
      { nome: 'amount', etiqueta: 'Máximo a sair por mês', tipo: 'number', obrigatorio: true,
        valor: actual ? Number(actual.amount).toFixed(2) : '',
        ajuda: 'Soma de todas as saídas do mês, em todas as contas. É independente dos '
             + 'orçamentos por categoria: a soma destes pode ficar acima ou abaixo.' },
    ],
    confirmar: 'Guardar',
  });
  if (!valores) return;

  const valor = Math.abs(Number(String(valores.amount).replace(',', '.')));
  if (!Number.isFinite(valor) || valor <= 0) {
    avisar('O teto tem de ser um valor maior do que zero.', 'erro');
    return;
  }

  try {
    await definirTeto(tetos, null, valor);
    avisar('Teto global guardado.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function removerTeto(teto, recarregar) {
  const ambito = teto.month ? 'de ' + rotuloMes(teto.month) : 'recorrente';
  const confirmado = await dialogoConfirmar({
    titulo: 'Remover teto',
    mensagem: 'Remover o teto global ' + ambito + '? Os movimentos e os orçamentos por '
            + 'categoria não são afetados.',
    confirmar: 'Remover',
  });
  if (!confirmado) return;

  try {
    await apagarTeto(teto.id);
    avisar('Teto removido.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

/** Valor em destaque e ambito por baixo: cabe em telemovel ao lado dos botoes. */
function linhaTeto(valor, ambito, botoes) {
  return el('li', { class: 'lista__linha' }, [
    el('div', { class: 'lista__principal' }, [
      el('span', { class: 'lista__nome valor', text: valor }),
      el('span', { class: 'lista__meta', text: ambito }),
    ]),
    el('div', { class: 'lista__accoes' }, botoes),
  ]);
}

function seccaoTeto(tetos, accoes) {
  const recorrente = tetos.find((t) => t.month === null);
  const excepcoes = tetos.filter((t) => t.month !== null);

  return el('section', { class: 'seccao' }, [
    el('div', { class: 'cabecalho' }, [
      el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Teto global mensal' }),
    ]),
    el('p', { class: 'contexto__nota',
      text: 'Máximo para o total de saídas do mês, em todas as contas — independente dos '
          + 'orçamentos por categoria.' }),
    el('ul', { class: 'lista cartao' }, [
      linhaTeto(recorrente ? formatMoney(recorrente.amount) : 'Sem teto', 'Todos os meses', [
        el('button', { class: 'btn btn--pequeno', type: 'button',
          text: recorrente ? 'Editar' : 'Definir', onclick: accoes.editarTeto }),
        recorrente
          ? el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Remover',
              onclick: () => accoes.removerTeto(recorrente) })
          : null,
      ]),
      ...excepcoes.map((t) => linhaTeto(formatMoney(t.amount), 'Só ' + rotuloMes(t.month), [
          el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Remover',
            onclick: () => accoes.removerTeto(t) }),
        ])),
    ]),
  ]);
}

// -----------------------------------------------------------------------------
// Desenho
// -----------------------------------------------------------------------------

/** Chip de categoria: bolinha de cor, icone e nome, nunca so texto. */
export function chipCategoria(categoria) {
  return chip(categoria.name, categoria.color || '#6B7280', categoria.icon);
}

function linhaCategoria(categoria, porNome, accoes) {
  const mae = categoria.parent_id ? porNome.get(categoria.parent_id) : null;

  return el('li', { class: 'lista__linha' }, [
    el('div', { class: 'lista__principal' }, [
      chipCategoria(categoria),
      mae ? el('span', { class: 'lista__meta', text: 'dentro de ' + mae.name }) : null,
    ]),
    el('div', { class: 'lista__accoes' }, [
      el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar',
        onclick: () => accoes.editar(categoria) }),
      el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar',
        onclick: () => accoes.apagar(categoria) }),
    ]),
  ]);
}

function seccao(titulo, categorias, porNome, accoes) {
  // Categorias-mae primeiro, cada uma seguida das suas subcategorias.
  const raizes = categorias.filter((c) => !c.parent_id);
  const ordenadas = [];
  for (const raiz of raizes) {
    ordenadas.push(raiz);
    ordenadas.push(...categorias.filter((c) => c.parent_id === raiz.id));
  }
  // Subcategorias cuja mae nao esteja na lista: acrescenta-se no fim.
  for (const c of categorias) if (!ordenadas.includes(c)) ordenadas.push(c);

  return el('section', { class: 'seccao' }, [
    el('div', { class: 'cabecalho' }, [
      el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: titulo }),
      el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Adicionar',
        onclick: () => accoes.nova() }),
    ]),
    ordenadas.length
      ? el('ul', { class: 'lista cartao' },
          ordenadas.map((c) => linhaCategoria(c, porNome, accoes)))
      : el('div', { class: 'cartao' }, [
          el('p', { class: 'vazio__texto', text: 'Nenhuma categoria.' }),
        ]),
  ]);
}

export function desenharCategorias(categorias, accoes = {}, tetos = []) {
  const fragmento = document.createDocumentFragment();
  const porNome = new Map(categorias.map((c) => [c.id, c]));

  fragmento.append(
    abas(ABAS_GESTAO, 'definicoes-orcamento', true),
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Definições de orçamento' }),
    ]),
    seccaoTeto(tetos, accoes),
  );

  if (!categorias.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio(
        'Ainda não há categorias. Crie de uma vez as 14 categorias de partida, ou adicione-as uma a uma.',
        'Criar categorias de partida',
        () => accoes.sugeridas && accoes.sugeridas(),
      ),
      el('div', { class: 'vazio__alternativa' }, [
        el('button', { class: 'btn btn--texto', type: 'button', text: 'Prefiro criar uma categoria manualmente',
          onclick: () => accoes.nova && accoes.nova() }),
      ]),
    ]));
    return fragmento;
  }

  fragmento.append(seccao('Categorias', categorias, porNome, accoes));

  return fragmento;
}

// -----------------------------------------------------------------------------
// Ligacao ao ecra
// -----------------------------------------------------------------------------

export async function montarCategorias(alvo) {
  async function recarregar() {
    const [categorias, tetos] = await Promise.all([listarCategorias(), listarTetos()]);
    alvo.replaceChildren(desenharCategorias(categorias, {
      nova:        () => novaCategoria(categorias, recarregar),
      editar:      (c) => editarCategoria(c, categorias, recarregar),
      apagar:      (c) => removerCategoria(c, recarregar),
      sugeridas:   () => criarSugeridas(recarregar),
      editarTeto:  () => editarTetoRecorrente(tetos, recarregar),
      removerTeto: (t) => removerTeto(t, recarregar),
    }, tetos));
  }
  await recarregar();
}
