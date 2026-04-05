/**
 * NetSentinel — Mock Backend Servers
 * 4 farklı davranışlı backend servisi simüle eder:
 *  - Backend 1 (4001): Güvenilir, hızlı
 *  - Backend 2 (4002): Orta hız, ara sıra yavaş
 *  - Backend 3 (4003): Hatalı (yüksek hata oranı - CB tetikler)
 *  - Backend 4 (4004): Ağır iş yükü simülasyonu
 */

const http = require('http');

const BACKENDS = [
  {
    port: 4001,
    name: 'backend-1',
    profile: 'reliable',     // Güvenilir
    latencyBase: 20,
    latencyJitter: 30,
    errorRate: 0.02,          // %2 hata
    color: '\x1b[32m'         // Yeşil
  },
  {
    port: 4002,
    name: 'backend-2',
    profile: 'moderate',     // Orta
    latencyBase: 50,
    latencyJitter: 100,
    errorRate: 0.05,          // %5 hata
    color: '\x1b[36m'         // Cyan
  },
  {
    port: 4003,
    name: 'backend-3',
    profile: 'flaky',        // Hatalı — Circuit Breaker tetikler
    latencyBase: 30,
    latencyJitter: 50,
    errorRate: 0.6,           // %60 hata 🔴
    color: '\x1b[31m'         // Kırmızı
  },
  {
    port: 4004,
    name: 'backend-4',
    profile: 'heavy',        // Yavaş ama güvenilir
    latencyBase: 150,
    latencyJitter: 200,
    errorRate: 0.01,          // %1 hata
    color: '\x1b[33m'         // Sarı
  }
];

function createBackend(config) {
  let reqCount = 0;

  const server = http.createServer((req, res) => {
    reqCount++;

    if (req.url === '/health') {
      // Hatalı backend sağlık kontrolüne de bazen fail verir
      const healthOk = config.errorRate < 0.5 || Math.random() > 0.3;
      res.writeHead(healthOk ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: healthOk ? 'ok' : 'degraded',
        backend: config.name,
        profile: config.profile,
        requests: reqCount
      }));
      return;
    }

    // Simüle edilmiş gecikme
    const latency = config.latencyBase + Math.random() * config.latencyJitter;

    setTimeout(() => {
      // Simüle edilmiş hata
      const isError = Math.random() < config.errorRate;

      if (isError) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Internal Server Error',
          backend: config.name,
          message: 'Simulated backend failure'
        }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Backend-Id': config.name,
        'X-Latency-Ms': latency.toFixed(0)
      });

      res.end(JSON.stringify({
        success: true,
        backend: config.name,
        profile: config.profile,
        requestId: `${config.name}-${reqCount}`,
        latency: parseFloat(latency.toFixed(2)),
        timestamp: new Date().toISOString(),
        path: req.url
      }));
    }, latency);
  });

  server.listen(config.port, () => {
    console.log(`${config.color}[${config.name}] :${config.port} | Profile: ${config.profile} | Error Rate: ${(config.errorRate * 100).toFixed(0)}%\x1b[0m`);
  });

  return server;
}

console.log('\n🚀 NetSentinel Mock Backend Servers\n');
BACKENDS.forEach(config => createBackend(config));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => {
  console.log('\n[Backends] Kapatılıyor...');
  process.exit(0);
});
