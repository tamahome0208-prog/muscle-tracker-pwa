// Chart.js は index.html でグローバルに読み込んでいる（オフライン用にvendor同梱）
const registry = new Map();

function draw(canvasId, config) {
  registry.get(canvasId)?.destroy();
  const chart = new Chart(document.getElementById(canvasId), config);
  registry.set(canvasId, chart);
  return chart;
}

const COLORS = { accent: '#e4572e', muscle: '#4ade80', fat: '#ff5e6c', weight: '#a8a29b' };

const BASE_OPTIONS = {
  responsive: true,
  plugins: { legend: { labels: { color: '#f5f2ee' } } },
  scales: {
    x: { ticks: { color: '#a8a29b' }, grid: { color: '#26262b' } },
    y: { ticks: { color: '#a8a29b' }, grid: { color: '#26262b' } }
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
        y1: { position: 'right', ticks: { color: '#a8a29b' }, grid: { display: false } }
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
        backgroundColor: 'rgba(228,87,46,.2)'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#f5f2ee' } } },
      scales: { r: {
        angleLines: { color: '#26262b' }, grid: { color: '#26262b' },
        pointLabels: { color: '#f5f2ee' }, ticks: { color: '#a8a29b', backdropColor: 'transparent' },
        beginAtZero: true
      } }
    }
  });
}
