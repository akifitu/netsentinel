/**
 * NetSentinel — Main Gateway Server
 * Load Balancer + Rate Limiter + Circuit Breaker + Dashboard
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const httpProxy = require('http-proxy');
const cors = require('cors');
const path = require('path');

const loadBalancer = require('./loadBalancer');
const rateLimiter = require('./rateLimiter');
const { CircuitBreaker, STATES } = require('./circuitBreaker');
const HealthChecker = require('./healthChecker');
const analytics = require('./analytics');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const proxy = httpProxy.createProxyServer({ timeout: 5000 });

const DASHBOARD_HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const GATEWAY_HOST = process.env.GATEWAY_HOST || '127.0.0.1';
const GATEWAY_PORT = 3001;
const DASHBOARD_PORT = 3002;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function originPort(parsedUrl) {
  if (parsedUrl.port) return parsedUrl.port;
  return parsedUrl.protocol === 'https:' ? '443' : '80';
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return LOOPBACK_HOSTS.has(parsed.hostname) && originPort(parsed) === String(DASHBOARD_PORT);
  } catch (err) {
    return false;
  }
}

// ─── Backend Kayıt ──────────────────────────────────────────────────────────
const BACKEND_CONFIG = [
  { id: 'backend-1', url: 'http://localhost:4001', weight: 3 },
  { id: 'backend-2', url: 'http://localhost:4002', weight: 2 },
  { id: 'backend-3', url: 'http://localhost:4003', weight: 1 },
  { id: 'backend-4', url: 'http://localhost:4004', weight: 2 }
];

BACKEND_CONFIG.forEach(b => loadBalancer.addBackend(b));

// Sağlık kontrolcüsü başlat
const healthChecker = new HealthChecker(loadBalancer, { interval: 5000 });
healthChecker.start();

// ─── Algoritma Ayarı ────────────────────────────────────────────────────────
let currentAlgorithm = 'round-robin';

// ─── Middleware (Dashboard) ──────────────────────────────────────────────────
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  }
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dashboard')));

// ─── Dashboard REST API ──────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    gateway: 'online',
    version: '1.0.0',
    algorithm: currentAlgorithm,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/backends', (req, res) => {
  const lbStats = loadBalancer.getStats();
  const healthStats = healthChecker.getAllStatus();
  const cbStates = CircuitBreaker.getAllStates();

  const combined = lbStats.map(b => ({
    ...b,
    ...healthStats.find(h => h.id === b.id),
    circuitBreaker: cbStates[b.id] || { state: 'CLOSED', failCount: 0 }
  }));

  res.json(combined);
});

app.get('/api/analytics', (req, res) => {
  res.json(analytics.getStats());
});

app.get('/api/ratelimiter', (req, res) => {
  res.json(rateLimiter.getStats());
});

app.get('/api/circuitbreaker', (req, res) => {
  res.json(CircuitBreaker.getAllStates());
});

app.put('/api/algorithm', (req, res) => {
  const { algorithm } = req.body;
  const valid = ['round-robin', 'least-connections', 'weighted'];
  if (!valid.includes(algorithm)) {
    return res.status(400).json({ error: 'Geçersiz algoritma' });
  }
  currentAlgorithm = algorithm;
  broadcast({ type: 'algorithm_changed', algorithm });
  res.json({ success: true, algorithm });
});

app.put('/api/ratelimiter/config', (req, res) => {
  rateLimiter.updateConfig(req.body);
  res.json({ success: true, ...req.body });
});

app.post('/api/circuitbreaker/reset/:backendId', (req, res) => {
  CircuitBreaker.reset(req.params.backendId);
  res.json({ success: true, backendId: req.params.backendId });
});

// ─── Test Endpoint — Yük Üretici ────────────────────────────────────────────
app.post('/api/load-test', async (req, res) => {
  const { count = 10, concurrency = 5 } = req.body;
  const results = { success: 0, failed: 0, rateLimited: 0 };
  const batches = Math.ceil(count / concurrency);

  for (let i = 0; i < batches; i++) {
    const batch = Array.from({ length: Math.min(concurrency, count - i * concurrency) },
      () => fetch(`http://localhost:${GATEWAY_PORT}/api/proxy/test`)
        .then(r => {
          if (r.status === 429) results.rateLimited++;
          else if (r.ok) results.success++;
          else results.failed++;
        })
        .catch(() => results.failed++)
    );
    await Promise.all(batch);
    await new Promise(r => setTimeout(r, 100));
  }

  res.json({ ...results, total: count });
});

// ─── Proxy Gateway (Port 3001) ───────────────────────────────────────────────
const gatewayApp = express();

gatewayApp.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  // 1. Rate Limiter
  const rlResult = rateLimiter.check(ip);
  res.setHeader('X-RateLimit-Limit', rlResult.limit);
  res.setHeader('X-RateLimit-Remaining', rlResult.remaining);

  if (!rlResult.allowed) {
    analytics.record({ statusCode: 429, latency: 0, backendId: null, ip });
    return res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: rlResult.retryAfter,
      message: 'Rate limit aşıldı. Lütfen bekleyin.'
    });
  }

  // 2. Load Balancer — Backend Seç
  const backend = loadBalancer.select(currentAlgorithm);
  if (!backend) {
    analytics.record({ statusCode: 503, latency: 0, backendId: null, ip });
    return res.status(503).json({ error: 'Service Unavailable', message: 'Sağlıklı backend yok' });
  }

  // 3. Circuit Breaker Kontrolü
  if (!CircuitBreaker.canRequest(backend.id)) {
    analytics.record({ statusCode: 503, latency: 0, backendId: backend.id, ip });
    return res.status(503).json({
      error: 'Circuit Open',
      backend: backend.id,
      message: `${backend.id} için devre açık. Kısa süre sonra tekrar deneyin.`
    });
  }

  const startTime = Date.now();
  loadBalancer.onRequestStart(backend.id);

  res.setHeader('X-Selected-Backend', backend.id);
  res.setHeader('X-Algorithm', currentAlgorithm);

  // 4. Proxy
  proxy.web(req, res, { target: backend.url }, (err) => {
    const latency = Date.now() - startTime;
    loadBalancer.onRequestEnd(backend.id, latency, true);
    CircuitBreaker.onFailure(backend.id);
    analytics.record({ statusCode: 0, latency, backendId: backend.id, ip });

    res.status(502).json({
      error: 'Bad Gateway',
      backend: backend.id,
      message: err.message
    });
  });

  proxy.once('proxyRes', (proxyRes) => {
    const latency = Date.now() - startTime;
    const isError = proxyRes.statusCode >= 500;

    loadBalancer.onRequestEnd(backend.id, latency, isError);

    if (isError) {
      CircuitBreaker.onFailure(backend.id);
    } else {
      CircuitBreaker.onSuccess(backend.id);
    }

    analytics.record({
      statusCode: proxyRes.statusCode,
      latency,
      backendId: backend.id,
      ip
    });
  });
});

const gatewayServer = http.createServer(gatewayApp);
gatewayServer.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
  console.log(`[Gateway] Proxy dinliyor: http://${GATEWAY_HOST}:${GATEWAY_PORT}`);
});

// ─── WebSocket Broadcast ────────────────────────────────────────────────────
const clients = new Set();

wss.on('connection', (ws, req) => {
  if (!isAllowedOrigin(req.headers.origin)) {
    ws.close(1008, 'Origin not allowed');
    return;
  }
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'connected', algorithm: currentAlgorithm }));

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// ─── Canlı Veri Döngüsü ─────────────────────────────────────────────────────
setInterval(() => {
  broadcast({
    type: 'update',
    analytics: analytics.getStats(),
    backends: (() => {
      const lbStats = loadBalancer.getStats();
      const healthStats = healthChecker.getAllStatus();
      const cbStates = CircuitBreaker.getAllStates();
      return lbStats.map(b => ({
        ...b,
        uptime: healthStats.find(h => h.id === b.id)?.uptime ?? 100,
        circuitBreaker: cbStates[b.id] || { state: 'CLOSED', failCount: 0 }
      }));
    })(),
    rateLimiter: rateLimiter.getStats(),
    algorithm: currentAlgorithm,
    timestamp: new Date().toISOString()
  });
}, 1000);

// ─── Dashboard Sunucusu ─────────────────────────────────────────────────────
server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║        NetSentinel API Gateway                ║
╠══════════════════════════════════════════════╣
║  🌐 Dashboard : http://${DASHBOARD_HOST}:${DASHBOARD_PORT}          ║
║  🔀 Gateway   : http://${GATEWAY_HOST}:${GATEWAY_PORT}           ║
║  📡 WebSocket : ws://${DASHBOARD_HOST}:${DASHBOARD_PORT}            ║
╠══════════════════════════════════════════════╣
║  Backends: :4001 :4002 :4003 :4004           ║
║  (Önce: node ../backends/mockServer.js)       ║
╚══════════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
