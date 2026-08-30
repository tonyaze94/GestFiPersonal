// -----------------------------------------------------------------------------
// Ecra "Resumo": saldo das contas e, para o mes escolhido, quanto saiu por
// categoria comparado com o orcamento definido.
//
// Todas as somas vem das funcoes de agregacao do Postgres (ver db.js). Os
// movimentos ocultos da analise entram no saldo das contas -- e dinheiro que
// se moveu -- mas ficam de fora dos totais do mes e dos graficos.
// -----------------------------------------------------------------------------
import {
  saldosPorConta, resumoDoMes, gastoPorCategoria, listarContas,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio } from './ui.js';
import { formatMoney, rotuloMes, hojeISO, primeiroDiaDoMes } from './format.js';
import { anelPorCategoria } from './charts.js';

/** Mes e conta em analise, mantidos entre visitas ao ecra. */
export const contexto = {
  mes: primeiroDiaDoMes(hojeISO()),
  conta: '',
};

// -----------------------------------------------------------------------------
// Selectores partilhados com o ecra de orcamento
// -----------------------------------------------------------------------------

function deslocarMes(iso, meses) {
  const [ano, mes] = iso.split('-').map(Number);
  const total = (ano * 12) + (mes - 1) + meses;
  const novoAno = Math.floor(total / 12);
  const novoMes = String((total % 12) + 1).padStart(2, '0');
  return `${novoAno}-${novoMes}-01`;
}

/** Barra com o mes (anterior/seguinte) e a conta em analise. */
export function selectorContexto(contas, aoMudar) {
  const selectorConta = el('select', { class: 'contexto__conta', 'aria-label': 'Conta' });
  for (const opcao of [{ id: '', name: 'Todas as contas' }, ...contas]) {
    const item = el('option', { value: opcao.id, text: opcao.name });
    if (opcao.id === contexto.conta) item.selected = true;
    selectorConta.append(item);
  }
  selectorConta.addEventListener('change', () => {
    contexto.conta = selectorConta.value;
    aoMudar();
  });

  return el('div', { class: 'contexto' }, [
    el('div', { class: 'contexto__mes' }, [
      el('button', {
        class: 'btn btn--pequeno', type: 'button', text: '‹',
        'aria-label': 'Mês anterior',
        onclick: () => { contexto.mes = deslocarMes(contexto.mes, -1); aoMudar(); },
      }),
      el('span', { class: 'contexto__rotulo', text: rotuloMes(contexto.mes) }),
      el('button', {
        class: 'btn btn--pequeno', type: 'button', text: '›',
        'aria-label': 'Mês seguinte',
        onclick: () => { contexto.mes = deslocarMes(contexto.mes, 1); aoMudar(); },
      }),
    ]),
    selectorConta,
  ]);
}

// -----------------------------------------------------------------------------
// Componentes
// -----------------------------------------------------------------------------

function cartaoNumero(rotulo, valor, classe) {
  return el('div', { class: 'numero' }, [
    el('span', { class: 'numero__rotulo', text: rotulo }),
    el('span', { class: 'numero__valor ' + (classe || ''), text: valor }),
  ]);
}

/** Barra de progresso que muda de cor conforme se aproxima do limite. */
export function barraOrcamento(gasto, orcamento) {
  const razao = orcamento > 0 ? gasto / orcamento : 0;
  const percentagem = Math.min(razao, 1) * 100;

  let estado = '';
  if (razao > 1) estado = ' barra--excede';
  else if (razao >= 0.9) estado = ' barra--perto';

  return el('div', { class: 'barra' + estado }, [
    el('div', { class: 'barra__preenchimento', style: 'width:' + percentagem.toFixed(1) + '%' }),
  ]);
}

/** Uma categoria: gasto, orçamento e barra, com clique para ver os movimentos. */
function linhaCategoria(linha, aoAbrir) {
  const gasto = Number(linha.spent) || 0;
  const orcamento = linha.budget == null ? null : Number(linha.budget);
  const excede = orcamento != null && gasto > orcamento;

  const direita = el('div', { class: 'categoria__valores' }, [
    el('span', { class: 'valor', text: formatMoney(gasto) }),
    orcamento != null
      ? el('span', { class: 'categoria__orcamento' + (excede ? ' categoria__orcamento--excede' : ''),
          text: 'de ' + formatMoney(orcamento) })
      : null,
  ]);

  return el('button', {
    class: 'categoria', type: 'button',
    title: 'Ver os movimentos desta categoria neste mês',
    onclick: () => aoAbrir(linha),
  }, [
    el('div', { class: 'categoria__topo' }, [
      el('span', { class: 'chip' }, [
        el('span', { class: 'chip__ponto', style: 'background:' + (linha.color || '#6B7280') }),
        el('span', { text: linha.category_name }),
      ]),
      direita,
    ]),
    orcamento != null ? barraOrcamento(gasto, orcamento) : null,
  ]);
}

// -----------------------------------------------------------------------------
// Desenho
// -----------------------------------------------------------------------------

export function desenharResumo({ contas, saldos, resumo, categorias }, accoes = {}) {
  const fragmento = document.createDocumentFragment();

  const saidas = categorias.filter((c) => c.kind === 'despesa' && Number(c.spent) > 0);
  const entradas = categorias.filter((c) => c.kind === 'receita' && Number(c.spent) > 0);

  // Saldo: o da conta escolhida, ou a soma de todas.
  const relevantes = contexto.conta
    ? saldos.filter((s) => s.account_id === contexto.conta)
    : saldos;
  const saldoTotal = relevantes.reduce((soma, s) => soma + Number(s.balance || 0), 0);

  fragmento.append(
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Resumo' }),
    ]),
    selectorContexto(contas, accoes.recarregar),

    el('div', { class: 'numeros cartao' }, [
      cartaoNumero(contexto.conta ? 'Saldo da conta' : 'Saldo de todas as contas',
        formatMoney(saldoTotal), saldoTotal < 0 ? 'valor--negativo' : ''),
      cartaoNumero('Entradas do mês',
        formatMoney(resumo.total_receitas), 'valor--positivo'),
      cartaoNumero('Saídas do mês',
        formatMoney(resumo.total_despesas), 'valor--negativo'),
    ]),
  );

  // Saldo por conta, quando se está a ver o agregado.
  if (!contexto.conta && saldos.length > 1) {
    fragmento.append(el('div', { class: 'cartao' }, [
      el('h2', { class: 'cartao__titulo', text: 'Por conta' }),
      el('ul', { class: 'lista' }, saldos.map((s) =>
        el('li', { class: 'lista__linha' }, [
          el('div', { class: 'lista__principal' }, [
            el('span', { class: 'lista__nome', text: s.name }),
          ]),
          el('span', {
            class: 'valor lista__valor' + (Number(s.balance) < 0 ? ' valor--negativo' : ''),
            text: formatMoney(s.balance),
          }),
        ]))),
    ]));
  }

  if (!categorias.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio(
        'Ainda não há movimentos em ' + rotuloMes(contexto.mes)
        + (contexto.conta ? ' nesta conta.' : '.'),
        'Registar um movimento',
        () => accoes.novoMovimento && accoes.novoMovimento(),
      ),
    ]));
    return fragmento;
  }

  if (saidas.length) {
    const tela = el('canvas', { 'aria-label': 'Peso de cada categoria nas saídas do mês' });
    fragmento.append(el('div', { class: 'cartao' }, [
      el('h2', { class: 'cartao__titulo', text: 'Saídas por categoria' }),
      el('div', { class: 'grafico' }, [tela]),
    ]));
    // O gráfico só pode ser criado depois de o canvas estar no documento.
    accoes.aoMontar && accoes.aoMontar(() => anelPorCategoria(
      tela,
      saidas.map((c) => ({ nome: c.category_name, valor: Number(c.spent), cor: c.color || '#6B7280' })),
      (v) => formatMoney(v),
    ));

    fragmento.append(el('div', { class: 'cartao' }, [
      el('h2', { class: 'cartao__titulo', text: 'Saídas e orçamento' }),
      el('div', { class: 'categorias' }, saidas.map((c) => linhaCategoria(c, accoes.abrir))),
    ]));
  }

  if (entradas.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      el('h2', { class: 'cartao__titulo', text: 'Entradas por categoria' }),
      el('div', { class: 'categorias' }, entradas.map((c) => linhaCategoria(c, accoes.abrir))),
    ]));
  }

  return fragmento;
}

// -----------------------------------------------------------------------------
// Ligacao ao ecra
// -----------------------------------------------------------------------------

/** Ultimo dia do mes, para o filtro de datas do detalhe. */
function fimDoMes(iso) {
  const [ano, mes] = iso.split('-').map(Number);
  const dias = new Date(ano, mes, 0).getDate();
  return `${iso.slice(0, 7)}-${String(dias).padStart(2, '0')}`;
}

export async function montarResumo(alvo) {
  const contas = await listarContas();

  async function recarregar() {
    const [saldos, resumo, categorias] = await Promise.all([
      saldosPorConta(),
      resumoDoMes(contexto.mes, contexto.conta),
      gastoPorCategoria(contexto.mes, contexto.conta),
    ]);

    const porDesenhar = [];

    alvo.replaceChildren(desenharResumo({ contas, saldos, resumo, categorias }, {
      recarregar,
      aoMontar: (fn) => porDesenhar.push(fn),
      novoMovimento: () => { location.hash = '#/movimentos'; },
      abrir: async (linha) => {
        // Leva os movimentos desta categoria, neste mês e nesta conta.
        const { definirFiltros } = await import('./transactions.js');
        definirFiltros({
          conta: contexto.conta,
          categoria: linha.category_id || 'sem',
          de: contexto.mes,
          ate: fimDoMes(contexto.mes),
          estado: 'visiveis',
        });
        location.hash = '#/movimentos';
      },
    }));

    // Os gráficos só depois de o conteúdo estar no documento.
    for (const desenhar of porDesenhar) desenhar();
  }

  await recarregar();
}
