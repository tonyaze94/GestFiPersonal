// -----------------------------------------------------------------------------
// Utilitarios de interface partilhados por todos os ecras.
// -----------------------------------------------------------------------------

/** Atalho para document.querySelector. */
export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

/** Atalho para document.querySelectorAll, ja como array. */
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

/**
 * Escapa texto vindo da base de dados antes de o injetar como HTML.
 * Mesmo sendo uma app de um so utilizador, nunca se interpola texto em bruto.
 */
export function esc(texto) {
  if (texto == null) return '';
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Cria um elemento com atributos e filhos, sem recorrer a innerHTML.
 */
export function el(tag, atributos = {}, filhos = []) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor == null || valor === false) continue;
    if (chave === 'class') node.className = valor;
    else if (chave === 'text') node.textContent = valor;
    else if (chave.startsWith('on') && typeof valor === 'function') {
      node.addEventListener(chave.slice(2).toLowerCase(), valor);
    } else node.setAttribute(chave, valor === true ? '' : valor);
  }
  for (const filho of [].concat(filhos)) {
    if (filho == null) continue;
    node.append(filho instanceof Node ? filho : document.createTextNode(filho));
  }
  return node;
}

let temporizadorAviso;

/**
 * Mensagem breve no fundo do ecra. tipo: 'erro' | 'sucesso' | 'info'
 */
export function avisar(mensagem, tipo = 'info') {
  const caixa = $('#aviso');
  if (!caixa) return;
  caixa.textContent = mensagem;
  caixa.className = `aviso aviso--${tipo} aviso--visivel`;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => {
    caixa.classList.remove('aviso--visivel');
  }, tipo === 'erro' ? 6000 : 3500);
}

/**
 * Traduz erros da Supabase para portugues, em vez de mostrar o texto ingles.
 */
export function traduzErro(erro) {
  if (!erro) return 'Ocorreu um erro inesperado.';
  const msg = String(erro.message || erro).toLowerCase();

  if (msg.includes('invalid login credentials')) return 'Email ou palavra-passe incorretos.';
  if (msg.includes('email not confirmed')) return 'Este email ainda não foi confirmado.';
  if (msg.includes('invalid totp code') || msg.includes('invalid mfa')) return 'Código de verificação inválido.';
  if (msg.includes('too many requests') || msg.includes('rate limit')) return 'Demasiadas tentativas. Aguarde um momento.';
  if (msg.includes('signups not allowed')) return 'O registo de novos utilizadores está desativado.';
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) return 'Sem ligação ao servidor. Verifique a Internet.';
  if (msg.includes('row-level security')) return 'Sem permissão para esta operação.';
  if (msg.includes('duplicate key') || msg.includes('already exists')) return 'Já existe um registo com esses dados.';
  if (msg.includes('jwt') && msg.includes('expired')) return 'A sessão expirou. Inicie sessão novamente.';

  return erro.message || 'Ocorreu um erro inesperado.';
}

/** Bloqueia/desbloqueia um botao enquanto uma operacao decorre. */
export function ocupado(botao, ativo, textoOcupado = 'A aguardar…') {
  if (!botao) return;
  if (ativo) {
    botao.dataset.textoOriginal = botao.textContent;
    botao.textContent = textoOcupado;
    botao.disabled = true;
  } else {
    botao.textContent = botao.dataset.textoOriginal || botao.textContent;
    botao.disabled = false;
  }
}

/**
 * Barra de separadores. itens: [{ nome, destino }]
 */
export function abas(itens, activo) {
  return el('nav', { class: 'abas', 'aria-label': 'Secções' },
    itens.map((item) => el('a', {
      class: 'abas__item' + (item.destino === activo ? ' abas__item--activo' : ''),
      href: '#/' + item.destino,
      'aria-current': item.destino === activo ? 'page' : null,
      text: item.nome,
    })),
  );
}

/** Estado vazio com accao directa, em vez de uma lista em branco. */
export function estadoVazio(mensagem, textoAccao, aoClicar) {
  return el('div', { class: 'vazio' }, [
    el('p', { class: 'vazio__texto', text: mensagem }),
    textoAccao ? el('button', { class: 'btn btn--primario', type: 'button', onclick: aoClicar, text: textoAccao }) : null,
  ]);
}
