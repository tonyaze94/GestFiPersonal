// -----------------------------------------------------------------------------
// Graficos. Camada fina sobre o Chart.js, carregado da CDN.
//
// Cada categoria usa sempre a sua propria cor, a mesma que aparece nos chips e
// nas barras de orcamento -- e o que permite reconhecer uma categoria de
// relance em qualquer ecra.
// -----------------------------------------------------------------------------
import Chart from 'https://esm.sh/chart.js@4/auto';

const COR_TEXTO = '#E8E9EC';
const COR_FRACA = '#6B7280';
const COR_BORDA = '#2A2F3A';
const COR_SUPERFICIE = '#1C2029';

// Menos tinta: sem grelhas decorativas nem animacoes longas.
Chart.defaults.color = COR_FRACA;
Chart.defaults.borderColor = COR_BORDA;
Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
Chart.defaults.animation.duration = 200;

/** Guarda os graficos por elemento, para os destruir antes de redesenhar. */
const activos = new WeakMap();

function preparar(canvas) {
  const anterior = activos.get(canvas);
  if (anterior) anterior.destroy();
  return canvas;
}

/**
 * Anel com o peso de cada categoria nas saidas do mes.
 * @param {HTMLCanvasElement} canvas
 * @param {Array} dados  [{ nome, valor, cor }]
 * @param {Function} formatar  funcao de formatacao monetaria
 */
export function anelPorCategoria(canvas, dados, formatar) {
  preparar(canvas);
  const grafico = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: dados.map((d) => d.nome),
      datasets: [{
        data: dados.map((d) => d.valor),
        backgroundColor: dados.map((d) => d.cor),
        borderColor: COR_SUPERFICIE,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 10, boxHeight: 10, padding: 12, color: COR_TEXTO },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ' ' + ctx.label + ': ' + formatar(ctx.parsed),
          },
        },
      },
    },
  });
  activos.set(canvas, grafico);
  return grafico;
}

/**
 * Barras horizontais: gasto real contra orcamento, por categoria.
 * @param {Array} dados  [{ nome, gasto, orcamento, cor }]
 */
export function barrasGastoOrcamento(canvas, dados, formatar) {
  preparar(canvas);
  const grafico = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: dados.map((d) => d.nome),
      datasets: [
        {
          label: 'Gasto',
          data: dados.map((d) => d.gasto),
          backgroundColor: dados.map((d) => d.cor),
          borderRadius: 3,
        },
        {
          label: 'Orçamento',
          data: dados.map((d) => d.orcamento ?? 0),
          backgroundColor: 'rgba(107,114,128,.28)',
          borderRadius: 3,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: COR_BORDA }, ticks: { callback: (v) => formatar(v) } },
        y: { grid: { display: false }, ticks: { color: COR_TEXTO } },
      },
      plugins: {
        legend: { labels: { boxWidth: 10, boxHeight: 10, color: COR_TEXTO } },
        tooltip: {
          callbacks: { label: (ctx) => ' ' + ctx.dataset.label + ': ' + formatar(ctx.parsed.x) },
        },
      },
    },
  });
  activos.set(canvas, grafico);
  return grafico;
}
