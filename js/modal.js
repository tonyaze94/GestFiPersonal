// -----------------------------------------------------------------------------
// Janelas de dialogo reutilizaveis, construidas sobre o elemento <dialog>
// nativo -- sem biblioteca externa. Tratam do foco e da tecla Escape sozinhas.
// -----------------------------------------------------------------------------
import { el, $ } from './ui.js';

/** Paleta sugerida para categorias e etiquetas. */
export const PALETA = [
  '#D9483C', '#E8A33D', '#E3C84B', '#7BB661', '#1F9D6B',
  '#3AA6A6', '#2B5CB8', '#5B63C4', '#8A5BC4', '#C4589B',
  '#9C7A5B', '#6B7280',
];

function fechar(dialogo) {
  dialogo.close();
  dialogo.remove();
}

/**
 * Formulario numa janela de dialogo.
 *
 * @param {object} opcoes
 * @param {string} opcoes.titulo
 * @param {Array}  opcoes.campos   {nome, etiqueta, tipo, valor, opcoes, obrigatorio, ajuda}
 * @param {string} opcoes.confirmar  texto do botao principal
 * @returns {Promise<object|null>}   valores preenchidos, ou null se cancelado
 */
export function dialogoFormulario({ titulo, campos, confirmar = 'Guardar' }) {
  return new Promise((resolve) => {
    const form = el('form', { class: 'dialogo__form', method: 'dialog' });

    for (const campo of campos) {
      let controlo;

      if (campo.tipo === 'seleccao') {
        controlo = el('select', { name: campo.nome, id: 'c-' + campo.nome });
        for (const opcao of campo.opcoes) {
          const item = el('option', { value: opcao.valor, text: opcao.etiqueta });
          if (String(opcao.valor) === String(campo.valor)) item.selected = true;
          controlo.append(item);
        }
      } else if (campo.tipo === 'cor') {
        controlo = el('div', { class: 'paleta' });
        for (const cor of PALETA) {
          const escolhido = (campo.valor || PALETA[0]).toLowerCase() === cor.toLowerCase();
          const botao = el('button', {
            type: 'button',
            class: 'paleta__cor' + (escolhido ? ' paleta__cor--activa' : ''),
            style: 'background:' + cor,
            'data-cor': cor,
            'aria-label': 'Cor ' + cor,
          });
          botao.addEventListener('click', () => {
            for (const outro of controlo.querySelectorAll('.paleta__cor')) {
              outro.classList.remove('paleta__cor--activa');
            }
            botao.classList.add('paleta__cor--activa');
          });
          controlo.append(botao);
        }
      } else if (campo.tipo === 'interruptor') {
        controlo = el('input', { type: 'checkbox', name: campo.nome, id: 'c-' + campo.nome });
        controlo.checked = Boolean(campo.valor);
      } else if (campo.tipo === 'etiquetas') {
        controlo = el('div', { class: 'escolha-etiquetas' });
        const escolhidas = new Set(campo.valor || []);
        for (const etiqueta of campo.opcoes) {
          const activa = escolhidas.has(etiqueta.id);
          const botao = el('button', {
            type: 'button',
            class: 'etiqueta-opcao' + (activa ? ' etiqueta-opcao--activa' : ''),
            'data-id': etiqueta.id,
            'aria-pressed': activa ? 'true' : 'false',
          }, [
            el('span', { class: 'chip__ponto', style: 'background:' + (etiqueta.color || '#6B7280') }),
            el('span', { text: etiqueta.name }),
          ]);
          botao.addEventListener('click', () => {
            const ligada = botao.classList.toggle('etiqueta-opcao--activa');
            botao.setAttribute('aria-pressed', ligada ? 'true' : 'false');
          });
          controlo.append(botao);
        }
        if (!campo.opcoes.length) {
          controlo.append(el('span', { class: 'campo__ajuda',
            text: 'Ainda não há etiquetas criadas.' }));
        }
      } else if (campo.tipo === 'texto-longo') {
        controlo = el('textarea', {
          name: campo.nome, id: 'c-' + campo.nome, rows: '2',
          maxlength: campo.maximo || null,
        }, [campo.valor ?? '']);
      } else {
        controlo = el('input', {
          type: campo.tipo || 'text',
          name: campo.nome,
          id: 'c-' + campo.nome,
          value: campo.valor ?? '',
          inputmode: campo.tipo === 'number' ? 'decimal' : null,
          step: campo.tipo === 'number' ? '0.01' : null,
          maxlength: campo.maximo || null,
          required: campo.obrigatorio || null,
        });
      }

      // Um interruptor lê-se melhor com a etiqueta ao lado da caixa.
      const invólucro = campo.tipo === 'interruptor'
        ? el('label', { class: 'campo campo--interruptor' }, [
            controlo,
            el('span', { class: 'campo__etiqueta', text: campo.etiqueta }),
          ])
        : el('label', { class: 'campo' }, [
            el('span', { class: 'campo__etiqueta', text: campo.etiqueta }),
            controlo,
          ]);

      if (campo.ajuda) invólucro.append(el('span', { class: 'campo__ajuda', text: campo.ajuda }));
      invólucro.dataset.campo = campo.nome;
      form.append(invólucro);
    }

    // Campos que só fazem sentido quando outro campo está ligado.
    for (const campo of campos.filter((c) => c.dependeDe)) {
      const mestre = form.elements[campo.dependeDe];
      const secção = form.querySelector('[data-campo="' + campo.nome + '"]');
      if (!mestre || !secção) continue;
      const sincronizar = () => secção.classList.toggle('campo--inactivo', !mestre.checked);
      mestre.addEventListener('change', sincronizar);
      sincronizar();
    }

    const dialogo = el('dialog', { class: 'dialogo' }, [
      el('h2', { class: 'dialogo__titulo', text: titulo }),
      form,
      el('div', { class: 'dialogo__accoes' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancelar',
          onclick: () => { fechar(dialogo); resolve(null); } }),
        el('button', { class: 'btn btn--primario', type: 'submit', form: form.id || null,
          text: confirmar, onclick: (e) => { e.preventDefault(); submeter(); } }),
      ]),
    ]);

    function submeter() {
      if (!form.reportValidity()) return;
      const valores = {};
      for (const campo of campos) {
        if (campo.tipo === 'cor') {
          const activa = form.querySelector('.paleta__cor--activa');
          valores[campo.nome] = activa ? activa.dataset.cor : PALETA[0];
        } else if (campo.tipo === 'interruptor') {
          valores[campo.nome] = Boolean(form.elements[campo.nome]?.checked);
        } else if (campo.tipo === 'etiquetas') {
          valores[campo.nome] = [...form.querySelectorAll('.etiqueta-opcao--activa')]
            .map((b) => b.dataset.id);
        } else {
          const controlo = form.elements[campo.nome];
          valores[campo.nome] = controlo ? controlo.value.trim() : '';
        }
      }
      fechar(dialogo);
      resolve(valores);
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); submeter(); });
    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); fechar(dialogo); resolve(null); });

    document.body.append(dialogo);
    dialogo.showModal();
    const primeiro = form.querySelector('input, select');
    if (primeiro) primeiro.focus();
  });
}

/**
 * Confirmacao antes de uma accao destrutiva.
 * @returns {Promise<boolean>}
 */
export function dialogoConfirmar({ titulo, mensagem, confirmar = 'Apagar', perigo = true }) {
  return new Promise((resolve) => {
    const dialogo = el('dialog', { class: 'dialogo' }, [
      el('h2', { class: 'dialogo__titulo', text: titulo }),
      el('p', { class: 'dialogo__texto', text: mensagem }),
      el('div', { class: 'dialogo__accoes' }, [
        el('button', { class: 'btn', type: 'button', text: 'Cancelar',
          onclick: () => { fechar(dialogo); resolve(false); } }),
        el('button', {
          class: 'btn ' + (perigo ? 'btn--destrutivo' : 'btn--primario'),
          type: 'button', text: confirmar,
          onclick: () => { fechar(dialogo); resolve(true); },
        }),
      ]),
    ]);

    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); fechar(dialogo); resolve(false); });
    document.body.append(dialogo);
    dialogo.showModal();
    dialogo.querySelector('.btn').focus();
  });
}
