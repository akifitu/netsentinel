/**
 * NetSentinel — Health Checker
 * Backend servislerini aktif olarak izler, sağlık durumunu günceller
 */

const http = require('http');

class HealthChecker {
  constructor(loadBalancer, options = {}) {
    this.lb = loadBalancer;
    this.interval = options.interval || 5000;  // 5 saniyede bir kontrol
    this.timeout  = options.timeout  || 3000;  // 3 saniye timeout
    this.path     = options.path     || '/health';
    this.history  = new Map(); // Backend → son N sonuç
    this.maxHistory = 20;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this._checkAll(), this.interval);
    this._checkAll(); // Hemen ilk kontrol
    console.log(`[HealthChecker] Başlatıldı — ${this.interval / 1000}s aralık`);
  }

  stop() {
    clearInterval(this.timer);
  }

  async _checkAll() {
    const checks = this.lb.backends.map(b => this._checkOne(b));
    await Promise.allSettled(checks);
  }

  _checkOne(backend) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const url = new URL(this.path, backend.url);

      const req = http.get({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: this.timeout
      }, (res) => {
        const latency = Date.now() - startTime;
        const healthy = res.statusCode >= 200 && res.statusCode < 500;

        this._updateHistory(backend.id, { healthy, latency, statusCode: res.statusCode, time: new Date().toISOString() });
        this.lb.setHealthy(backend.id, healthy);

        resolve({ backendId: backend.id, healthy, latency });
      });

      req.on('timeout', () => {
        req.destroy();
        this._updateHistory(backend.id, { healthy: false, latency: this.timeout, statusCode: 0, time: new Date().toISOString() });
        this.lb.setHealthy(backend.id, false);
        resolve({ backendId: backend.id, healthy: false });
      });

      req.on('error', () => {
        this._updateHistory(backend.id, { healthy: false, latency: Date.now() - startTime, statusCode: 0, time: new Date().toISOString() });
        this.lb.setHealthy(backend.id, false);
        resolve({ backendId: backend.id, healthy: false });
      });
    });
  }

  _updateHistory(backendId, entry) {
    if (!this.history.has(backendId)) this.history.set(backendId, []);
    const hist = this.history.get(backendId);
    hist.push(entry);
    if (hist.length > this.maxHistory) hist.shift();
  }

  getHistory(backendId) {
    return this.history.get(backendId) || [];
  }

  getUptimePercent(backendId) {
    const hist = this.getHistory(backendId);
    if (hist.length === 0) return 100;
    const healthy = hist.filter(h => h.healthy).length;
    return parseFloat(((healthy / hist.length) * 100).toFixed(1));
  }

  getAllStatus() {
    return this.lb.backends.map(b => ({
      id: b.id,
      url: b.url,
      healthy: b.healthy,
      uptime: this.getUptimePercent(b.id),
      recentChecks: this.getHistory(b.id).slice(-5)
    }));
  }
}

module.exports = HealthChecker;
