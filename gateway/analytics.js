/**
 * NetSentinel — Traffic Analytics
 * RPS, latency percentile, error rate, backend dağılımı
 */

class Analytics {
  constructor() {
    this.requests = [];         // Tüm istek kayıtları (sliding window)
    this.windowSize = 60000;    // 60 saniyelik pencere
    this.rpsHistory = [];       // RPS geçmişi
    this.latencyHistory = [];   // Latency geçmişi
    this.maxHistory = 60;       // 60 veri noktası

    // Her saniye hesaplama yap
    setInterval(() => this._compute(), 1000);
  }

  record(entry) {
    this.requests.push({
      ...entry,
      time: Date.now()
    });
    // Eski kayıtları temizle
    this._prune();
  }

  _prune() {
    const cutoff = Date.now() - this.windowSize;
    while (this.requests.length > 0 && this.requests[0].time < cutoff) {
      this.requests.shift();
    }
  }

  _compute() {
    this._prune();
    const window = this.requests.filter(r => r.time > Date.now() - 1000);

    // RPS (son 1 saniye)
    this.rpsHistory.push(window.length);
    if (this.rpsHistory.length > this.maxHistory) this.rpsHistory.shift();

    // Median latency (son 1 saniye)
    const latencies = window.map(r => r.latency).sort((a, b) => a - b);
    const median = latencies.length > 0
      ? latencies[Math.floor(latencies.length / 2)]
      : 0;
    this.latencyHistory.push(median);
    if (this.latencyHistory.length > this.maxHistory) this.latencyHistory.shift();
  }

  /**
   * Anlık istatistikler
   */
  getStats() {
    this._prune();
    const now = Date.now();
    const last60s = this.requests;
    const last1s = this.requests.filter(r => r.time > now - 1000);

    // Latency percentil hesapla
    const latencies = last60s.map(r => r.latency).sort((a, b) => a - b);
    const p50 = this._percentile(latencies, 50);
    const p95 = this._percentile(latencies, 95);
    const p99 = this._percentile(latencies, 99);

    // Hata sayısı
    const errors = last60s.filter(r => r.statusCode >= 500 || r.statusCode === 0).length;
    const rateLimited = last60s.filter(r => r.statusCode === 429).length;

    // Backend dağılımı
    const backendDist = {};
    last60s.forEach(r => {
      if (r.backendId) {
        backendDist[r.backendId] = (backendDist[r.backendId] || 0) + 1;
      }
    });

    return {
      rps: last1s.length,
      totalLast60s: last60s.length,
      errorRate: last60s.length > 0
        ? parseFloat(((errors / last60s.length) * 100).toFixed(2))
        : 0,
      rateLimitedCount: rateLimited,
      latency: { p50, p95, p99,
        avg: latencies.length > 0
          ? parseFloat((latencies.reduce((s, v) => s + v, 0) / latencies.length).toFixed(2))
          : 0
      },
      backendDistribution: backendDist,
      rpsHistory: [...this.rpsHistory],
      latencyHistory: [...this.latencyHistory]
    };
  }

  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] || 0;
  }
}

module.exports = new Analytics();
