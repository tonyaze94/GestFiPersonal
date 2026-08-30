// -----------------------------------------------------------------------------
// Autenticacao: email + palavra-passe, seguidos de MFA (TOTP) obrigatorio.
//
// A app so mostra dados quando a sessao atinge o nivel AAL2, ou seja, quando o
// segundo fator foi validado. Um utilizador sem fator inscrito e obrigado a
// inscrever um antes de continuar -- o URL da app e publico, por isso a
// palavra-passe nao pode ser a unica barreira.
// -----------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';
import { $, avisar, traduzErro, ocupado } from './ui.js';

/** Passos possiveis do ecra de entrada. */
const PASSO = {
  CREDENCIAIS: 'credenciais',
  CODIGO: 'codigo',
  INSCRICAO: 'inscricao',
};

let fatorEmInscricao = null;   // id do fator TOTP a ser inscrito
let aoAutenticar = () => {};   // callback disparado quando a sessao chega a AAL2

// -----------------------------------------------------------------------------
// Navegacao entre passos
// -----------------------------------------------------------------------------

function mostrarPasso(passo) {
  for (const nome of Object.values(PASSO)) {
    const seccao = $('#passo-' + nome);
    if (seccao) seccao.hidden = nome !== passo;
  }
  // Foco no primeiro campo do passo activo, para poder escrever de imediato.
  const primeiro = $('#passo-' + passo + ' input');
  if (primeiro) setTimeout(() => primeiro.focus(), 50);
}

function mostrarEcraEntrada() {
  $('#vista-entrada').hidden = false;
  $('#vista-app').hidden = true;
}

function mostrarEcraApp() {
  $('#vista-entrada').hidden = true;
  $('#vista-app').hidden = false;
}

// -----------------------------------------------------------------------------
// Nivel de garantia da sessao (AAL)
// -----------------------------------------------------------------------------

/**
 * Decide o que fazer com a sessao actual:
 *   'entrar'     -> ja esta em AAL2, pode ver os dados
 *   'codigo'     -> tem fator inscrito mas ainda nao o validou nesta sessao
 *   'inscricao'  -> nao tem fator nenhum, tem de inscrever um agora
 *   'sem-sessao' -> nao ha sessao iniciada
 */
async function avaliarSessao() {
  const { data: sessaoActual } = await supabase.auth.getSession();
  if (!sessaoActual.session) return 'sem-sessao';

  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;

  const { currentLevel, nextLevel } = data;
  if (currentLevel === 'aal2') return 'entrar';
  if (nextLevel === 'aal2') return 'codigo';
  return 'inscricao';
}

/** Encaminha para o passo certo consoante o estado da sessao. */
async function encaminhar() {
  let estado;
  try {
    estado = await avaliarSessao();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
    estado = 'sem-sessao';
  }

  if (estado === 'entrar') {
    mostrarEcraApp();
    aoAutenticar();
    return;
  }

  mostrarEcraEntrada();
  if (estado === 'codigo') mostrarPasso(PASSO.CODIGO);
  else if (estado === 'inscricao') await prepararInscricao();
  else mostrarPasso(PASSO.CREDENCIAIS);
}

// -----------------------------------------------------------------------------
// Passo 1 -- email e palavra-passe
// -----------------------------------------------------------------------------

async function submeterCredenciais(evento) {
  evento.preventDefault();
  const botao = $('#btn-entrar');
  const email = $('#campo-email').value.trim();
  const password = $('#campo-password').value;

  if (!email || !password) {
    avisar('Preencha o email e a palavra-passe.', 'erro');
    return;
  }

  ocupado(botao, true, 'A entrar…');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  ocupado(botao, false);

  if (error) {
    avisar(traduzErro(error), 'erro');
    $('#campo-password').value = '';
    $('#campo-password').focus();
    return;
  }

  $('#campo-password').value = '';
  await encaminhar();
}

// -----------------------------------------------------------------------------
// Passo 2 -- codigo TOTP de um fator ja inscrito
// -----------------------------------------------------------------------------

async function submeterCodigo(evento) {
  evento.preventDefault();
  const botao = $('#btn-codigo');
  const code = $('#campo-codigo').value.replace(/\D/g, '');

  if (code.length !== 6) {
    avisar('Introduza os 6 dígitos do código.', 'erro');
    return;
  }

  ocupado(botao, true, 'A verificar…');
  try {
    const { data: fatores, error: erroLista } = await supabase.auth.mfa.listFactors();
    if (erroLista) throw erroLista;

    const fator = (fatores.totp || []).find((f) => f.status === 'verified');
    if (!fator) {
      // O fator foi removido no dashboard entretanto: volta a inscricao.
      await prepararInscricao();
      return;
    }

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: fator.id,
      code,
    });
    if (error) throw error;

    $('#campo-codigo').value = '';
    await encaminhar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
    $('#campo-codigo').value = '';
    $('#campo-codigo').focus();
  } finally {
    ocupado(botao, false);
  }
}

// -----------------------------------------------------------------------------
// Passo 3 -- inscricao do fator TOTP
// -----------------------------------------------------------------------------

/**
 * Remove fatores que ficaram por confirmar de tentativas anteriores, para que
 * uma nova inscricao nao rebente com "factor already exists".
 */
async function limparFatoresPendentes() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return;
  const pendentes = (data.all || []).filter((f) => f.status !== 'verified');
  for (const fator of pendentes) {
    await supabase.auth.mfa.unenroll({ factorId: fator.id });
  }
}

async function prepararInscricao() {
  mostrarPasso(PASSO.INSCRICAO);
  const alvoQr = $('#qr-mfa');
  const alvoSegredo = $('#segredo-mfa');
  alvoQr.replaceChildren();
  alvoSegredo.textContent = 'a gerar…';

  try {
    await limparFatoresPendentes();

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Telemovel ' + new Date().toISOString().slice(0, 10),
    });
    if (error) throw error;

    fatorEmInscricao = data.id;

    // qr_code vem como data-URI de um SVG pronto a mostrar.
    const img = document.createElement('img');
    img.src = data.totp.qr_code;
    img.alt = 'Código QR para a aplicação de autenticação';
    img.className = 'qr';
    alvoQr.append(img);

    alvoSegredo.textContent = data.totp.secret;
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
    alvoSegredo.textContent = '--';
  }
}

async function confirmarInscricao(evento) {
  evento.preventDefault();
  const botao = $('#btn-inscricao');
  const code = $('#campo-inscricao').value.replace(/\D/g, '');

  if (code.length !== 6) {
    avisar('Introduza os 6 dígitos mostrados na aplicação.', 'erro');
    return;
  }
  if (!fatorEmInscricao) {
    avisar('A inscrição expirou. Recarregue a página.', 'erro');
    return;
  }

  ocupado(botao, true, 'A confirmar…');
  try {
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: fatorEmInscricao,
      code,
    });
    if (error) throw error;

    $('#campo-inscricao').value = '';
    fatorEmInscricao = null;
    avisar('Verificação em dois passos ativada.', 'sucesso');
    await encaminhar();
  } catch (erro) {
    avisar(traduzErro(erro), 'erro');
    $('#campo-inscricao').value = '';
    $('#campo-inscricao').focus();
  } finally {
    ocupado(botao, false);
  }
}

// -----------------------------------------------------------------------------
// Sessao
// -----------------------------------------------------------------------------

export async function terminarSessao() {
  await supabase.auth.signOut();
  location.reload();   // limpa todo o estado em memoria
}

export async function utilizadorActual() {
  const { data } = await supabase.auth.getUser();
  return data ? data.user : null;
}

/**
 * Liga os formularios de entrada e decide o ecra inicial.
 * @param {Function} callback  chamado quando a sessao esta validada em AAL2.
 */
export async function iniciarAuth(callback) {
  aoAutenticar = callback;

  $('#form-credenciais').addEventListener('submit', submeterCredenciais);
  $('#form-codigo').addEventListener('submit', submeterCodigo);
  $('#form-inscricao').addEventListener('submit', confirmarInscricao);
  $('#btn-sair').addEventListener('click', terminarSessao);

  // Voltar atras a partir de um passo de MFA termina a sessao parcial.
  for (const botao of document.querySelectorAll('[data-accao="cancelar-mfa"]')) {
    botao.addEventListener('click', terminarSessao);
  }

  supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') {
      mostrarEcraEntrada();
      mostrarPasso(PASSO.CREDENCIAIS);
    }
  });

  await encaminhar();
}
