// -----------------------------------------------------------------------------
// Arranque da aplicacao e encaminhamento entre ecras.
//
// O conteudo so e montado depois de a sessao estar validada em AAL2 (ver
// auth.js). Antes disso o elemento #vista-app fica escondido e vazio, por isso
// nao ha nenhum dado no ecra sem sessao iniciada.
// -----------------------------------------------------------------------------
import { iniciarAuth, utilizadorActual } from './auth.js';
import { $, $$, el, avisar, abas, ABAS_CARTEIRA } from './ui.js';

const VISTA_POR_DEFEITO = 'dashboard';

/**
 * Registo de ecras. Os modulos sao carregados a pedido, para o primeiro
 * arranque nao ter de descarregar codigo de ecras que nao vao ser abertos.
 *
 * "nav" indica qual o destino da barra de navegacao a marcar como activo.
 * Os ecras com "aba" vivem dentro do menu Carteira: o encaminhador desenha por
 * cima deles os separadores ABAS_CARTEIRA, com essa aba marcada. Contas,
 * categorias/orcamento e etiquetas sao sub-separadores de Definicoes.
 */
const vistas = {
  dashboard: {
    titulo: 'Resumo',
    nav: 'carteira',
    aba: 'dashboard',
    montar: async (alvo) => (await import('./dashboard.js')).montarResumo(alvo),
  },
  movimentos: {
    titulo: 'Movimentos',
    nav: 'carteira',
    aba: 'movimentos',
    montar: async (alvo) => (await import('./transactions.js')).montarMovimentos(alvo),
  },
  orcamentos: {
    titulo: 'Orçamento',
    nav: 'carteira',
    aba: 'orcamentos',
    montar: async (alvo) => (await import('./budgets.js')).montarOrcamentos(alvo),
  },
  contas: {
    titulo: 'Contas',
    nav: 'carteira',
    aba: 'contas',
    montar: async (alvo) => (await import('./accounts.js')).montarContas(alvo),
  },
  'definicoes-orcamento': {
    titulo: 'Definições de orçamento',
    nav: 'carteira',
    aba: 'contas',
    montar: async (alvo) => (await import('./categories.js')).montarCategorias(alvo),
  },
  // endereco antigo das categorias, agora dentro de Definicoes > Orcamento
  categorias: {
    titulo: 'Definições de orçamento',
    nav: 'carteira',
    aba: 'contas',
    montar: async (alvo) => (await import('./categories.js')).montarCategorias(alvo),
  },
  etiquetas: {
    titulo: 'Etiquetas',
    nav: 'carteira',
    aba: 'contas',
    montar: async (alvo) => (await import('./tags.js')).montarEtiquetas(alvo),
  },
  ativos: {
    titulo: 'Ativos',
    nav: 'ativos',
    // sub-navegacao propria (#/ativos/grupo/<id>, /ativo/<id>, /analise, /config):
    // montarAtivos le o hash completo, por isso e chamada de novo em qualquer
    // sub-mudanca, sem precisar de entradas separadas neste registo.
    montar: async (alvo) => (await import('./assets.js')).montarAtivos(alvo),
  },
};

/** Nome do ecra a partir do endereco (#/movimentos -> movimentos). */
function vistaActual() {
  const nome = location.hash.replace(/^#\/?/, '').split('/')[0];
  return vistas[nome] ? nome : VISTA_POR_DEFEITO;
}

function marcarNavegacaoActiva(nome) {
  const destino = vistas[nome].nav;
  for (const item of $$('.nav__item[data-vista]')) {
    if (item.dataset.vista === destino) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

async function desenhar() {
  const nome = vistaActual();
  const vista = vistas[nome];
  const conteudo = $('#conteudo');
  marcarNavegacaoActiva(nome);
  document.title = vista.titulo + ' — GestFi';

  // Nos ecras da Carteira os separadores ficam fora do alvo entregue ao ecra:
  // cada ecra faz replaceChildren() no seu alvo sem os apagar.
  let alvo = conteudo;
  if (vista.aba) {
    alvo = el('div', { class: 'carteira__ecra' });
    conteudo.replaceChildren(abas(ABAS_CARTEIRA, vista.aba), alvo);
  }

  alvo.replaceChildren(el('p', { class: 'espera', text: 'A carregar…' }));
  try {
    await vista.montar(alvo);
  } catch (erro) {
    console.error(erro);
    alvo.replaceChildren(el('p', { class: 'espera', text: 'Não foi possível carregar este ecrã.' }));
  }
}

/** Chamado por auth.js assim que a sessao esta validada. */
async function arrancarApp() {
  window.addEventListener('hashchange', desenhar);
  if (!location.hash) location.hash = '#/' + VISTA_POR_DEFEITO;
  await desenhar();

  const utilizador = await utilizadorActual();
  if (utilizador) console.info('Sessão iniciada:', utilizador.email);
}

// -----------------------------------------------------------------------------
// PWA
// -----------------------------------------------------------------------------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((erro) => {
      console.warn('Service worker não registado:', erro);
    });
  });
}

// -----------------------------------------------------------------------------
// Arranque
// -----------------------------------------------------------------------------

iniciarAuth(arrancarApp).catch((erro) => {
  console.error(erro);
  avisar('Não foi possível contactar o servidor.', 'erro');
});
