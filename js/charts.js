// Chart.js は index.html でグローバルに読み込んでいる（オフライン用にvendor同梱）
const registry = new Map();

function draw(canvasId, config) {
  registry.get(canvasId)?.destroy();
  const chart = new Chart(document.getElementById(canvasId), config);
  registry.set(canvasId, chart);
  return chart;
}

const COLORS = { accent: '#40e8ff', muscle: '#4ade80', fat: '#ff5e6c', weight: '#8b95a8' };

const BASE_OPTIONS = {
  responsive: true,
  plugins: { legend: { labels: { color: '#e8ecf4' } } },
  scales: {
    x: { ticks: { color: '#8b95a8' }, grid: { color: '#262c38' } },
    y: { ticks: { color: '#8b95a8' }, grid: { color: '#262c38' } }
  }
};

export function drawVolumeChart(canvasId, weeks) {
  return draw(canvasId, {
    type: 'bar',
    data: {
      labels: weeks.map((w) => w.week),
      datasets: [{ label: '週次総挙上量(kg)', data: weeks.map((w) => Math.round(w.volume)), backgroundColor: COLORS.accent }]
    },
    options: BASE_OPTIONS
  });
}

export function drawBodyChart(canvasId, series) {
  return draw(canvasId, {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [
        { label: '体重(kg)', data: series.weight, borderColor: COLORS.weight, yAxisID: 'y' },
        { label: '筋肉量(kg)', data: series.muscle, borderColor: COLORS.muscle, yAxisID: 'y' },
        { label: '体脂肪率(%)', data: series.fatPct, borderColor: COLORS.fat, yAxisID: 'y1' }
      ]
    },
    options: {
      ...BASE_OPTIONS,
      scales: {
        ...BASE_OPTIONS.scales,
        y1: { position: 'right', ticks: { color: '#8b95a8' }, grid: { display: false } }
      }
    }
  });
}

export function drawRadarChart(canvasId, radar) {
  return draw(canvasId, {
    type: 'radar',
    data: {
      labels: radar.map((r) => r.label),
      datasets: [{
        label: '部位レベル',
        data: radar.map((r) => r.level),
        borderColor: COLORS.accent,
        backgroundColor: 'rgba(64,232,255,.2)'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#e8ecf4' } } },
      scales: { r: {
        angleLines: { color: '#262c38' }, grid: { color: '#262c38' },
        pointLabels: { color: '#e8ecf4' }, ticks: { color: '#8b95a8', backdropColor: 'transparent' },
        beginAtZero: true
      } }
    }
  });
}
