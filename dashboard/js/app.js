/**
 * NetSentinel — Dashboard Application
 */

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  ws: null,
  connected: false,
  algorithm: 'round-robin',
  backends: [],
  analytics: null,
  requestLog: [],
  maxLog: 100
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  connectWS();
  initControls();
  startClock();
  loadInitialData();
});

function initCharts() {
  initRpsChart('rps-chart');
  initLatencyChart('latency-chart');
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);
  state.ws = ws;

  ws.onopen = () => {
    state.connected = true;
    setConnStatus(true);
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'update') handleUpdate(msg);
    if (msg.type === 'algorithm_changed') {
      state.algorithm = msg.algorithm;
      syncAlgoButtons(msg.algorithm);
    }
  };

  ws.onclose = () => {
    state.connected = false;
    setConnStatus(false);
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws.close();
}

function handleUpdate(msg) {
  state.analytics = msg.analytics;
  state.backends = msg.backends || [];

  updateTopStats(msg.analytics);
  updateBackendCards(msg.backends || []);
  updateRpsChart(msg.analytics?.rpsHistory);
  updateLatencyChart(msg.analytics?.latencyHistory);
  updateDistribution(msg.analytics?.backendDistribution);
  updateRLPanel(msg.rateLimiter);
  updateCBPanel(msg.backends || []);
}

// ─── Top Stats ────────────────────────────────────────────────────────────────
function updateTopStats(an) {
  if (!an) return;
  setText('stat-rps', an.rps);
  setText('stat-rps-sub', `Son 60s: ${an.totalLast60s} istek`);

  const p50 = an.latency?.p50 || 0;
  const p95 = an.latency?.p95 || 0;
  setText('stat-latency', p50);
  setText('stat-latency-sub', `P95: ${p95}ms | P99: ${an.latency?.p99 || 0}ms`);

  setText('stat-error', an.errorRate.toFixed(1));
  setText('stat-error-sub', `Son 60s hata oranı`);

  setText('stat-rl', an.rateLimitedCount);
  setText('stat-rl-sub', `Rate-limited istek`);
}

// ─── Backend Cards ────────────────────────────────────────────────────────────
const BACKEND_COLORS = ['#10b981', '#3b82f6', '#ef4444', '#f59e0b'];

function updateBackendCards(backends) {
  const container = document.getElementById('backends-container');
  if (!container) return;

  // İlk kez render
  if (container.children.length === 0) {
    backends.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'card backend-card healthy';
      card.id = `backend-card-${backendDomId(b.id)}`;
      card.innerHTML = buildBackendCardHTML(b, i);
      container.appendChild(card);
    });
  } else {
    backends.forEach((b, i) => updateBackendCard(b, i));
  }
}

function buildBackendCardHTML(b, i) {
  const domId = backendDomId(b.id);
  const port = escapeHTML(readPort(b.url));
  const cbState = normalizeCbState(b.circuitBreaker?.state);
  const cbIcon = { CLOSED: '🟢', OPEN: '🔴', HALF_OPEN: '🟡' }[cbState] || '🟢';
  const health = normalizeHealthStatus(b.healthy);
  const backendId = escapeHTML(b.id || 'backend');
  const weight = toFiniteNumber(b.weight);
  const totalRequests = toFiniteNumber(b.totalRequests);
  const activeConnections = toFiniteNumber(b.activeConnections);
  const errorRate = toFiniteNumber(b.errorRate);
  const avgLatency = toFiniteNumber(b.avgLatency);
  const color = BACKEND_COLORS[i % BACKEND_COLORS.length];

  return `
    <div class="backend-header">
      <div>
        <div class="backend-name">${backendId}</div>
        <div class="backend-url">:${port} · W:${weight}</div>
      </div>
      <span class="health-badge ${health}" id="health-${domId}">${health}</span>
    </div>
    <div class="backend-stats">
      <div class="bstat">
        <div class="bstat-label">Toplam İstek</div>
        <div class="bstat-value" id="total-${domId}" style="color:${color}">${totalRequests}</div>
      </div>
      <div class="bstat">
        <div class="bstat-label">Aktif Bağl.</div>
        <div class="bstat-value" id="conn-${domId}">${activeConnections}</div>
      </div>
      <div class="bstat">
        <div class="bstat-label">Hata Oranı</div>
        <div class="bstat-value" id="err-${domId}">${errorRate}%</div>
      </div>
      <div class="bstat">
        <div class="bstat-label">Ort. Gecikme</div>
        <div class="bstat-value" id="lat-${domId}">${avgLatency}ms</div>
      </div>
    </div>
    <div>
      <span class="cb-state ${cbState}" id="cb-${domId}">${cbIcon} ${cbState}</span>
    </div>
    <div class="req-bar" style="margin-top:10px">
      <div class="req-bar-fill" id="reqbar-${domId}" style="width:0%"></div>
    </div>
  `;
}

function updateBackendCard(b, i) {
  const domId = backendDomId(b.id);
  const card = document.getElementById(`backend-card-${domId}`);
  if (!card) return;

  const health = normalizeHealthStatus(b.healthy);
  card.className = `card backend-card ${b.healthy ? 'healthy' : 'unhealthy'}`;

  setText(`health-${domId}`, health);
  document.getElementById(`health-${domId}`)?.setAttribute('class', `health-badge ${health}`);

  setText(`total-${domId}`, toFiniteNumber(b.totalRequests));
  setText(`conn-${domId}`, toFiniteNumber(b.activeConnections));
  setText(`err-${domId}`, `${toFiniteNumber(b.errorRate)}%`);
  setText(`lat-${domId}`, `${toFiniteNumber(b.avgLatency)}ms`);

  const cbState = normalizeCbState(b.circuitBreaker?.state);
  const cbIcon = { CLOSED: '🟢', OPEN: '🔴', HALF_OPEN: '🟡' }[cbState] || '🟢';
  const cbEl = document.getElementById(`cb-${domId}`);
  if (cbEl) {
    cbEl.textContent = `${cbIcon} ${cbState}`;
    cbEl.className = `cb-state ${cbState}`;
  }

  // Toplam req'e göre bar genişliği
  const total = state.backends.reduce((s, bb) => s + toFiniteNumber(bb.totalRequests), 0);
  const pct = total > 0 ? clampPercent((toFiniteNumber(b.totalRequests) / total) * 100) : 0;
  const bar = document.getElementById(`reqbar-${domId}`);
  if (bar) bar.style.width = `${pct}%`;
}

// ─── Distribution Bars ────────────────────────────────────────────────────────
function updateDistribution(dist) {
  if (!dist) return;
  const container = document.getElementById('dist-bars');
  if (!container) return;

  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) return;

  const entries = Object.entries(dist);
  if (container.children.length === 0) {
    entries.forEach(([id, count], i) => {
      const domId = backendDomId(id);
      const pct = clampPercent((toFiniteNumber(count) / total) * 100).toFixed(1);
      const label = escapeHTML(id);
      const div = document.createElement('div');
      div.className = 'dist-item';
      div.innerHTML = `
        <div class="dist-label">
          <span>${label}</span>
          <span id="dist-val-${domId}">${pct}%</span>
        </div>
        <div class="dist-bar">
          <div class="dist-fill dist-fill-${i % BACKEND_COLORS.length}" id="dist-bar-${domId}" style="width:${pct}%"></div>
        </div>
      `;
      container.appendChild(div);
    });
  } else {
    entries.forEach(([id, count]) => {
      const domId = backendDomId(id);
      const pct = clampPercent((toFiniteNumber(count) / total) * 100).toFixed(1);
      setText(`dist-val-${domId}`, `${pct}%`);
      const bar = document.getElementById(`dist-bar-${domId}`);
      if (bar) bar.style.width = `${pct}%`;
    });
  }
}

// ─── Rate Limiter Panel ───────────────────────────────────────────────────────
function updateRLPanel(rl) {
  if (!rl) return;
  setText('rl-active-buckets', rl.activeBuckets);
  setText('rl-accepted', rl.totalAccepted);
  setText('rl-rejected', rl.totalRejected);
  setText('rl-reject-rate', `${rl.rejectRate}%`);
}

// ─── Circuit Breaker Panel ────────────────────────────────────────────────────
function updateCBPanel(backends) {
  const container = document.getElementById('cb-list');
  if (!container) return;

  if (container.children.length === 0) {
    backends.forEach(b => {
      const domId = backendDomId(b.id);
      const item = document.createElement('div');
      item.className = 'cb-item';
      item.id = `cbitem-${domId}`;

      const nameEl = document.createElement('div');
      nameEl.className = 'cb-item-name';
      nameEl.textContent = String(b.id || 'backend');

      const stateEl = document.createElement('span');
      stateEl.className = 'cb-state CLOSED';
      stateEl.id = `cbitem-state-${domId}`;
      stateEl.textContent = '🟢 CLOSED';

      const failEl = document.createElement('span');
      failEl.className = 'cb-item-fails';
      failEl.id = `cbitem-fails-${domId}`;
      failEl.textContent = '0 hata';

      const resetBtn = document.createElement('button');
      resetBtn.className = 'reset-btn';
      resetBtn.type = 'button';
      resetBtn.textContent = 'Reset';
      resetBtn.addEventListener('click', () => resetCB(String(b.id || 'backend')));

      item.append(nameEl, stateEl, failEl, resetBtn);
      container.appendChild(item);
    });
  } else {
    backends.forEach(b => {
      const domId = backendDomId(b.id);
      const cb = b.circuitBreaker || { state: 'CLOSED', failCount: 0 };
      const cbState = normalizeCbState(cb.state);
      const icon = { CLOSED: '🟢', OPEN: '🔴', HALF_OPEN: '🟡' }[cb.state] || '🟢';
      const el = document.getElementById(`cbitem-state-${domId}`);
      if (el) {
        el.textContent = `${icon} ${cbState}`;
        el.className = `cb-state ${cbState}`;
      }
      setText(`cbitem-fails-${domId}`, `${toFiniteNumber(cb.failCount)} hata`);
    });
  }
}

async function resetCB(backendId) {
  try {
    await fetch(`/api/circuitbreaker/reset/${encodeURIComponent(backendId)}`, { method: 'POST' });
    showToast(`✅ ${backendId} circuit breaker sıfırlandı`, 'success');
  } catch (e) {
    showToast('❌ Reset başarısız', 'error');
  }
}

// ─── Algorithm Select ─────────────────────────────────────────────────────────
async function setAlgorithm(algo) {
  try {
    const res = await fetch('/api/algorithm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithm: algo })
    });
    if (res.ok) {
      state.algorithm = algo;
      syncAlgoButtons(algo);
      const names = { 'round-robin': 'Round Robin', 'least-connections': 'Least Connections', 'weighted': 'Weighted RR' };
      showToast(`🔀 Algoritma: ${names[algo]}`, 'success');
    }
  } catch (e) { showToast('Algoritma değiştirilemedi', 'error'); }
}

function syncAlgoButtons(algo) {
  document.querySelectorAll('.algo-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.algo === algo);
  });
}

// ─── Load Test ────────────────────────────────────────────────────────────────
async function runLoadTest() {
  const btn = document.getElementById('load-test-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Test...'; }

  try {
    const res = await fetch('/api/load-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 50, concurrency: 10 })
    });
    const data = await res.json();
    showToast(`✅ Yük testi: ${data.success} başarılı, ${data.failed} hata, ${data.rateLimited} RL`, 'success');
  } catch (e) {
    showToast('Yük testi başarısız', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Yük Testi'; }
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function initControls() {
  document.querySelectorAll('.algo-btn').forEach(btn => {
    btn.addEventListener('click', () => setAlgorithm(btn.dataset.algo));
  });

  const ltBtn = document.getElementById('load-test-btn');
  if (ltBtn) ltBtn.addEventListener('click', runLoadTest);

  const rlForm = document.getElementById('rl-form');
  if (rlForm) {
    rlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const maxTokens = parseInt(document.getElementById('rl-max').value);
      const refillRate = parseInt(document.getElementById('rl-refill').value);
      try {
        await fetch('/api/ratelimiter/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxTokens, refillRate })
        });
        showToast(`✅ Rate limiter güncellendi`, 'success');
      } catch (e) { showToast('Güncelleme başarısız', 'error'); }
    });
  }
}

// ─── Initial Data ─────────────────────────────────────────────────────────────
async function loadInitialData() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.algorithm = data.algorithm;
    syncAlgoButtons(data.algorithm);
  } catch (e) {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function setConnStatus(connected) {
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  if (dot) dot.className = `conn-dot${connected ? '' : ' off'}`;
  if (txt) txt.textContent = connected ? 'Bağlı' : 'Bağlantı Yok';
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPercent(value) {
  return Math.min(Math.max(toFiniteNumber(value), 0), 100);
}

function backendDomId(value) {
  const sanitized = String(value ?? 'backend').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return sanitized || 'backend';
}

function normalizeHealthStatus(value) {
  return value ? 'UP' : 'DOWN';
}

function normalizeCbState(value) {
  const normalized = String(value ?? '').toUpperCase();
  return ['CLOSED', 'OPEN', 'HALF_OPEN'].includes(normalized) ? normalized : 'CLOSED';
}

function readPort(url) {
  try {
    const parsed = new URL(String(url ?? ''));
    return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  } catch (e) {
    return '?';
  }
}

function startClock() {
  const tick = () => { const el = document.getElementById('clock'); if (el) el.textContent = new Date().toLocaleTimeString('tr-TR'); };
  tick(); setInterval(tick, 1000);
}

function showToast(msg, type = 'success') {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  wrap.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}
