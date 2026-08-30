// -----------------------------------------------------------------------------
// Formatacao central. Todo o dinheiro mostrado na app passa por aqui.
//
// NOTA DELIBERADA: o formato monetario usa virgula como separador de milhares e
// ponto como separador decimal (1,234.56 EUR), ao contrario do costume
// portugues (1 234,56 EUR). E uma escolha explicita do utilizador -- nao
// "corrigir" para toLocaleString('pt-PT'), que produziria o formato errado.
// -----------------------------------------------------------------------------

const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const MESES_CURTOS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

/**
 * Agrupa a parte inteira em milhares com virgula.
 */
function agruparMilhares(inteiro) {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formata um valor monetario. Ex: formatMoney(-1234.5) -> "-1,234.50 EUR"
 * @param {number|string} valor
 * @param {object} opcoes
 * @param {boolean} opcoes.sinal  Forca o "+" nos valores positivos.
 * @param {string}  opcoes.moeda  Simbolo da moeda (por defeito euro).
 */
export function formatMoney(valor, opcoes = {}) {
  const { sinal = false, moeda = '€' } = opcoes;
  const n = Number(valor);
  const seguro = Number.isFinite(n) ? n : 0;
  const negativo = seguro < 0;
  const [inteiro, decimal] = Math.abs(seguro).toFixed(2).split('.');

  let prefixo = '';
  if (negativo) prefixo = '-';
  else if (sinal && seguro > 0) prefixo = '+';

  return `${prefixo}${agruparMilhares(inteiro)}.${decimal} ${moeda}`;
}

/**
 * Devolve a classe CSS de cor conforme o sinal do valor.
 */
export function classeValor(valor) {
  const n = Number(valor) || 0;
  if (n > 0) return 'valor valor--positivo';
  if (n < 0) return 'valor valor--negativo';
  return 'valor valor--neutro';
}

/**
 * Converte uma data ISO (aaaa-mm-dd) para o formato portugues dd/mm/aaaa.
 */
export function formatDate(iso) {
  if (!iso) return '';
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Nome do mes por extenso a partir de uma data ISO ou de um indice 0-11.
 */
export function nomeMes(valor, curto = false) {
  const lista = curto ? MESES_CURTOS : MESES;
  const i = typeof valor === 'number'
    ? valor
    : Number(String(valor).slice(5, 7)) - 1;
  return lista[i] ?? '';
}

/**
 * "agosto de 2026" -- cabecalho dos ecras mensais.
 */
export function rotuloMes(iso) {
  const ano = String(iso).slice(0, 4);
  return `${nomeMes(iso)} de ${ano}`;
}

/**
 * Data de hoje em ISO, sem componente horaria e sem saltos de fuso horario.
 */
export function hojeISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Primeiro dia do mes de uma data ISO -- os orcamentos guardam sempre o dia 1.
 */
export function primeiroDiaDoMes(iso) {
  return `${String(iso).slice(0, 7)}-01`;
}
