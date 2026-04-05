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
      card.id = `backend-card-${b.id}`;
      card.innerHTML = buildBackendCardHTML(b, i);
      container.appendChild(card);
    });
  } else {
    backends.forEach((b, i) => updateBackendCard(b, i));
  }
}

function buildBackendCardHTML(b, i) {
  const port = new URL(b.url).port;
  const cbState = b.circuitBreaker?.state || 'CLOSED';
  const cbIcon = { CLOSED: '🟢', OPEN: '🔴', HALF_OPEN: '🟡' }[cbState] || '🟢';
  const health = b.healthy ? 'UP' : 'DOWN';

  return `
    <div class="backend-header">
      <div>
        <div class="backend-name">${b.id}</div>
        <div class="backend-url">:${port} · W:${b.weight}</div>
      </div>
      <span class="health-badge ${health}" id="health-${b.id}">${health}</span>
    </div>
    <div class="backend-stats">
      <div class="bstat">
        <div class="bstat-label">Toplam İstek</div>
        <div class="bstat-value" id="total-${b.id}" style="color:${BACKEND_COLORS[i]}">${b.totalRequests}</div>
      </div>
      <div class="bstat">
        <div class="bstat-label">Aktif Bağl.</div>
        <div class="bstat-value" id="conn-${b.id}">${b.activeConnections}</div>
      </div>
      <div class="bstat">
        <div class="bstat-label">Hata Oranı</div>
        <div class="bstat-value" id="err-${b.id}">${b.errorRate}%</div>
      </div>
      <div class="bstat">
        <div class="bstat-label">Ort. Gecikme</div>
        <div class="bstat-value" id="lat-${b.id}">${b.avgLatency}ms</div>
      </div>
    </div>
    <div>
      <span class="cb-state ${cbState}" id="cb-${b.id}">${cbIcon} ${cbState}</span>
    </div>
    <div class="req-bar" style="margin-top:10px">
      <div class="req-bar-fill" id="reqbar-${b.id}" style="width:0%"></div>
    </div>
  `;
}

function updateBackendCard(b, i) {
  const card = document.getElementById(`backend-card-${b.id}`);
  if (!card) return;

  const health = b.healthy ? 'UP' : 'DOWN';
  card.className = `card backend-card ${b.healthy ? 'healthy' : 'unhealthy'}`;

  setHTML(`health-${b.id}`, health);
  document.getElementById(`health-${b.id}`)?.setAttribute('class', `health-badge ${health}`);

  setText(`total-${b.id}`, b.totalRequests);
  setText(`conn-${b.id}`, b.activeConnections);
  setText(`err-${b.id}`, `${b.errorRate}%`);
  setText(`lat-${b.id}`, `${b.avgLatency}ms`);

  const cbState = b.circuitBreaker?.state || 'CLOSED';
  const cbIcon = { CLOSED: '🟢', OPEN: '🔴', HALF_OPEN: '🟡' }[cbState] || '🟢';
  const cbEl = document.getElementById(`cb-${b.id}`);
  if (cbEl) {
    cbEl.textContent = `${cbIcon} ${cbState}`;
    cbEl.className = `cb-state ${cbState}`;
  }

  // Toplam req'e göre bar genişliği
  const total = state.backends.reduce((s, bb) => s + bb.totalRequests, 0);
  const pct = total > 0 ? (b.totalRequests / total * 100) : 0;
  const bar = document.getElementById(`reqbar-${b.id}`);
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
      const pct = ((count / total) * 100).toFixed(1);
      const div = document.createElement('div');
      div.className = 'dist-item';
      div.innerHTML = `
        <div class="dist-label">
          <span>${id}</span>
          <span id="dist-val-${id}">${pct}%</span>
        </div>
        <div class="dist-bar">
          <div class="dist-fill dist-fill-${i}" id="dist-bar-${id}" style="width:${pct}%"></div>
        </div>
      `;
      container.appendChild(div);
    });
  } else {
    entries.forEach(([id, count]) => {
      const pct = ((count / total) * 100).toFixed(1);
      setText(`dist-val-${id}`, `${pct}%`);
      const bar = document.getElementById(`dist-bar-${id}`);
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
      const item = document.createElement('div');
      item.className = 'cb-item';
      item.id = `cbitem-${b.id}`;
      item.innerHTML = `
        <div class="cb-item-name">${b.id}</div>
        <span class="cb-state CLOSED" id="cbitem-state-${b.id}">🟢 CLOSED</span>
        <span class="cb-item-fails" id="cbitem-fails-${b.id}">0 hata</span>
        <button class="reset-btn" onclick="resetCB('${b.id}')">Reset</button>
      `;
      container.appendChild(item);
    });
  } else {
    backends.forEach(b => {
      const cb = b.circuitBreaker || { state: 'CLOSED', failCount: 0 };
      const icon = { CLOSED: '🟢', OPEN: '🔴', HALF_OPEN: '🟡' }[cb.state] || '🟢';
      const el = document.getElementById(`cbitem-state-${b.id}`);
      if (el) {
        el.textContent = `${icon} ${cb.state}`;
        el.className = `cb-state ${cb.state}`;
      }
      setText(`cbitem-fails-${b.id}`, `${cb.failCount} hata`);
    });
  }
}

async function resetCB(backendId) {
  try {
    await fetch(`/api/circuitbreaker/reset/${backendId}`, { method: 'POST' });
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
function setHTML(id, v) { const el = document.getElementById(id); if (el) el.innerHTML = v; }
function setConnStatus(connected) {
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  if (dot) dot.className = `conn-dot${connected ? '' : ' off'}`;
  if (txt) txt.textContent = connected ? 'Bağlı' : 'Bağlantı Yok';
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
