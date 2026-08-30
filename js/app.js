// -----------------------------------------------------------------------------
// Arranque da aplicacao e encaminhamento entre ecras.
//
// O conteudo so e montado depois de a sessao estar validada em AAL2 (ver
// auth.js). Antes disso o elemento #vista-app fica escondido e vazio, por isso
// nao ha nenhum dado no ecra sem sessao iniciada.
// -----------------------------------------------------------------------------
import { iniciarAuth, utilizadorActual } from './auth.js';
import { $, $$, el, avisar } from './ui.js';

const VISTA_POR_DEFEITO = 'dashboard';

/**
 * Registo de ecras. Os modulos sao carregados a pedido, para o primeiro
 * arranque nao ter de descarregar codigo de ecras que nao vao ser abertos.
 *
 * "nav" indica qual o destino da barra de navegacao a marcar como activo:
 * categorias e etiquetas vivem dentro de Contas.
 */
const vistas = {
  dashboard: {
    titulo: 'Resumo',
    nav: 'dashboard',
    montar: async (alvo) => (await import('./dashboard.js')).montarResumo(alvo),
  },
  movimentos: {
    titulo: 'Movimentos',
    nav: 'movimentos',
    montar: async (alvo) => (await import('./transactions.js')).montarMovimentos(alvo),
  },
  orcamentos: {
    titulo: 'Orçamento',
    nav: 'orcamentos',
    montar: async (alvo) => (await import('./budgets.js')).montarOrcamentos(alvo),
  },
  contas: {
    titulo: 'Contas',
    nav: 'contas',
    montar: async (alvo) => (await import('./accounts.js')).montarContas(alvo),
  },
  categorias: {
    titulo: 'Categorias',
    nav: 'contas',
    montar: async (alvo) => (await import('./categories.js')).montarCategorias(alvo),
  },
  etiquetas: {
    titulo: 'Etiquetas',
    nav: 'contas',
    montar: async (alvo) => (await import('./tags.js')).montarEtiquetas(alvo),
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
  const alvo = $('#conteudo');
  marcarNavegacaoActiva(nome);
  document.title = vistas[nome].titulo + ' — GestFi';

  alvo.replaceChildren(el('p', { class: 'espera', text: 'A carregar…' }));
  try {
    await vistas[nome].montar(alvo);
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
