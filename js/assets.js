// -----------------------------------------------------------------------------
// Ecra "Ativos": acompanhamento de investimentos (ex: compra/venda de carros)
// partilhados com parceiros, cada um com uma percentagem do lucro.
//
// Sub-navegacao por hash (#/ativos, #/ativos/grupo/<id>, #/ativos/ativo/<id>,
// #/ativos/analise, #/ativos/config). O app.js volta a chamar montarAtivos()
// em qualquer mudanca de hash que comece por "ativos" -- e essa remontagem e
// que faz de router. Como cada passo usa um <a href="#/..."> ou
// location.hash normal, o botao Voltar do browser anda para tras dentro da
// app em vez de a fechar ou saltar para o login (era esse o defeito da app
// antiga, que nunca tocava no historico do browser).
// -----------------------------------------------------------------------------
import {
  listarGruposAtivos, criarGrupoAtivos, actualizarGrupoAtivos, apagarGrupoAtivos,
  listarParceirosAtivos, criarParceiroAtivos, actualizarParceiroAtivos, apagarParceiroAtivos,
  listarCategoriasAtivos, criarCategoriaAtivos, actualizarCategoriaAtivos, apagarCategoriaAtivos,
  contarMovimentosDaCategoriaAtivos, obterOuCriarCategoriaAtivos,
  listarAtivos, listarTodosAtivos, obterAtivo, criarAtivo, actualizarAtivo, apagarAtivo,
  listarPartesAtivo, definirPartesAtivo,
  listarMovimentosAtivo, listarTodosMovimentosAtivos,
  criarMovimentoAtivo, actualizarMovimentoAtivo, apagarMovimentoAtivo, definirParceirosMovimento,
  TIPOS_MOVIMENTO_ATIVO, ESTADOS_ATIVO,
} from './db.js';
import { el, avisar, traduzErro, estadoVazio, abas } from './ui.js';
import { dialogoConfirmar, dialogoFormulario } from './modal.js';
import { formatMoney, formatDate, classeValor, hojeISO, nomeMes } from './format.js';
import { linhasEvolucao } from './charts.js';

const ABAS_ATIVOS = [
  { nome: 'Resumo', destino: 'ativos' },
  { nome: 'Análise', destino: 'ativos/analise' },
  { nome: 'Configurações', destino: 'ativos/config' },
];

// -----------------------------------------------------------------------------
// Numeros
// -----------------------------------------------------------------------------

function numOuNulo(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function pctOuDefeito(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 100; }
function arred2(v) { return Math.round((parseFloat(v) || 0) * 100) / 100; }
function soma(lista, campo) { return lista.reduce((s, x) => s + Number(x[campo] || 0), 0); }

/** O movimento pode ter uma parte propria diferente do valor total. */
function valorProprio(m) { return m.own_amount != null ? Number(m.own_amount) : Number(m.amount); }

function lucroPrevisto(ativo, custoTotal) {
  const previsto = numOuNulo(ativo?.expected_sale_value);
  if (previsto === null) return null;
  const pct = pctOuDefeito(ativo?.profit_pct);
  return (previsto - custoTotal) * (pct / 100);
}

// -----------------------------------------------------------------------------
// Roteamento interno
// -----------------------------------------------------------------------------

function segmentos() {
  return location.hash.replace(/^#\/?/, '').split('/').slice(1);
}

export async function montarAtivos(alvo) {
  const [seg, id] = segmentos();
  if (seg === 'grupo' && id) return montarGrupo(alvo, id);
  if (seg === 'ativo' && id) return montarFicha(alvo, id);
  if (seg === 'analise') return montarAnalise(alvo);
  if (seg === 'config') return montarConfig(alvo);
  return montarResumo(alvo);
}

// -----------------------------------------------------------------------------
// Componentes partilhados
// -----------------------------------------------------------------------------

function cartaoNumero(rotulo, valor, classeExtra = '') {
  return el('div', { class: 'numero' }, [
    el('span', { class: 'numero__rotulo', text: rotulo }),
    el('span', { class: 'numero__valor ' + classeExtra, text: valor }),
  ]);
}

function linhaResumo(rotulo, valor) {
  return el('div', { class: 'lista__linha', style: 'border-bottom:none;padding:5px 0;' }, [
    el('span', { class: 'lista__meta', text: rotulo }),
    el('span', { class: 'valor', text: valor }),
  ]);
}

function itemGrelha(rotulo, valor, classeExtra = '') {
  return el('div', { class: 'grelha2__item' }, [
    el('div', { class: 'grelha2__rotulo', text: rotulo }),
    el('div', { class: 'grelha2__valor ' + classeExtra, text: valor }),
  ]);
}

function cabecalhoComVoltar(voltarPara, tituloVoltar, titulo, accoesExtra = []) {
  return el('div', {}, [
    el('a', { class: 'btn btn--pequeno', href: '#/' + voltarPara, text: '‹ ' + tituloVoltar,
      style: 'display:inline-block;margin-bottom:10px;' }),
    el('div', { class: 'cabecalho' }, [
      el('h1', { class: 'cabecalho__titulo', text: titulo }),
      ...accoesExtra,
    ]),
  ]);
}

// -----------------------------------------------------------------------------
// Resumo (dashboard dos ativos)
// -----------------------------------------------------------------------------

async function montarResumo(alvo) {
  async function recarregar() {
    const [grupos, todosAtivos, todosMovimentos] = await Promise.all([
      listarGruposAtivos(), listarTodosAtivos(), listarTodosMovimentosAtivos(),
    ]);

    const custoTotalPorAtivo = {}, meuCustoPorAtivo = {}, minhaReceitaPorAtivo = {};
    for (const m of todosMovimentos) {
      const vp = valorProprio(m);
      custoTotalPorAtivo[m.asset_id] ??= 0;
      meuCustoPorAtivo[m.asset_id] ??= 0;
      minhaReceitaPorAtivo[m.asset_id] ??= 0;
      if (m.kind === 'custo') { custoTotalPorAtivo[m.asset_id] += Number(m.amount); meuCustoPorAtivo[m.asset_id] += vp; }
      else minhaReceitaPorAtivo[m.asset_id] += vp;
    }

    let investidoCarteira = 0, lucroPrevistoTotal = 0, lucroRealizado = 0, balancoTotal = 0, emCarteiraCount = 0;
    const porGrupo = new Map(grupos.map((g) => [g.id,
      { investido: 0, lucroPrevisto: 0, lucroRealizado: 0, balanco: 0, carteira: 0 }]));
    for (const a of todosAtivos) {
      const custo = meuCustoPorAtivo[a.id] || 0;
      const receita = minhaReceitaPorAtivo[a.id] || 0;
      balancoTotal += receita - custo;
      const acc = porGrupo.get(a.group_id);
      if (acc) acc.balanco += receita - custo;
      if (a.status === 'em_carteira') {
        emCarteiraCount++;
        investidoCarteira += custo;
        const lucro = lucroPrevisto(a, custoTotalPorAtivo[a.id] || 0);
        if (lucro !== null) lucroPrevistoTotal += lucro;
        if (acc) {
          acc.carteira++;
          acc.investido += custo;
          if (lucro !== null) acc.lucroPrevisto += lucro;
        }
      } else {
        // Ja vendido (ou trocado): a diferenca entre o que recebi e o que
        // gastei neste ativo e lucro real, ja fechado -- ao contrario do
        // "balanco total", que baixa enquanto houver dinheiro parado em
        // ativos ainda por vender.
        lucroRealizado += receita - custo;
        if (acc) acc.lucroRealizado += receita - custo;
      }
    }

    const fragmento = document.createDocumentFragment();
    fragmento.append(
      abas(ABAS_ATIVOS, 'ativos'),
      el('div', { class: 'cabecalho' }, [el('h1', { class: 'cabecalho__titulo', text: 'Ativos' })]),
      el('div', { class: 'numeros cartao' }, [
        cartaoNumero('Ativos em carteira', String(emCarteiraCount)),
        cartaoNumero('Meu investido (por vender)', formatMoney(investidoCarteira)),
        cartaoNumero('Meu lucro previsto (por vender)', formatMoney(lucroPrevistoTotal), classeValor(lucroPrevistoTotal)),
        cartaoNumero('Meu lucro já realizado', formatMoney(lucroRealizado, { sinal: true }), classeValor(lucroRealizado)),
      ]),
      el('p', { class: 'contexto__nota',
        text: 'O investido em ativos por vender conta a menos até serem vendidos — não é dinheiro perdido, é '
            + 'capital parado. Balanço agregado (realizado − investido por vender): '
            + formatMoney(balancoTotal, { sinal: true }) + '.' }),
    );

    if (!grupos.length) {
      fragmento.append(el('div', { class: 'cartao' }, [
        estadoVazio('Ainda não há grupos de ativos.', 'Criar grupo', () => novoGrupo(recarregar)),
      ]));
      alvo.replaceChildren(fragmento);
      return;
    }

    fragmento.append(el('div', { class: 'cartao' }, [
      el('div', { class: 'cabecalho' }, [
        el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Grupos' }),
        el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Adicionar',
          onclick: () => novoGrupo(recarregar) }),
      ]),
      el('ul', { class: 'lista' }, grupos.map((g) => {
        const acc = porGrupo.get(g.id);
        return el('li', { class: 'lista__linha' }, [
          el('div', { class: 'lista__principal' }, [
            el('a', { class: 'lista__nome', href: '#/ativos/grupo/' + g.id, text: g.name }),
            el('span', { class: 'lista__meta',
              text: acc.carteira + ' em carteira · investido ' + formatMoney(acc.investido) }),
          ]),
          el('div', { class: 'lista__accoes' }, [
            el('span', { class: classeValor(acc.lucroRealizado) + ' lista__valor',
              text: formatMoney(acc.lucroRealizado, { sinal: true }) }),
            el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar',
              onclick: () => editarGrupo(g, recarregar) }),
          ]),
        ]);
      })),
    ]));

    alvo.replaceChildren(fragmento);
  }

  await recarregar();
}

async function novoGrupo(recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Novo grupo de ativos',
    campos: [
      { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: '', obrigatorio: true, maximo: 60 },
      { nome: 'description', etiqueta: 'Descrição (opcional)', tipo: 'text', valor: '' },
    ],
    confirmar: 'Criar grupo',
  });
  if (!valores) return;
  try {
    await criarGrupoAtivos({ name: valores.name, description: valores.description || null });
    avisar('Grupo criado.', 'sucesso');
    await recarregar();
  } catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function editarGrupo(grupo, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Editar grupo',
    campos: [
      { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: grupo.name, obrigatorio: true, maximo: 60 },
      { nome: 'description', etiqueta: 'Descrição (opcional)', tipo: 'text', valor: grupo.description || '' },
    ],
    confirmar: 'Guardar alterações',
  });
  if (!valores) return;
  try {
    await actualizarGrupoAtivos(grupo.id, { name: valores.name, description: valores.description || null });
    avisar('Grupo atualizado.', 'sucesso');
    await recarregar();
  } catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function apagarGrupo(grupo, aoTerminar) {
  const confirmado = await dialogoConfirmar({
    titulo: 'Apagar grupo',
    mensagem: `Apagar o grupo "${grupo.name}" e todos os seus ativos e movimentos? Esta ação não pode ser desfeita.`,
    confirmar: 'Apagar tudo',
  });
  if (!confirmado) return;
  try {
    await apagarGrupoAtivos(grupo.id);
    avisar('Grupo apagado.', 'sucesso');
    await aoTerminar();
  } catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

// -----------------------------------------------------------------------------
// Grupo: lista de ativos
// -----------------------------------------------------------------------------

const POR_PAGINA_VENDIDOS = 10;

async function montarGrupo(alvo, grupoId) {
  const [grupos, ativosDoGrupo, todosMovimentos, parceiros] = await Promise.all([
    listarGruposAtivos(), listarAtivos(grupoId), listarTodosMovimentosAtivos(), listarParceirosAtivos(),
  ]);
  const grupo = grupos.find((g) => g.id === grupoId);

  const movPorAtivo = new Map();
  for (const m of todosMovimentos) {
    if (!movPorAtivo.has(m.asset_id)) movPorAtivo.set(m.asset_id, []);
    movPorAtivo.get(m.asset_id).push(m);
  }

  function calcular(a) {
    const movs = movPorAtivo.get(a.id) || [];
    const custos = movs.filter((m) => m.kind === 'custo');
    const receitas = movs.filter((m) => m.kind === 'receita');
    const custo = soma(custos, 'amount');
    const receita = soma(receitas, 'amount');
    const custoP = custos.reduce((s, m) => s + valorProprio(m), 0);
    const receitaP = receitas.reduce((s, m) => s + valorProprio(m), 0);
    return {
      custo, receita, custoP, receitaP,
      lucroPrevistoProprio: lucroPrevisto(a, custo),
      lucroRealTotal: receita - custo,
      lucroRealProprio: receitaP - custoP,
    };
  }

  function cartaoAtivo(a) {
    const c = calcular(a);
    return el('a', { class: 'ativo-cartao', href: '#/ativos/ativo/' + a.id }, [
      el('div', { class: 'ativo-cartao__topo' }, [
        el('div', {}, [
          el('div', { class: 'ativo-cartao__nome', text: a.name }),
          a.description ? el('div', { class: 'ativo-cartao__desc', text: a.description }) : null,
        ]),
        el('span', { class: 'marca' + (a.status === 'em_carteira' ? '' : ' marca--fraca'),
          text: a.status === 'em_carteira' ? 'Em carteira' : 'Vendido' }),
      ]),
      el('div', { class: 'grelha2' }, a.status === 'em_carteira' ? [
        itemGrelha('Meu custo', formatMoney(c.custoP)),
        itemGrelha('Meu lucro previsto', c.lucroPrevistoProprio != null ? formatMoney(c.lucroPrevistoProprio) : '—',
          c.lucroPrevistoProprio != null ? classeValor(c.lucroPrevistoProprio) : ''),
        itemGrelha('Valor previsto venda', a.expected_sale_value != null ? formatMoney(a.expected_sale_value) : '—'),
        itemGrelha('Total investido', formatMoney(c.custo)),
      ] : [
        itemGrelha('Minha receita', formatMoney(c.receitaP)),
        itemGrelha('Meu lucro real', formatMoney(c.lucroRealProprio), classeValor(c.lucroRealProprio)),
        itemGrelha('Valor vendido', formatMoney(c.receita)),
        itemGrelha('Lucro real do ativo', formatMoney(c.lucroRealTotal), classeValor(c.lucroRealTotal)),
      ]),
    ]);
  }

  const emCarteira = ativosDoGrupo.filter((a) => a.status === 'em_carteira');
  const vendidos = ativosDoGrupo.filter((a) => a.status !== 'em_carteira');
  let offsetVendidos = POR_PAGINA_VENDIDOS;

  function desenhar() {
    const fragmento = document.createDocumentFragment();
    fragmento.append(cabecalhoComVoltar('ativos', 'Grupos', grupo ? grupo.name : 'Ativos', [
      el('button', { class: 'btn btn--primario btn--pequeno', type: 'button', text: '+ Novo ativo',
        onclick: () => novoAtivo(grupoId, parceiros, () => montarGrupo(alvo, grupoId)) }),
    ]));

    if (!ativosDoGrupo.length) {
      fragmento.append(el('div', { class: 'cartao' }, [
        estadoVazio('Sem ativos neste grupo.', 'Novo ativo',
          () => novoAtivo(grupoId, parceiros, () => montarGrupo(alvo, grupoId))),
      ]));
      alvo.replaceChildren(fragmento);
      return;
    }

    fragmento.append(emCarteira.length
      ? el('div', {}, emCarteira.map(cartaoAtivo))
      : el('p', { class: 'vazio__texto', text: 'Nenhum ativo em carteira.' }));

    if (vendidos.length) {
      const visiveis = vendidos.slice(0, offsetVendidos);
      fragmento.append(
        el('div', { class: 'separador', text: 'Vendidos (' + vendidos.length + ')' }),
        el('div', {}, visiveis.map(cartaoAtivo)),
      );
      if (offsetVendidos < vendidos.length) {
        fragmento.append(el('button', { class: 'btn btn--largo', type: 'button', text: 'Carregar mais vendidos',
          onclick: () => { offsetVendidos += POR_PAGINA_VENDIDOS; desenhar(); } }));
      }
    }
    alvo.replaceChildren(fragmento);
  }

  desenhar();
}

// -----------------------------------------------------------------------------
// Divisao de participantes -- usada no movimento e na troca
// -----------------------------------------------------------------------------

/**
 * Junta a minha parte e a de cada parceiro do ativo num so array,
 * com a percentagem de lucro e o que cada um ja teve de custo/receita.
 */
function construirParticipantes(movimentosAtivo, ativo, partesAtivo) {
  const minhaPct = pctOuDefeito(ativo?.profit_pct);
  const mapa = new Map();
  mapa.set('proprio', { chave: 'proprio', nome: 'A minha parte', pct: minhaPct, custo: 0, receita: 0 });
  for (const p of partesAtivo) {
    mapa.set('p' + p.partner_id, { chave: 'p' + p.partner_id, partner_id: p.partner_id, nome: p.name,
      pct: arred2(p.profit_pct), custo: 0, receita: 0 });
  }
  for (const m of movimentosAtivo) {
    const campo = m.kind === 'custo' ? 'custo' : 'receita';
    mapa.get('proprio')[campo] += valorProprio(m);
    for (const mp of (m.asset_movement_partners || [])) {
      const chave = 'p' + mp.partner_id;
      if (!mapa.has(chave)) {
        mapa.set(chave, { chave, partner_id: mp.partner_id,
          nome: mp.asset_partners ? mp.asset_partners.name : '?', pct: 0, custo: 0, receita: 0 });
      }
      mapa.get(chave)[campo] += Number(mp.amount);
    }
  }
  return [...mapa.values()];
}

/** Distribui um total pelos participantes, de acordo com a sua percentagem. */
function distribuirPorPct(total, participantes) {
  const pctTotal = participantes.reduce((s, p) => s + (parseFloat(p.pct) || 0), 0) || participantes.length;
  const valores = {};
  let somaAcumulada = 0;
  participantes.forEach((p, i) => {
    const bruto = pctTotal === participantes.length ? total / participantes.length : total * ((parseFloat(p.pct) || 0) / pctTotal);
    valores[p.chave] = i === participantes.length - 1 ? arred2(total - somaAcumulada) : arred2(bruto);
    somaAcumulada += valores[p.chave];
  });
  return valores;
}

// -----------------------------------------------------------------------------
// Dialogo de movimento (custo/receita) -- dinamico, por isso nao usa o
// dialogoFormulario generico: tem uma linha de valor por parceiro, que se
// reequilibra sozinha, e distribui automaticamente o lucro quando a
// categoria escolhida e uma "venda".
// -----------------------------------------------------------------------------

function abrirDialogoMovimento({ titulo, tipoInicial, categorias, ativo, movimentosAtivo, partesAtivo, movimentoExistente }) {
  return new Promise((resolve) => {
    let tipo = movimentoExistente ? movimentoExistente.kind : tipoInicial;
    let participantesMov = []; // [{ chave, partner_id, nome, valor }]

    const btnCusto = el('button', { type: 'button', class: 'alternador__opcao', text: '− Custo' });
    const btnReceita = el('button', { type: 'button', class: 'alternador__opcao', text: '+ Receita' });
    const selCategoria = el('select', {});
    const inpValor = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0.00' });
    const inpData = el('input', { type: 'date', value: movimentoExistente ? movimentoExistente.occurred_on : hojeISO() });
    const inpDesc = el('textarea', { rows: '2' }, [movimentoExistente ? (movimentoExistente.description || '') : '']);
    const inpProprio = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '0.00', class: 'divisao__valor' });
    const listaParceiros = el('div', {});
    const barraDiferenca = el('div', { class: 'divisao__diferenca', style: 'display:none;' });

    function categoriaSelecionadaEVenda() {
      const cat = categorias.find((c) => c.id === selCategoria.value);
      return tipo === 'receita' && !!(cat && cat.name.toLowerCase().includes('venda'));
    }

    function popularCategorias() {
      selCategoria.replaceChildren(...categorias.filter((c) => c.kind === tipo)
        .map((c) => el('option', { value: c.id, text: c.name })));
      if (movimentoExistente && movimentoExistente.category_id) selCategoria.value = movimentoExistente.category_id;
    }

    function marcarTipo() {
      btnCusto.className = 'alternador__opcao' + (tipo === 'custo' ? ' alternador__opcao--custo-activo' : '');
      btnReceita.className = 'alternador__opcao' + (tipo === 'receita' ? ' alternador__opcao--receita-activo' : '');
    }

    function desenharParceiros() {
      listaParceiros.replaceChildren(...participantesMov.map((p) => el('div', { class: 'divisao__linha' }, [
        el('span', { class: 'divisao__nome', text: p.nome }),
        (() => {
          const campo = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal',
            value: p.valor, placeholder: '0.00', class: 'divisao__valor' });
          campo.addEventListener('input', () => {
            p.valor = campo.value;
            if (!categoriaSelecionadaEVenda()) reequilibrar('p' + p.partner_id);
            actualizarDiferenca();
          });
          return campo;
        })(),
        el('button', { type: 'button', class: 'divisao__remover', text: '×',
          onclick: () => { participantesMov = participantesMov.filter((x) => x.partner_id !== p.partner_id); desenharParceiros(); actualizarDiferenca(); } }),
      ])));
    }

    /** Quando so ha dois campos (proprio + 1 parceiro), o outro segue o que mudou. Com mais,
     * completa o unico campo vazio -- exactamente o comportamento da app original. */
    function reequilibrar(chaveAlterada) {
      const total = parseFloat(inpValor.value) || 0;
      if (total <= 0) return;
      const campos = [{ chave: 'proprio', el: inpProprio }]
        .concat(participantesMov.map((p) => ({ chave: 'p' + p.partner_id, valor: p })));
      if (campos.length === 2) {
        const alterado = campos.find((c) => c.chave === chaveAlterada);
        const outro = campos.find((c) => c.chave !== chaveAlterada);
        if (!alterado || !outro) return;
        const valorAlterado = alterado.el ? (parseFloat(alterado.el.value) || 0) : (parseFloat(alterado.valor.valor) || 0);
        const resto = arred2(total - valorAlterado);
        if (outro.el) outro.el.value = resto > 0 ? resto.toFixed(2) : '0.00';
        else { outro.valor.valor = resto > 0 ? resto.toFixed(2) : '0.00'; desenharParceiros(); }
        return;
      }
      const vazios = campos.filter((c) => c.chave !== chaveAlterada
        && (c.el ? c.el.value === '' : c.valor.valor === ''));
      if (vazios.length === 1) {
        const somaResto = campos.filter((c) => c.chave !== vazios[0].chave)
          .reduce((s, c) => s + (c.el ? (parseFloat(c.el.value) || 0) : (parseFloat(c.valor.valor) || 0)), 0);
        const valor = Math.max(0, arred2(total - somaResto));
        if (vazios[0].el) vazios[0].el.value = valor.toFixed(2);
        else { vazios[0].valor.valor = valor.toFixed(2); desenharParceiros(); }
      }
    }

    function actualizarDiferenca() {
      const total = parseFloat(inpValor.value) || 0;
      let somaAtual = parseFloat(inpProprio.value) || 0;
      for (const p of participantesMov) somaAtual += parseFloat(p.valor) || 0;
      if (total === 0) { barraDiferenca.style.display = 'none'; return; }
      const diferenca = arred2(total - somaAtual);
      barraDiferenca.style.display = 'block';
      if (Math.abs(diferenca) < 0.01) {
        barraDiferenca.className = 'divisao__diferenca divisao__diferenca--ok';
        barraDiferenca.textContent = '✓ ' + formatMoney(total) + ' distribuídos';
      } else {
        barraDiferenca.className = 'divisao__diferenca divisao__diferenca--erro';
        barraDiferenca.textContent = diferenca > 0
          ? 'Faltam ' + formatMoney(diferenca) + ' por atribuir'
          : 'Excesso de ' + formatMoney(Math.abs(diferenca));
      }
    }

    function aplicarDistribuicaoDeVenda() {
      const total = parseFloat(inpValor.value) || 0;
      if (total <= 0 || movimentoExistente) return;
      const participantes = construirParticipantes(movimentosAtivo, ativo, partesAtivo);
      for (const p of participantes) {
        if (p.chave === 'proprio') continue;
        if (!participantesMov.some((x) => x.partner_id === p.partner_id)) {
          participantesMov.push({ chave: p.chave, partner_id: p.partner_id, nome: p.nome, valor: '' });
        }
      }
      desenharParceiros();
      const custoTotalAcumulado = participantes.reduce((s, p) => s + p.custo, 0);
      const lucro = total - custoTotalAcumulado;
      const lucroDistribuido = distribuirPorPct(lucro, participantes);
      const receitaPorParticipante = {};
      let somaAcumulada = 0;
      participantes.forEach((p, i) => {
        receitaPorParticipante[p.chave] = i === participantes.length - 1
          ? arred2(total - somaAcumulada) : arred2(p.custo + lucroDistribuido[p.chave]);
        somaAcumulada += receitaPorParticipante[p.chave];
      });
      inpProprio.value = Math.max(0, receitaPorParticipante.proprio || 0).toFixed(2);
      for (const p of participantesMov) p.valor = Math.max(0, receitaPorParticipante['p' + p.partner_id] || 0).toFixed(2);
      desenharParceiros();
      actualizarDiferenca();
    }

    btnCusto.onclick = () => { tipo = 'custo'; marcarTipo(); popularCategorias(); actualizarDiferenca(); };
    btnReceita.onclick = () => { tipo = 'receita'; marcarTipo(); popularCategorias(); actualizarDiferenca(); };
    selCategoria.addEventListener('change', () => { if (categoriaSelecionadaEVenda()) aplicarDistribuicaoDeVenda(); else actualizarDiferenca(); });
    inpValor.addEventListener('input', () => {
      const total = parseFloat(inpValor.value) || 0;
      if (categoriaSelecionadaEVenda()) aplicarDistribuicaoDeVenda();
      else if (!participantesMov.length) inpProprio.value = total > 0 ? total.toFixed(2) : '';
      else reequilibrar(null);
      actualizarDiferenca();
    });
    inpProprio.addEventListener('input', () => { if (!categoriaSelecionadaEVenda()) reequilibrar('proprio'); actualizarDiferenca(); });

    function abrirEscolhaParceiro() {
      const jaAdicionados = participantesMov.map((p) => p.partner_id);
      const disponiveis = partesAtivo.filter((p) => !jaAdicionados.includes(p.partner_id));
      if (!disponiveis.length) { avisar('Todos os parceiros já foram adicionados.', 'info'); return; }
      const escolha = el('dialog', { class: 'dialogo' }, [
        el('h2', { class: 'dialogo__titulo', text: 'Adicionar parceiro' }),
        el('ul', { class: 'lista cartao' }, disponiveis.map((p) => el('li', { class: 'lista__linha' }, [
          el('button', { class: 'btn', type: 'button', text: p.name, style: 'width:100%;text-align:left;',
            onclick: () => {
              participantesMov.push({ chave: 'p' + p.partner_id, partner_id: p.partner_id, nome: p.name, valor: '' });
              desenharParceiros(); actualizarDiferenca();
              escolha.close(); escolha.remove();
            } }),
        ]))),
        el('div', { class: 'dialogo__accoes' }, [
          el('button', { class: 'btn', type: 'button', text: 'Fechar', onclick: () => { escolha.close(); escolha.remove(); } }),
        ]),
      ]);
      document.body.append(escolha);
      escolha.showModal();
    }

    if (movimentoExistente) {
      inpValor.value = movimentoExistente.amount;
      inpProprio.value = movimentoExistente.own_amount != null ? movimentoExistente.own_amount : movimentoExistente.amount;
      participantesMov = (movimentoExistente.asset_movement_partners || []).map((mp) => ({
        chave: 'p' + mp.partner_id, partner_id: mp.partner_id,
        nome: mp.asset_partners ? mp.asset_partners.name : '?', valor: mp.amount,
      }));
    } else {
      for (const p of partesAtivo) participantesMov.push({ chave: 'p' + p.partner_id, partner_id: p.partner_id, nome: p.name, valor: '' });
    }
    marcarTipo();
    popularCategorias();
    desenharParceiros();

    const form = el('form', { method: 'dialog' }, [
      el('div', { class: 'alternador' }, [btnCusto, btnReceita]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Categoria' }), selCategoria]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Valor total (€)' }), inpValor]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Data' }), inpData]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Descrição (opcional)' }), inpDesc]),
      el('div', { class: 'divisao' }, [
        el('div', { class: 'divisao__cabecalho' }, [
          el('span', { class: 'divisao__titulo', text: 'Divisão do valor' }),
          el('button', { class: 'btn btn--pequeno', type: 'button', text: '+ Parceiro', onclick: () => abrirEscolhaParceiro() }),
        ]),
        el('div', { class: 'divisao__linha' }, [
          el('span', { class: 'divisao__nome', text: 'A minha parte' }),
          inpProprio,
        ]),
        listaParceiros,
        barraDiferenca,
      ]),
    ]);

    const dialogo = el('dialog', { class: 'dialogo' }, [
      el('h2', { class: 'dialogo__titulo', text: titulo }),
      form,
      el('div', { class: 'dialogo__accoes' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => { dialogo.close(); dialogo.remove(); resolve(null); } }),
        el('button', { class: 'btn btn--primario', type: 'button', text: 'Guardar', onclick: submeter }),
      ]),
    ]);

    function submeter() {
      const valor = parseFloat(inpValor.value);
      const proprio = parseFloat(inpProprio.value);
      if (!valor || valor <= 0) { avisar('Indique um valor válido.', 'erro'); return; }
      if (Number.isNaN(proprio) || proprio < 0) { avisar('Indique a sua parte.', 'erro'); return; }
      if (!selCategoria.value) { avisar('Selecione uma categoria.', 'erro'); return; }
      if (!inpData.value) { avisar('Indique a data.', 'erro'); return; }
      let somaTotal = proprio;
      const partes = [];
      for (const p of participantesMov) {
        const v = parseFloat(p.valor) || 0;
        if (v < 0) { avisar('O valor de ' + p.nome + ' não pode ser negativo.', 'erro'); return; }
        somaTotal += v;
        if (v > 0) partes.push({ partner_id: p.partner_id, amount: v });
      }
      if (Math.abs(somaTotal - valor) > 0.01) { avisar('A soma não coincide com o total.', 'erro'); return; }

      dialogo.close(); dialogo.remove();
      resolve({
        category_id: selCategoria.value, kind: tipo, amount: arred2(valor), own_amount: arred2(proprio),
        occurred_on: inpData.value, description: inpDesc.value.trim() || null, partes,
        categoriaEhVenda: categoriaSelecionadaEVenda(),
      });
    }

    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); dialogo.close(); dialogo.remove(); resolve(null); });
    document.body.append(dialogo);
    dialogo.showModal();
    actualizarDiferenca();
  });
}

async function novoMovimento(ativo, movimentosAtivo, partesAtivo, categorias, tipo, aoTerminar) {
  const resultado = await abrirDialogoMovimento({
    titulo: tipo === 'custo' ? 'Registar custo' : 'Registar receita',
    tipoInicial: tipo, categorias, ativo, movimentosAtivo, partesAtivo,
  });
  if (!resultado) return;
  try {
    const mov = await criarMovimentoAtivo({
      asset_id: ativo.id, category_id: resultado.category_id, kind: resultado.kind,
      amount: resultado.amount, own_amount: resultado.own_amount,
      occurred_on: resultado.occurred_on, description: resultado.description,
    });
    if (resultado.partes.length) await definirParceirosMovimento(mov.id, resultado.partes);
    if (resultado.categoriaEhVenda) {
      await actualizarAtivo(ativo.id, { status: 'vendido', sale_reason: 'venda', sold_on: resultado.occurred_on });
      avisar('Guardado! Ativo marcado como vendido.', 'sucesso');
    } else avisar('Movimento guardado.', 'sucesso');
    await aoTerminar();
  } catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function editarMovimento(movimento, ativo, movimentosAtivo, partesAtivo, categorias, aoTerminar) {
  const resultado = await abrirDialogoMovimento({
    titulo: 'Editar movimento', tipoInicial: movimento.kind, categorias, ativo, movimentosAtivo, partesAtivo,
    movimentoExistente: movimento,
  });
  if (!resultado) return;
  try {
    await actualizarMovimentoAtivo(movimento.id, {
      category_id: resultado.category_id, kind: resultado.kind, amount: resultado.amount,
      own_amount: resultado.own_amount, occurred_on: resultado.occurred_on, description: resultado.description,
    });
    await definirParceirosMovimento(movimento.id, resultado.partes);
    avisar('Movimento atualizado.', 'sucesso');
    await aoTerminar();
  } catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function apagarMovimento(movimento, aoTerminar) {
  const confirmado = await dialogoConfirmar({ titulo: 'Apagar movimento', mensagem: 'Apagar este movimento?' });
  if (!confirmado) return;
  try {
    await apagarMovimentoAtivo(movimento.id);
    avisar('Movimento apagado.', 'sucesso');
    await aoTerminar();
  } catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

// -----------------------------------------------------------------------------
// Ficha do ativo
// -----------------------------------------------------------------------------

async function montarFicha(alvo, ativoId) {
  const [ativo, grupos, categorias] = await Promise.all([
    obterAtivo(ativoId), listarGruposAtivos(), listarCategoriasAtivos(),
  ]);
  const grupo = grupos.find((g) => g.id === ativo.group_id);

  async function recarregar() {
    const [movimentos, partesAtivo] = await Promise.all([listarMovimentosAtivo(ativoId), listarPartesAtivo(ativoId)]);
    desenhar(movimentos, partesAtivo);
  }

  function desenhar(movimentos, partesAtivo) {
    const custos = movimentos.filter((m) => m.kind === 'custo');
    const receitas = movimentos.filter((m) => m.kind === 'receita');
    const custoTotal = soma(custos, 'amount');
    const receitaTotal = soma(receitas, 'amount');
    const custoProprio = custos.reduce((s, m) => s + valorProprio(m), 0);
    const receitaProprio = receitas.reduce((s, m) => s + valorProprio(m), 0);
    const resultadoTotal = receitaTotal - custoTotal;
    const resultadoProprio = receitaProprio - custoProprio;
    const lucroP = lucroPrevisto(ativo, custoTotal);

    const fragmento = document.createDocumentFragment();
    fragmento.append(cabecalhoComVoltar(
      grupo ? 'ativos/grupo/' + grupo.id : 'ativos', grupo ? grupo.name : 'Ativos', ativo.name,
      [el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Opções', onclick: abrirOpcoes })],
    ));

    fragmento.append(
      el('div', { class: 'cartao' }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' }, [
          el('span', { style: 'font-weight:600;', text: 'Resumo total' }),
          el('span', { class: classeValor(resultadoTotal), text: formatMoney(resultadoTotal, { sinal: true }) }),
        ]),
        linhaResumo('Custo total', formatMoney(custoTotal)),
        linhaResumo('Receita total', formatMoney(receitaTotal)),
        lucroP != null ? linhaResumo('Lucro previsto (meu)', formatMoney(lucroP)) : null,
      ]),
      el('div', { class: 'cartao' }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' }, [
          el('span', { style: 'font-weight:600;', text: 'A minha parte' }),
          el('span', { class: classeValor(resultadoProprio), text: formatMoney(resultadoProprio, { sinal: true }) }),
        ]),
        linhaResumo('Meu custo', formatMoney(custoProprio)),
        linhaResumo('Minha receita', formatMoney(receitaProprio)),
      ]),
      el('div', { style: 'display:flex;gap:8px;margin-bottom:16px;' }, [
        el('button', { class: 'btn btn--destrutivo', type: 'button', text: '− Custo', style: 'flex:1;',
          onclick: () => novoMovimento(ativo, movimentos, partesAtivo, categorias, 'custo', recarregar) }),
        el('button', { class: 'btn btn--primario', type: 'button', text: '+ Receita', style: 'flex:1;',
          onclick: () => novoMovimento(ativo, movimentos, partesAtivo, categorias, 'receita', recarregar) }),
        el('button', { class: 'btn', type: 'button', text: 'Troca', style: 'flex:1;',
          onclick: () => iniciarTroca(ativo, grupos, movimentos, partesAtivo, recarregar) }),
      ]),
      el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Movimentos' }),
    );

    if (!movimentos.length) {
      fragmento.append(el('div', { class: 'cartao' }, [el('p', { class: 'vazio__texto', text: 'Sem movimentos ainda.' })]));
    } else {
      fragmento.append(el('ul', { class: 'lista cartao' }, movimentos.map((m) => {
        const vp = valorProprio(m); const vt = Number(m.amount);
        const parceirosMov = m.asset_movement_partners || [];
        return el('li', { class: 'lista__linha' }, [
          el('div', { class: 'lista__principal' }, [
            el('span', { class: 'lista__nome', text: m.asset_categories ? m.asset_categories.name : '—' }),
            m.description ? el('span', { class: 'lista__meta', text: m.description }) : null,
            el('span', { class: 'lista__meta', text: formatDate(m.occurred_on) }),
            parceirosMov.length ? el('div', { class: 'pilulas' }, parceirosMov.map((mp) =>
              el('span', { class: 'etiqueta-marca',
                text: (mp.asset_partners ? mp.asset_partners.name : '?') + ' ' + formatMoney(mp.amount) }))) : null,
          ]),
          el('div', { class: 'lista__accoes', style: 'flex-direction:column;align-items:flex-end;gap:2px;' }, [
            el('span', { class: classeValor(m.kind === 'custo' ? -vt : vt),
              text: formatMoney(m.kind === 'custo' ? -vt : vt, { sinal: true }) }),
            vp !== vt ? el('span', { class: 'lista__meta', text: 'Minha: ' + formatMoney(vp) }) : null,
          ]),
          el('div', { class: 'lista__accoes' }, [
            el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar',
              onclick: () => editarMovimento(m, ativo, movimentos, partesAtivo, categorias, recarregar) }),
            el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar',
              onclick: () => apagarMovimento(m, recarregar) }),
          ]),
        ]);
      })));
    }
    alvo.replaceChildren(fragmento);
  }

  async function abrirOpcoes() {
    const dialogo = el('dialog', { class: 'dialogo' }, [
      el('h2', { class: 'dialogo__titulo', text: 'Opções do ativo' }),
      el('div', { style: 'display:flex;flex-direction:column;gap:8px;' }, [
        el('button', { class: 'btn btn--largo', type: 'button', text: 'Editar ativo', onclick: () => { fechar(); editarAtivoAccao(); } }),
        el('button', { class: 'btn btn--largo', type: 'button', text: 'Marcar como vendido', onclick: () => { fechar(); marcar('vendido'); } }),
        el('button', { class: 'btn btn--largo', type: 'button', text: 'Marcar em carteira', onclick: () => { fechar(); marcar('em_carteira'); } }),
        el('button', { class: 'btn btn--largo', type: 'button', text: 'Apagar ativo', style: 'background:var(--negativo);color:#fff;', onclick: () => { fechar(); apagarAtivoAccao(); } }),
      ]),
      el('div', { class: 'dialogo__accoes' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: fechar }),
      ]),
    ]);
    function fechar() { dialogo.close(); dialogo.remove(); }
    document.body.append(dialogo);
    dialogo.showModal();
  }

  async function marcar(status) {
    try {
      await actualizarAtivo(ativo.id, status === 'vendido'
        ? { status, sale_reason: 'venda', sold_on: hojeISO() }
        : { status, sale_reason: null, sold_on: null });
      ativo.status = status;
      avisar('Ativo atualizado.', 'sucesso');
      await recarregar();
    } catch (erro) { avisar(traduzErro(erro), 'erro'); }
  }

  async function editarAtivoAccao() {
    const parceiros = await listarParceirosAtivos();
    const partesAtuais = await listarPartesAtivo(ativoId);
    await abrirDialogoAtivo({ ativoExistente: ativo, parceiros, partesIniciais: partesAtuais, aoGuardar: async (dados, partes) => {
      await actualizarAtivo(ativoId, dados);
      await definirPartesAtivo(ativoId, partes);
      Object.assign(ativo, dados);
      avisar('Ativo atualizado.', 'sucesso');
      await recarregar();
    } });
  }

  async function apagarAtivoAccao() {
    const confirmado = await dialogoConfirmar({
      titulo: 'Apagar ativo', mensagem: 'Apagar este ativo e todos os seus movimentos?',
    });
    if (!confirmado) return;
    try {
      await apagarAtivo(ativoId);
      avisar('Ativo apagado.', 'sucesso');
      location.hash = '#/ativos/grupo/' + ativo.group_id;
    } catch (erro) { avisar(traduzErro(erro), 'erro'); }
  }

  await recarregar();
}

// -----------------------------------------------------------------------------
// Dialogo de ativo (novo/editar) -- tem a lista de parceiros com checkbox +
// percentagem de lucro, tal como a app original.
// -----------------------------------------------------------------------------

function abrirDialogoAtivo({ ativoExistente, parceiros, partesIniciais, aoGuardar }) {
  return new Promise((resolve) => {
    let partes = partesIniciais.map((p) => ({ partner_id: p.partner_id, profit_pct: p.profit_pct }));

    const inpNome = el('input', { type: 'text', value: ativoExistente?.name || '', required: true });
    const inpDesc = el('input', { type: 'text', value: ativoExistente?.description || '' });
    const inpData = el('input', { type: 'date', value: ativoExistente?.acquired_on || hojeISO() });
    const selEstado = el('select', {}, ESTADOS_ATIVO.map((e) => el('option', { value: e.valor, text: e.etiqueta,
      selected: (ativoExistente?.status || 'em_carteira') === e.valor || null })));
    const grupoDataVenda = el('label', { class: 'campo campo--inactivo' }, [
      el('span', { class: 'campo__etiqueta', text: 'Data de venda' }),
      el('input', { type: 'date', value: ativoExistente?.sold_on || '' }),
    ]);
    const inpPrevisto = el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal',
      value: ativoExistente?.expected_sale_value ?? '' });
    const inpPct = el('input', { type: 'number', step: '1', min: '0', max: '100', inputmode: 'decimal',
      value: ativoExistente?.profit_pct ?? 100 });
    const listaParceirosEl = el('div', {});
    const resumoPct = el('div', { class: 'percentagens__resumo' });

    selEstado.addEventListener('change', () => {
      grupoDataVenda.classList.toggle('campo--inactivo', selEstado.value !== 'vendido');
    });
    grupoDataVenda.classList.toggle('campo--inactivo', selEstado.value !== 'vendido');

    function pctProprio() { return Math.min(100, Math.max(0, pctOuDefeito(inpPct.value))); }

    function desenharParceiros() {
      listaParceirosEl.replaceChildren(...parceiros.map((p) => {
        const seleccionado = partes.find((x) => x.partner_id === p.id);
        const chk = el('input', { type: 'checkbox' });
        chk.checked = !!seleccionado;
        const campoPct = el('input', { type: 'number', min: '0', max: '100', step: '1', class: 'percentagens__pct',
          value: seleccionado ? seleccionado.profit_pct : '', placeholder: '%' });
        campoPct.disabled = !seleccionado;
        chk.addEventListener('change', () => {
          if (chk.checked) { if (!partes.some((x) => x.partner_id === p.id)) partes.push({ partner_id: p.id, profit_pct: 0 }); dividirRestante(false); }
          else partes = partes.filter((x) => x.partner_id !== p.id);
          desenharParceiros();
        });
        campoPct.addEventListener('input', () => {
          const alvo = partes.find((x) => x.partner_id === p.id);
          if (alvo) alvo.profit_pct = Math.min(100, Math.max(0, numOuNulo(campoPct.value) ?? 0));
          actualizarResumoPct();
        });
        return el('div', { class: 'percentagens__linha' }, [chk, el('span', { text: p.name }), campoPct]);
      }));
      actualizarResumoPct();
    }

    function dividirRestante(redesenhar = true) {
      if (!partes.length) { actualizarResumoPct(); return; }
      const resto = Math.max(0, 100 - pctProprio());
      const cada = arred2(resto / partes.length);
      let acumulado = 0;
      partes.forEach((p, i) => { p.profit_pct = i === partes.length - 1 ? arred2(resto - acumulado) : cada; acumulado += p.profit_pct; });
      if (redesenhar) desenharParceiros(); else actualizarResumoPct();
    }

    function actualizarResumoPct() {
      const total = arred2(pctProprio() + partes.reduce((s, p) => s + (parseFloat(p.profit_pct) || 0), 0));
      resumoPct.textContent = 'Total lucro: ' + total.toFixed(2) + '%';
      resumoPct.style.color = Math.abs(total - 100) < 0.01 ? 'var(--positivo)' : 'var(--aviso)';
    }

    inpPct.addEventListener('input', actualizarResumoPct);
    desenharParceiros();

    const form = el('form', { method: 'dialog' }, [
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Nome' }), inpNome]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Descrição (opcional)' }), inpDesc]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Data de aquisição' }), inpData]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Estado' }), selEstado]),
      grupoDataVenda,
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Valor previsto de venda (€)' }), inpPrevisto]),
      el('label', { class: 'campo' }, [el('span', { class: 'campo__etiqueta', text: 'Minha % do lucro previsto' }), inpPct]),
      el('div', { class: 'divisao' }, [
        el('div', { class: 'divisao__cabecalho' }, [
          el('span', { class: 'divisao__titulo', text: 'Parceiros do ativo' }),
          el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Dividir restante', onclick: () => dividirRestante(true) }),
        ]),
        listaParceirosEl,
        resumoPct,
      ]),
    ]);

    const dialogo = el('dialog', { class: 'dialogo' }, [
      el('h2', { class: 'dialogo__titulo', text: ativoExistente ? 'Editar ativo' : 'Novo ativo' }),
      form,
      el('div', { class: 'dialogo__accoes' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: () => { dialogo.close(); dialogo.remove(); resolve(null); } }),
        el('button', { class: 'btn btn--primario', type: 'button', text: 'Guardar', onclick: submeter }),
      ]),
    ]);

    async function submeter() {
      const nome = inpNome.value.trim();
      if (!nome) { avisar('Indique o nome.', 'erro'); return; }
      const estado = selEstado.value;
      const dados = {
        name: nome, description: inpDesc.value.trim() || null, acquired_on: inpData.value || null,
        status: estado, sold_on: estado === 'vendido' ? (grupoDataVenda.querySelector('input').value || null) : null,
        expected_sale_value: numOuNulo(inpPrevisto.value), profit_pct: pctOuDefeito(inpPct.value),
      };
      const totalPct = arred2((dados.profit_pct || 0) + partes.reduce((s, p) => s + (parseFloat(p.profit_pct) || 0), 0));
      if (partes.length && Math.abs(totalPct - 100) > 0.01) { avisar('As percentagens de lucro devem somar 100%.', 'erro'); return; }
      dialogo.close(); dialogo.remove();
      await aoGuardar(dados, partes);
      resolve(dados);
    }

    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); dialogo.close(); dialogo.remove(); resolve(null); });
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

async function novoAtivo(grupoId, parceiros, aoTerminar) {
  await abrirDialogoAtivo({
    ativoExistente: null, parceiros, partesIniciais: [],
    aoGuardar: async (dados, partes) => {
      const criado = await criarAtivo({ ...dados, group_id: grupoId });
      await definirPartesAtivo(criado.id, partes);
      avisar('Ativo criado.', 'sucesso');
      await aoTerminar();
    },
  });
}

// -----------------------------------------------------------------------------
// Troca (trade-in): vende o ativo actual e usa o resultado como custo inicial
// de um ativo novo. O formulario e simples (sem linhas dinamicas), por isso
// usa o dialogoFormulario generico -- a logica de movimentos e feita a seguir.
// -----------------------------------------------------------------------------

async function iniciarTroca(ativo, grupos, movimentosAtivo, partesAtivo, aoTerminar) {
  const custoAcumulado = soma(movimentosAtivo.filter((m) => m.kind === 'custo'), 'amount');
  const receitaAcumulada = soma(movimentosAtivo.filter((m) => m.kind === 'receita'), 'amount');

  const valores = await dialogoFormulario({
    titulo: 'Registar troca',
    campos: [
      { nome: 'group_id', etiqueta: 'Grupo do novo ativo', tipo: 'seleccao', valor: ativo.group_id,
        opcoes: grupos.map((g) => ({ valor: g.id, etiqueta: g.name })) },
      { nome: 'name', etiqueta: 'Nome do novo ativo', tipo: 'text', obrigatorio: true, valor: '' },
      { nome: 'description', etiqueta: 'Descrição (opcional)', tipo: 'text', valor: '' },
      { nome: 'expected_sale_value', etiqueta: 'Valor previsto de venda (€)', tipo: 'number', valor: '' },
      { nome: 'profit_pct', etiqueta: 'Minha % do lucro previsto', tipo: 'number', valor: ativo.profit_pct ?? 100 },
      { nome: 'recebido', etiqueta: 'Recebi na troca (€, opcional)', tipo: 'number', valor: '',
        ajuda: `Custo acumulado deste ativo: ${formatMoney(custoAcumulado)} · Receita: ${formatMoney(receitaAcumulada)}` +
          ` · Resultado: ${formatMoney(receitaAcumulada - custoAcumulado)}` },
      { nome: 'pago', etiqueta: 'Paguei na troca (€, opcional)', tipo: 'number', valor: '' },
    ],
    confirmar: 'Confirmar troca',
  });
  if (!valores) return;

  const novoGrupoId = valores.group_id;
  const novoNome = valores.name.trim();
  if (!novoGrupoId || !novoNome) { avisar('Grupo e nome do novo ativo são obrigatórios.', 'erro'); return; }
  const recebido = parseFloat(valores.recebido) || 0;
  const pago = parseFloat(valores.pago) || 0;

  try {
    const participantes = construirParticipantes(movimentosAtivo, ativo, partesAtivo);
    const data = hojeISO();
    const catReceitaId = await obterOuCriarCategoriaAtivos('Troca', 'receita');
    const catCustoId = await obterOuCriarCategoriaAtivos('Troca', 'custo');

    async function registarMovimentoComPartes(assetId, categoryId, kind, total, shares, descricao) {
      if (arred2(total) <= 0) return;
      const proprio = arred2(shares.proprio || 0);
      const partes = participantes.filter((p) => p.chave !== 'proprio')
        .map((p) => ({ partner_id: p.partner_id, amount: arred2(shares[p.chave] || 0) }))
        .filter((p) => p.amount > 0.009);
      const mov = await criarMovimentoAtivo({ asset_id: assetId, category_id: categoryId, kind,
        amount: arred2(total), own_amount: proprio, occurred_on: data, description: descricao });
      if (partes.length) await definirParceirosMovimento(mov.id, partes);
    }

    let recebidoShares = {};
    if (recebido > 0) {
      recebidoShares = distribuirPorPct(recebido, participantes);
      await registarMovimentoComPartes(ativo.id, catReceitaId, 'receita', recebido, recebidoShares, 'Dinheiro recebido na troca');
    }

    // custo remanescente (o que cada participante ainda nao recuperou) transfere-se para o ativo novo
    const shares = {}; let restanteTotal = 0;
    for (const p of participantes) {
      const rem = Math.max(0, arred2(p.custo - p.receita - (recebidoShares[p.chave] || 0)));
      shares[p.chave] = rem; restanteTotal += rem;
    }
    restanteTotal = arred2(restanteTotal);
    await registarMovimentoComPartes(ativo.id, catReceitaId, 'receita', restanteTotal, shares,
      'Troca — a transferir custo para o novo ativo');
    await actualizarAtivo(ativo.id, { status: 'vendido', sale_reason: 'troca', sold_on: data });

    const novoAtivoRow = await criarAtivo({
      group_id: novoGrupoId, name: novoNome, description: valores.description || null,
      status: 'em_carteira', acquired_on: data,
      expected_sale_value: numOuNulo(valores.expected_sale_value), profit_pct: pctOuDefeito(valores.profit_pct),
    });
    await definirPartesAtivo(novoAtivoRow.id, partesAtivo.map((p) => ({ partner_id: p.partner_id, profit_pct: p.profit_pct })));
    await registarMovimentoComPartes(novoAtivoRow.id, catCustoId, 'custo', restanteTotal, shares,
      `Troca — recebido de ${ativo.name}`);
    if (pago > 0) {
      const pagoShares = distribuirPorPct(pago, participantes);
      await registarMovimentoComPartes(novoAtivoRow.id, catCustoId, 'custo', pago, pagoShares, 'Dinheiro pago na troca');
    }

    avisar('Troca registada com sucesso.', 'sucesso');
    location.hash = '#/ativos/ativo/' + novoAtivoRow.id;
  } catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

// -----------------------------------------------------------------------------
// Analise -- evolucao acumulada do "meu dinheiro" por grupo, ao longo do tempo
// -----------------------------------------------------------------------------

const CORES_GRUPOS = ['#1F9D6B', '#2B5CB8', '#E8A33D', '#D9483C', '#8A5BC4', '#3AA6A6', '#E3C84B', '#C4589B'];

async function montarAnalise(alvo) {
  const [grupos, movimentos] = await Promise.all([listarGruposAtivos(), listarTodosMovimentosAtivos()]);

  const fragmento = document.createDocumentFragment();
  fragmento.append(
    abas(ABAS_ATIVOS, 'ativos/analise'),
    el('div', { class: 'cabecalho' }, [el('h1', { class: 'cabecalho__titulo', text: 'Análise' })]),
  );

  const linhas = movimentos
    .filter((m) => m.occurred_on && m.assets && m.assets.group_id)
    .map((m) => ({ grupoId: m.assets.group_id, mes: String(m.occurred_on).slice(0, 7),
      delta: (m.kind === 'receita' ? 1 : -1) * valorProprio(m) }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  if (!linhas.length) {
    fragmento.append(el('div', { class: 'cartao' }, [el('p', { class: 'vazio__texto', text: 'Sem movimentos ainda.' })]));
    alvo.replaceChildren(fragmento);
    return;
  }

  // Um rotulo por mes, do primeiro movimento até ao mes actual.
  const mesInicial = linhas[0].mes;
  const mesActual = hojeISO().slice(0, 7);
  const rotulos = [];
  const chavesMes = [];
  let [ano, mes] = mesInicial.split('-').map(Number);
  const [anoFim, mesFim] = mesActual.split('-').map(Number);
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const chave = String(ano) + '-' + String(mes).padStart(2, '0');
    chavesMes.push(chave);
    rotulos.push(nomeMes(mes - 1, true) + ' ' + String(ano).slice(2));
    mes++; if (mes > 12) { mes = 1; ano++; }
  }

  const series = [];
  grupos.forEach((g, i) => {
    const doGrupo = linhas.filter((l) => l.grupoId === g.id);
    if (!doGrupo.length) return;
    const porMes = new Map();
    for (const l of doGrupo) porMes.set(l.mes, (porMes.get(l.mes) || 0) + l.delta);
    let acumulado = 0;
    const valoresPorMes = chavesMes.map((chave) => { acumulado = arred2(acumulado + (porMes.get(chave) || 0)); return acumulado; });
    series.push({ nome: g.name, cor: CORES_GRUPOS[i % CORES_GRUPOS.length], valores: valoresPorMes, total: acumulado });
  });

  if (!series.length) {
    fragmento.append(el('div', { class: 'cartao' }, [el('p', { class: 'vazio__texto', text: 'Sem dados para mostrar.' })]));
    alvo.replaceChildren(fragmento);
    return;
  }

  const tela = el('canvas', { 'aria-label': 'Evolução do meu dinheiro por grupo' });
  fragmento.append(
    el('div', { class: 'cartao' }, [
      el('h2', { class: 'cartao__titulo', text: 'Crescimento do meu dinheiro' }),
      el('div', { class: 'grafico' }, [tela]),
    ]),
    el('div', { class: 'cartao' }, [
      el('ul', { class: 'lista' }, series.map((s) => el('li', { class: 'lista__linha' }, [
        el('div', { class: 'lista__principal' }, [
          el('span', { class: 'chip' }, [
            el('span', { class: 'chip__ponto', style: 'background:' + s.cor }),
            el('span', { text: s.nome }),
          ]),
        ]),
        el('span', { class: classeValor(s.total) + ' lista__valor', text: formatMoney(s.total, { sinal: true }) }),
      ]))),
    ]),
  );
  alvo.replaceChildren(fragmento);
  linhasEvolucao(tela, rotulos, series, (v) => formatMoney(v));
}

// -----------------------------------------------------------------------------
// Configuracoes -- grupos, parceiros e categorias
// -----------------------------------------------------------------------------

async function montarConfig(alvo) {
  async function recarregar() {
    const [grupos, parceiros, categorias] = await Promise.all([
      listarGruposAtivos(), listarParceirosAtivos(), listarCategoriasAtivos(),
    ]);

    const fragmento = document.createDocumentFragment();
    fragmento.append(
      abas(ABAS_ATIVOS, 'ativos/config'),
      el('div', { class: 'cabecalho' }, [el('h1', { class: 'cabecalho__titulo', text: 'Configurações — Ativos' })]),

      el('section', { class: 'seccao' }, [
        el('div', { class: 'cabecalho' }, [
          el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Grupos' }),
          el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Adicionar', onclick: () => novoGrupo(recarregar) }),
        ]),
        grupos.length ? el('ul', { class: 'lista cartao' }, grupos.map((g) => el('li', { class: 'lista__linha' }, [
          el('div', { class: 'lista__principal' }, [el('span', { class: 'lista__nome', text: g.name })]),
          el('div', { class: 'lista__accoes' }, [
            el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar', onclick: () => editarGrupo(g, recarregar) }),
            el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar', onclick: () => apagarGrupo(g, recarregar) }),
          ]),
        ]))) : el('div', { class: 'cartao' }, [el('p', { class: 'vazio__texto', text: 'Nenhum grupo.' })]),
      ]),

      el('section', { class: 'seccao' }, [
        el('div', { class: 'cabecalho' }, [
          el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Parceiros' }),
          el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Adicionar', onclick: () => novoParceiro(recarregar) }),
        ]),
        parceiros.length ? el('ul', { class: 'lista cartao' }, parceiros.map((p) => el('li', { class: 'lista__linha' }, [
          el('div', { class: 'lista__principal' }, [el('span', { class: 'lista__nome', text: p.name })]),
          el('div', { class: 'lista__accoes' }, [
            el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar', onclick: () => editarParceiro(p, recarregar) }),
            el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar', onclick: () => apagarParceiro(p, recarregar) }),
          ]),
        ]))) : el('div', { class: 'cartao' }, [el('p', { class: 'vazio__texto', text: 'Nenhum parceiro.' })]),
      ]),

      el('section', { class: 'seccao' }, [
        el('div', { class: 'cabecalho' }, [
          el('h2', { class: 'cabecalho__titulo cabecalho__titulo--peq', text: 'Categorias' }),
          el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Adicionar', onclick: () => novaCategoria(recarregar) }),
        ]),
        categorias.length ? el('ul', { class: 'lista cartao' }, categorias.map((c) => el('li', { class: 'lista__linha' }, [
          el('div', { class: 'lista__principal' }, [
            el('span', { class: 'lista__nome', text: c.name }),
            el('span', { class: 'marca' + (c.kind === 'custo' ? '' : ' marca--fraca'), text: c.kind }),
          ]),
          el('div', { class: 'lista__accoes' }, [
            el('button', { class: 'btn btn--pequeno', type: 'button', text: 'Editar', onclick: () => editarCategoria(c, recarregar) }),
            el('button', { class: 'btn btn--pequeno btn--perigo', type: 'button', text: 'Apagar', onclick: () => apagarCategoria(c, recarregar) }),
          ]),
        ]))) : el('div', { class: 'cartao' }, [el('p', { class: 'vazio__texto', text: 'Nenhuma categoria.' })]),
      ]),
    );
    alvo.replaceChildren(fragmento);
  }
  await recarregar();
}

async function novoParceiro(recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Novo parceiro',
    campos: [{ nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: '', obrigatorio: true, maximo: 60 }],
    confirmar: 'Criar parceiro',
  });
  if (!valores) return;
  try { await criarParceiroAtivos({ name: valores.name }); avisar('Parceiro criado.', 'sucesso'); await recarregar(); }
  catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function editarParceiro(parceiro, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Editar parceiro',
    campos: [{ nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: parceiro.name, obrigatorio: true, maximo: 60 }],
    confirmar: 'Guardar alterações',
  });
  if (!valores) return;
  try { await actualizarParceiroAtivos(parceiro.id, { name: valores.name }); avisar('Parceiro atualizado.', 'sucesso'); await recarregar(); }
  catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function apagarParceiro(parceiro, recarregar) {
  const confirmado = await dialogoConfirmar({
    titulo: 'Apagar parceiro',
    mensagem: `Apagar "${parceiro.name}"? As divisões de movimentos e ativos que o envolvem perdem essa parte, mas não são apagadas.`,
  });
  if (!confirmado) return;
  try { await apagarParceiroAtivos(parceiro.id); avisar('Parceiro apagado.', 'sucesso'); await recarregar(); }
  catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function novaCategoria(recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Nova categoria',
    campos: [
      { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: '', obrigatorio: true, maximo: 60 },
      { nome: 'kind', etiqueta: 'Tipo', tipo: 'seleccao', valor: 'custo', opcoes: TIPOS_MOVIMENTO_ATIVO },
    ],
    confirmar: 'Criar categoria',
  });
  if (!valores) return;
  try { await criarCategoriaAtivos({ name: valores.name, kind: valores.kind }); avisar('Categoria criada.', 'sucesso'); await recarregar(); }
  catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function editarCategoria(categoria, recarregar) {
  const valores = await dialogoFormulario({
    titulo: 'Editar categoria',
    campos: [
      { nome: 'name', etiqueta: 'Nome', tipo: 'text', valor: categoria.name, obrigatorio: true, maximo: 60 },
      { nome: 'kind', etiqueta: 'Tipo', tipo: 'seleccao', valor: categoria.kind, opcoes: TIPOS_MOVIMENTO_ATIVO },
    ],
    confirmar: 'Guardar alterações',
  });
  if (!valores) return;
  try { await actualizarCategoriaAtivos(categoria.id, { name: valores.name, kind: valores.kind }); avisar('Categoria atualizada.', 'sucesso'); await recarregar(); }
  catch (erro) { avisar(traduzErro(erro), 'erro'); }
}

async function apagarCategoria(categoria, recarregar) {
  const emUso = await contarMovimentosDaCategoriaAtivos(categoria.id);
  if (emUso > 0) { avisar('Não é possível apagar: existem movimentos com esta categoria.', 'erro'); return; }
  const confirmado = await dialogoConfirmar({ titulo: 'Apagar categoria', mensagem: `Apagar a categoria "${categoria.name}"?` });
  if (!confirmado) return;
  try { await apagarCategoriaAtivos(categoria.id); avisar('Categoria apagada.', 'sucesso'); await recarregar(); }
  catch (erro) { avisar(traduzErro(erro), 'erro'); }
}
