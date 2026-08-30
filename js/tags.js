// -----------------------------------------------------------------------------
// Ecra "Etiquetas": criar, renomear e apagar etiquetas livres ("férias",
// "obra", "carro"). Ficam disponiveis para associar a movimentos e para
// filtrar as analises, tal como as categorias.
// -----------------------------------------------------------------------------
import {
  listarEtiquetas, criarEtiqueta, actualizarEtiqueta, apagarEtiqueta,
  gastoPorEtiqueta, listarContas,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio, abas } from './ui.js';
import { dialogoFormulario, dialogoConfirmar, PALETA } from './modal.js';
import { ABAS_GESTAO } from './accounts.js';
import { contexto, selectorContexto } from './dashboard.js';
import { formatMoney, rotuloMes } from './format.js';

function camposEtiqueta(etiqueta = {}) {
  return [
    { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: etiqueta.name || '',
      obrigatorio: true, maximo: 30 },
    { nome: 'color', etiqueta: 'Cor', tipo: 'cor', valor: etiqueta.color || PALETA[6] },
  ];
}

async function novaEtiqueta(recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Nova etiqueta',
    campos: camposEtiqueta(),
    confirmar: 'Criar etiqueta',
  });
  if (!valores) return;

  try {
    await criarEtiqueta({ name: valores.name, color: valores.color });
    avisar('Etiqueta criada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function editarEtiqueta(etiqueta, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Editar etiqueta',
    campos: camposEtiqueta(etiqueta),
    confirmar: 'Guardar alterações',
  });
  if (!valores) return;

  try {
    await actualizarEtiqueta(etiqueta.id, { name: valores.name, color: valores.color });
    avisar('Etiqueta atualizada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function removerEtiqueta(etiqueta, recarregar) {
  const confirmado = await dialogoConfirmar({
    titulo: 'Apagar etiqueta',
    mensagem: `Apagar a etiqueta "${etiqueta.name}"? Deixa de estar associada aos movimentos, `
            + 'mas nenhum movimento é apagado.',
    confirmar: 'Apagar',
  });
  if (!confirmado) return;

  try {
    await apagarEtiqueta(etiqueta.id);
    avisar('Etiqueta apagada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

// -----------------------------------------------------------------------------
// Desenho
// -----------------------------------------------------------------------------

/**
 * Totais do mes por etiqueta.
 *
 * Um movimento com duas etiquetas conta para as duas, por isso a soma destas
 * linhas pode passar o total do mes. E o comportamento certo: serve para
 * responder a "quanto gastei em ferias", nao para fechar contas.
 */
function seccaoTotais(totais, contas, aoMudar) {
  const seccao = el('section', { class: 'seccao' }, [
    el('div', { class: 'cabecalho' }, [
      el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Totais por etiqueta' }),
    ]),
    selectorContexto(contas, aoMudar),
  ]);

  if (!totais.length) {
    seccao.append(el('div', { class: 'cartao' }, [
      el('p', { class: 'vazio__texto',
        text: 'Nenhum movimento com etiqueta em ' + rotuloMes(contexto.mes) + '.' }),
    ]));
    return seccao;
  }

  // O maior valor absoluto define a escala das barras de comparacao.
  const maximo = Math.max(...totais.map((t) => Math.abs(Number(t.spent) || 0)), 1);

  seccao.append(el('div', { class: 'cartao' }, totais.map((total) => {
    const valor = Number(total.spent) || 0;
    const largura = (Math.abs(valor) / maximo) * 100;

    return el('div', { class: 'etiqueta-total' }, [
      el('div', { class: 'etiqueta-total__topo' }, [
        el('span', { class: 'chip' }, [
          el('span', { class: 'chip__ponto', style: 'background:' + (total.color || '#6B7280') }),
          el('span', { text: total.tag_name }),
        ]),
        el('span', {
          class: 'valor' + (valor < 0 ? ' valor--negativo' : ' valor--positivo'),
          text: formatMoney(valor, { sinal: true }),
        }),
      ]),
      el('div', { class: 'barra' }, [
        el('div', { class: 'barra__preenchimento',
          style: 'width:' + largura.toFixed(1) + '%;background:' + (total.color || '#6B7280') }),
      ]),
    ]);
  })));

  return seccao;
}

export function desenharEtiquetas(etiquetas, accoes = {}, extras = {}) {
  const fragmento = document.createDocumentFragment();
  const { totais = [], contas = [] } = extras;

  fragmento.append(
    abas(ABAS_GESTAO, 'etiquetas'),
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Etiquetas' }),
      etiquetas.length
        ? el('button', { class: 'btn btn--primario', type: 'button', text: 'Nova etiqueta',
            onclick: () => accoes.nova && accoes.nova() })
        : null,
    ]),
  );

  if (!etiquetas.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio(
        'Ainda não há etiquetas. Servem para marcar movimentos que atravessam categorias, '
        + 'como "férias" ou "obra".',
        'Criar a primeira etiqueta',
        () => accoes.nova && accoes.nova(),
      ),
    ]));
    return fragmento;
  }

  fragmento.append(seccaoTotais(totais, contas, accoes.recarregar));

  fragmento.append(el('div', { class: 'cabecalho' }, [
    el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Gerir etiquetas' }),
  ]));

  fragmento.append(el('ul', { class: 'lista cartao' }, etiquetas.map((etiqueta) =>
    el('li', { class: 'lista__linha' }, [
      el('div', { class: 'lista__principal' }, [
        el('span', { class: 'chip' }, [
          el('span', { class: 'chip__ponto', style: 'background:' + (etiqueta.color || '#6B7280') }),
          el('span', { text: etiqueta.name }),
        ]),
      ]),
      el('div', { class: 'lista__accoes' }, [
        el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar',
          onclick: () => accoes.editar(etiqueta) }),
        el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar',
          onclick: () => accoes.apagar(etiqueta) }),
      ]),
    ]),
  )));

  return fragmento;
}

export async function montarEtiquetas(alvo) {
  const contas = await listarContas();

  async function recarregar() {
    const [etiquetas, totais] = await Promise.all([
      listarEtiquetas(),
      gastoPorEtiqueta(contexto.mes, contexto.conta),
    ]);

    alvo.replaceChildren(desenharEtiquetas(etiquetas, {
      nova:   () => novaEtiqueta(recarregar),
      editar: (t) => editarEtiqueta(t, recarregar),
      apagar: (t) => removerEtiqueta(t, recarregar),
      recarregar,
    }, { totais, contas }));
  }

  await recarregar();
}
