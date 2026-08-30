// -----------------------------------------------------------------------------
// Ecra "Contas": criar, editar e apagar contas.
//
// O saldo mostrado nesta fase e o saldo inicial. O saldo actual (inicial mais a
// soma dos movimentos) e agregado do lado da base de dados e entra com o ecra
// de resumo, no passo seguinte.
// -----------------------------------------------------------------------------
import {
  listarContas, criarConta, actualizarConta, apagarConta,
  contarMovimentosDaConta, criarContasEmLote,
  TIPOS_CONTA, etiquetaTipoConta,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio, abas } from './ui.js';
import { dialogoFormulario, dialogoConfirmar } from './modal.js';
import { formatMoney } from './format.js';

/** Contas de partida, criadas de uma vez atraves da propria aplicacao. */
const CONTAS_SUGERIDAS = [
  { name: 'Conta Corrente', type: 'conta_corrente', currency: 'EUR', initial_balance: 0 },
  { name: 'Poupança',       type: 'poupanca',       currency: 'EUR', initial_balance: 0 },
  { name: 'Investimentos',  type: 'investimento',   currency: 'EUR', initial_balance: 0 },
];

export const ABAS_GESTAO = [
  { nome: 'Contas',     destino: 'contas' },
  { nome: 'Categorias', destino: 'categorias' },
  { nome: 'Etiquetas',  destino: 'etiquetas' },
];

// -----------------------------------------------------------------------------
// Formulario
// -----------------------------------------------------------------------------

function camposConta(conta = {}) {
  return [
    { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: conta.name || '',
      obrigatorio: true, maximo: 60 },
    { nome: 'type', etiqueta: 'Tipo', tipo: 'seleccao', valor: conta.type || 'conta_corrente',
      opcoes: TIPOS_CONTA },
    { nome: 'initial_balance', etiqueta: 'Saldo inicial', tipo: 'number',
      valor: conta.initial_balance ?? '0',
      ajuda: 'O saldo da conta antes do primeiro movimento registado.' },
    { nome: 'currency', etiqueta: 'Moeda', tipo: 'text', valor: conta.currency || 'EUR',
      obrigatorio: true, maximo: 3 },
  ];
}

/** Converte o que veio do formulario para o formato da base de dados. */
function normalizar(valores) {
  const saldo = Number(String(valores.initial_balance).replace(',', '.'));
  return {
    name: valores.name,
    type: valores.type,
    initial_balance: Number.isFinite(saldo) ? saldo : 0,
    currency: (valores.currency || 'EUR').toUpperCase().slice(0, 3),
  };
}

async function novaConta(recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Nova conta',
    campos: camposConta(),
    confirmar: 'Criar conta',
  });
  if (!valores) return;

  try {
    await criarConta(normalizar(valores));
    avisar('Conta criada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function editarConta(conta, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Editar conta',
    campos: camposConta(conta),
    confirmar: 'Guardar alterações',
  });
  if (!valores) return;

  try {
    await actualizarConta(conta.id, normalizar(valores));
    avisar('Conta atualizada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function removerConta(conta, recarregar) {
  let movimentos = 0;
  try {
    movimentos = await contarMovimentosDaConta(conta.id);
  } catch { /* se a contagem falhar, avisa-se na mesma de forma generica */ }

  const mensagem = movimentos > 0
    ? `A conta "${conta.name}" tem ${movimentos} movimento(s). Apagar a conta apaga também esses movimentos, de forma definitiva.`
    : `Apagar a conta "${conta.name}"? Esta ação não pode ser anulada.`;

  const confirmado = await dialogoConfirmar({
    titulo: 'Apagar conta',
    mensagem,
    confirmar: 'Apagar definitivamente',
  });
  if (!confirmado) return;

  try {
    await apagarConta(conta.id);
    avisar('Conta apagada.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

async function criarSugeridas(recarregar) {
  const confirmado = await dialogoConfirmar({
    titulo: 'Criar contas de partida',
    mensagem: 'Vão ser criadas as contas Conta Corrente, Poupança e Investimentos, '
            + 'todas com saldo inicial zero. Pode alterar os saldos a seguir.',
    confirmar: 'Criar as três',
    perigo: false,
  });
  if (!confirmado) return;

  try {
    // Insercao em lote: um unico pedido com as tres contas.
    await criarContasEmLote(CONTAS_SUGERIDAS);
    avisar('Contas criadas.', 'sucesso');
    await recarregar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
  }
}

// -----------------------------------------------------------------------------
// Desenho
// -----------------------------------------------------------------------------

/** Uma linha da lista de contas. Funcao pura: recebe dados, devolve elemento. */
export function linhaConta(conta, accoes = {}) {
  return el('li', { class: 'lista__linha' }, [
    el('div', { class: 'lista__principal' }, [
      el('span', { class: 'lista__nome', text: conta.name }),
      el('span', { class: 'lista__meta', text: etiquetaTipoConta(conta.type) }),
    ]),
    // Saldo a descoberto assinalado a vermelho. Um saldo positivo fica na cor
    // normal do texto: o verde e o sinal "+" ficam reservados para os
    // movimentos, onde marcam uma entrada de dinheiro.
    el('span', {
      class: 'valor lista__valor' + (Number(conta.initial_balance) < 0 ? ' valor--negativo' : ''),
      text: formatMoney(conta.initial_balance, { moeda: conta.currency === 'EUR' ? '€' : conta.currency }),
    }),
    el('div', { class: 'lista__accoes' }, [
      el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar',
        onclick: () => accoes.editar && accoes.editar(conta) }),
      el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar',
        onclick: () => accoes.apagar && accoes.apagar(conta) }),
    ]),
  ]);
}

/** Constroi o ecra completo a partir de uma lista de contas. */
export function desenharContas(contas, accoes = {}) {
  const fragmento = document.createDocumentFragment();

  fragmento.append(
    abas(ABAS_GESTAO, 'contas'),
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: 'Contas' }),
      contas.length
        ? el('button', { class: 'btn btn--primario', type: 'button', text: 'Nova conta',
            onclick: () => accoes.nova && accoes.nova() })
        : null,
    ]),
  );

  if (!contas.length) {
    fragmento.append(el('div', { class: 'cartao' }, [
      estadoVazio(
        'Ainda não há contas. Crie as três contas de partida de uma vez, ou adicione-as uma a uma.',
        'Criar contas de partida',
        () => accoes.sugeridas && accoes.sugeridas(),
      ),
      el('div', { class: 'vazio__alternativa' }, [
        el('button', { class: 'btn btn--texto', type: 'button', text: 'Prefiro criar uma conta manualmente',
          onclick: () => accoes.nova && accoes.nova() }),
      ]),
    ]));
    return fragmento;
  }

  const total = contas.reduce((soma, c) => soma + Number(c.initial_balance || 0), 0);

  fragmento.append(
    el('ul', { class: 'lista cartao' }, contas.map((c) => linhaConta(c, accoes))),
    el('p', { class: 'lista__rodape' }, [
      'Soma dos saldos iniciais: ',
      el('span', { class: 'valor', text: formatMoney(total) }),
    ]),
  );

  return fragmento;
}

// -----------------------------------------------------------------------------
// Ligacao ao ecra
// -----------------------------------------------------------------------------

export async function montarContas(alvo) {
  async function recarregar() {
    const contas = await listarContas();
    alvo.replaceChildren(desenharContas(contas, {
      nova:      () => novaConta(recarregar),
      editar:    (c) => editarConta(c, recarregar),
      apagar:    (c) => removerConta(c, recarregar),
      sugeridas: () => criarSugeridas(recarregar),
    }));
  }
  await recarregar();
}
