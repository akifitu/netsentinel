/**
 * NetSentinel — Charts Module
 */

const MAX_POINTS = 60;

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 250 },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(13,17,23,0.95)',
      borderColor: 'rgba(59,130,246,0.3)',
      borderWidth: 1,
      titleColor: '#94a3b8',
      bodyColor: '#f1f5f9',
      padding: 10,
      cornerRadius: 8
    }
  },
  scales: {
    x: { display: false },
    y: {
      grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
      ticks: { color: '#475569', font: { family: "'JetBrains Mono'", size: 10 }, maxTicksLimit: 5 }
    }
  }
};

function mkGrad(ctx, c1, c2) {
  const g = ctx.createLinearGradient(0, 0, 0, 180);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  return g;
}

function initLabels() { return Array.from({ length: MAX_POINTS }, (_, i) => `${MAX_POINTS - i}s`); }
function push(arr, v) { arr.push(v); if (arr.length > MAX_POINTS) arr.shift(); }

// ─── RPS Chart ────────────────────────────────────────────────────────────────
let rpsChart;
const rpsData = new Array(MAX_POINTS).fill(0);

function initRpsChart(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  rpsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: initLabels(),
      datasets: [{
        label: 'RPS',
        data: [...rpsData],
        backgroundColor: 'rgba(59,130,246,0.5)',
        borderColor: '#3b82f6',
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${v} rps` } } }
    }
  });
}

function updateRpsChart(history) {
  if (!rpsChart || !history) return;
  rpsChart.data.datasets[0].data = [...history];
  rpsChart.update('none');
}

// ─── Latency Chart ────────────────────────────────────────────────────────────
let latencyChart;
const latData = new Array(MAX_POINTS).fill(0);

function initLatencyChart(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const grad = mkGrad(ctx, 'rgba(6,182,212,0.5)', 'rgba(6,182,212,0.02)');
  latencyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: initLabels(),
      datasets: [{
        label: 'Latency (ms)',
        data: [...latData],
        borderColor: '#06b6d4',
        backgroundColor: grad,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${v}ms` } } }
    }
  });
}

function updateLatencyChart(history) {
  if (!latencyChart || !history) return;
  latencyChart.data.datasets[0].data = [...history];
  latencyChart.update('none');
}

window.initRpsChart = initRpsChart;
window.updateRpsChart = updateRpsChart;
window.initLatencyChart = initLatencyChart;
window.updateLatencyChart = updateLatencyChart;
