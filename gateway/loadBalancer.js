/**
 * NetSentinel — Load Balancer
 * Üç algoritma: Round Robin, Least Connections, Weighted Round Robin
 */

class LoadBalancer {
  constructor() {
    this.backends = [];
    this.rrIndex = 0; // Round Robin sayacı
  }

  addBackend(backend) {
    this.backends.push({
      id: backend.id,
      url: backend.url,
      weight: backend.weight || 1,
      activeConnections: 0,
      healthy: true,
      totalRequests: 0,
      totalErrors: 0,
      totalLatency: 0,
      // Weighted RR için sanal sayaç
      currentWeight: 0
    });
  }

  getHealthyBackends() {
    return this.backends.filter(b => b.healthy);
  }

  /**
   * ALGORİTMA 1: Round Robin
   * Her backend sırayla seçilir
   */
  roundRobin() {
    const healthy = this.getHealthyBackends();
    if (healthy.length === 0) return null;
    const chosen = healthy[this.rrIndex % healthy.length];
    this.rrIndex = (this.rrIndex + 1) % healthy.length;
    return chosen;
  }

  /**
   * ALGORİTMA 2: Least Connections
   * En az aktif bağlantısı olan backend seçilir
   */
  leastConnections() {
    const healthy = this.getHealthyBackends();
    if (healthy.length === 0) return null;
    return healthy.reduce((min, b) =>
      b.activeConnections < min.activeConnections ? b : min
    );
  }

  /**
   * ALGORİTMA 3: Weighted Round Robin
   * Her backend ağırlığına oranla daha sık/az seçilir
   * Smooth Weighted Round Robin (Nginx algoritması)
   */
  weightedRoundRobin() {
    const healthy = this.getHealthyBackends();
    if (healthy.length === 0) return null;

    const totalWeight = healthy.reduce((s, b) => s + b.weight, 0);

    // Her backend'e current_weight += weight ekle
    healthy.forEach(b => { b.currentWeight += b.weight; });

    // En yüksek currentWeight'e sahip backend'i seç
    const chosen = healthy.reduce((max, b) =>
      b.currentWeight > max.currentWeight ? b : max
    );

    // Seçilen backend'in currentWeight'ini totalWeight kadar düşür
    chosen.currentWeight -= totalWeight;
    return chosen;
  }

  /**
   * Seçim yap (algorithma parametresiyle)
   */
  select(algorithm = 'round-robin') {
    switch (algorithm) {
      case 'least-connections': return this.leastConnections();
      case 'weighted':          return this.weightedRoundRobin();
      default:                  return this.roundRobin();
    }
  }

  onRequestStart(backendId) {
    const b = this.backends.find(b => b.id === backendId);
    if (b) { b.activeConnections++; b.totalRequests++; }
  }

  onRequestEnd(backendId, latencyMs, isError = false) {
    const b = this.backends.find(b => b.id === backendId);
    if (b) {
      b.activeConnections = Math.max(0, b.activeConnections - 1);
      b.totalLatency += latencyMs;
      if (isError) b.totalErrors++;
    }
  }

  setHealthy(backendId, healthy) {
    const b = this.backends.find(b => b.id === backendId);
    if (b) {
      b.healthy = healthy;
      if (!healthy) b.activeConnections = 0;
    }
  }

  getStats() {
    return this.backends.map(b => ({
      id: b.id,
      url: b.url,
      weight: b.weight,
      healthy: b.healthy,
      activeConnections: b.activeConnections,
      totalRequests: b.totalRequests,
      totalErrors: b.totalErrors,
      errorRate: b.totalRequests > 0
        ? parseFloat(((b.totalErrors / b.totalRequests) * 100).toFixed(2))
        : 0,
      avgLatency: b.totalRequests > 0
        ? parseFloat((b.totalLatency / b.totalRequests).toFixed(2))
        : 0
    }));
  }
}

module.exports = new LoadBalancer();
