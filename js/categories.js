// -----------------------------------------------------------------------------
// Ecra "Categorias": criar, editar e apagar categorias de despesa e de receita.
//
// Uma categoria pode ter uma categoria-mae, para subcategorias. A restricao
// unique (user_id, name, kind) do esquema permite que "Empréstimos" exista em
// saida e em entrada ao mesmo tempo, por serem tipos diferentes.
//
// Na base de dados os tipos continuam a chamar-se 'despesa' e 'receita'; na
// interface sao sempre Saida e Entrada (ver TIPOS_CATEGORIA em db.js).
// -----------------------------------------------------------------------------
import {
  listarCategorias, criarCategoria, actualizarCategoria,
  apagarCategoria, criarCategoriasEmLote,
  TIPOS_CATEGORIA, etiquetaTipoCategoriaMinuscula,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio, abas } from './ui.js';
import { dialogoFormulario, dialogoConfirmar, PALETA } from './modal.js';
import { ABAS_GESTAO } from './accounts.js';

/** Categorias de partida, criadas de uma vez atraves da propria aplicacao. */
const CATEGORIAS_SUGERIDAS = [
  { name: 'Diversos',            kind: 'despesa', color: '#6B7280' },
  { name: 'Carro e Transportes', kind: 'despesa', color: '#2B5CB8' },
  { name: 'Levantamentos',       kind: 'despesa', color: '#9C7A5B' },
  { name: 'Restaurantes',        kind: 'despesa', color: '#D9483C' },
  { name: 'Bares',               kind: 'despesa', color: '#C4589B' },
  { name: 'Discotecas',          kind: 'despesa', color: '#8A5BC4' },
  { name: 'Cinema',              kind: 'despesa', color: '#5B63C4' },
  { name: 'Combustível',         kind: 'despesa', color: '#E8A33D' },
  { name: 'Contabilista',        kind: 'despesa', color: '#3AA6A6' },
  { name: 'Taxas',               kind: 'despesa', color: '#E3C84B' },
  { name: 'Empréstimos',         kind: 'despesa', color: '#7BB661' },
  { name: 'Casa',                kind: 'despesa', color: '#1F9D6B' },
  { name: 'Salário',             kind: 'receita', color: '#1F9D6B' },
  { name: 'Empréstimos',         kind: 'receita', color: '#3AA6A6' },
  { name: 'Outros',              kind: 'receita', color: '#6B7280' },
];



// -----------------------------------------------------------------------------
// Formulario
// -----------------------------------------------------------------------------

function camposCategoria(categoria = {}, todas = []) {
  // Uma categoria nao pode ser mae de si propria.
  const possiveisMaes = todas
    .filter((c) => c.id !== categoria.id && !c.parent_id)
    .filter((c) => !categoria.kind || c.kind === categoria.kind);

  return [
    { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: categoria.name || '',
      obrigatorio: true, maximo: 40 },
    { nome: 'kind', etiqueta: 'Tipo', tipo: 'seleccao', valor: categoria.kind || 'despesa',
      opcoes: TIPOS_CATEGORIA },
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
    kind: valores.kind,
    color: valores.color,
    parent_id: valores.parent_id || null,
  };
}

async function novaCategoria(tipo, todas, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Nova categoria de ' + etiquetaTipoCategoriaMinuscula(tipo),
    campos: camposCategoria({ kind: tipo }, todas),
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
            + 'sem categoria, mas não são apagados.',
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
    mensagem: 'Vão ser criadas 12 categorias de saída e 3 de entrada, cada uma com a sua cor. '
            + 'As que já existirem são ignoradas. Pode editar ou apagar qualquer uma a seguir.',
    confirmar: 'Criar categorias',
    perigo: false,
  });
  if (!confirmado) return;

  try {
    // Insercao em lote: um unico pedido com as 15 categorias.
    await criarCategoriasEmLote(CATEGORIAS_SUGERIDAS);
    avisar('Categorias criadas.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

// -----------------------------------------------------------------------------
// Desenho
// -----------------------------------------------------------------------------

/** Chip de categoria: bolinha de cor mais nome, nunca so texto. */
export function chipCategoria(categoria) {
  return el('span', { class: 'chip' }, [
    el('span', { class: 'chip__ponto', style: 'background:' + (categoria.color || '#6B7280') }),
    el('span', { text: categoria.name }),
  ]);
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

function seccao(titulo, tipo, categorias, porNome, accoes) {
  // Categorias-mae primeiro, cada uma seguida das suas subcategorias.
  const raizes = categorias.filter((c) => !c.parent_id);
  const ordenadas = [];
  for (const raiz of raizes) {
    ordenadas.push(raiz);
    ordenadas.push(...categorias.filter((c) => c.parent_id === raiz.id));
  }
  // Subcategorias cuja mae e de outro tipo ficariam de fora: acrescenta-se no fim.
  for (const c of categorias) if (!ordenadas.includes(c)) ordenadas.push(c);

  return el('section', { class: 'seccao' }, [
    el('div', { class: 'cabecalho' }, [
      el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: titulo }),
      el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Adicionar',
        onclick: () => accoes.nova(tipo) }),
    ]),
    ordenadas.length
      ? el('ul', { class: 'lista cartao' },
          ordenadas.map((c) => linhaCategoria(c, porNome, accoes)))
      : el('div', { class: 'cartao' }, [
          el('p', { class: 'vazio__texto', text: 'Nenhuma categoria deste tipo.' }),
        ]),
  ]);
}

export function desenharCategorias(categorias, accoes = {}) {
  const fragmento = document.createDocumentFragment();
  const porNome = new Map(categorias.map((c) => [c.id, c]));

  fragmento.append(
    abas(ABAS_GESTAO, 'categorias'),
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Categorias' }),
    ]),
  );

  if (!categorias.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio(
        'Ainda não há categorias. Crie de uma vez as 15 categorias de partida, ou adicione-as uma a uma.',
        'Criar categorias de partida',
        () => accoes.sugeridas && accoes.sugeridas(),
      ),
      el('div', { class: 'vazio__alternativa' }, [
        el('button', { class: 'btn btn--texto', type: 'button', text: 'Prefiro criar uma categoria manualmente',
          onclick: () => accoes.nova && accoes.nova('despesa') }),
      ]),
    ]));
    return fragmento;
  }

  fragmento.append(
    seccao('Saídas', 'despesa', categorias.filter((c) => c.kind === 'despesa'), porNome, accoes),
    seccao('Entradas', 'receita', categorias.filter((c) => c.kind === 'receita'), porNome, accoes),
  );

  return fragmento;
}

// -----------------------------------------------------------------------------
// Ligacao ao ecra
// -----------------------------------------------------------------------------

export async function montarCategorias(alvo) {
  async function recarregar() {
    const categorias = await listarCategorias();
    alvo.replaceChildren(desenharCategorias(categorias, {
      nova:      (tipo) => novaCategoria(tipo, categorias, recarregar),
      editar:    (c) => editarCategoria(c, categorias, recarregar),
      apagar:    (c) => removerCategoria(c, recarregar),
      sugeridas: () => criarSugeridas(recarregar),
    }));
  }
  await recarregar();
}
