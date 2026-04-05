/**
 * NetSentinel — Token Bucket Rate Limiter
 *
 * Token Bucket Algoritması:
 * - Her IP için ayrı bir kova (bucket) tutulur
 * - Kova kapasitesi: maxTokens token
 * - Refill rate: saniyede refillRate token eklenir
 * - Her istek 1 token tüketir
 * - Kova boşsa istek reddedilir (429 Too Many Requests)
 */

class TokenBucketRateLimiter {
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 20;       // Kova kapasitesi
    this.refillRate = options.refillRate || 10;     // Token/saniye
    this.buckets = new Map();                        // IP → Bucket

    // Arka planda token dolumu
    setInterval(() => this._refillAll(), 1000);

    // Eski bucket'ları temizle (bellek yönetimi)
    setInterval(() => this._cleanup(), 60000);
  }

  /**
   * İstek izinli mi?
   */
  check(ip, routeMultiplier = 1) {
    const bucket = this._getBucket(ip);
    const cost = routeMultiplier;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      bucket.totalAccepted++;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        limit: this.maxTokens,
        resetIn: Math.ceil((cost / this.refillRate) * 1000)
      };
    }

    bucket.totalRejected++;
    return {
      allowed: false,
      remaining: 0,
      limit: this.maxTokens,
      resetIn: Math.ceil(((cost - bucket.tokens) / this.refillRate) * 1000),
      retryAfter: Math.ceil((cost - bucket.tokens) / this.refillRate)
    };
  }

  _getBucket(ip) {
    if (!this.buckets.has(ip)) {
      this.buckets.set(ip, {
        tokens: this.maxTokens,
        lastRefill: Date.now(),
        totalAccepted: 0,
        totalRejected: 0
      });
    }
    return this.buckets.get(ip);
  }

  _refillAll() {
    const now = Date.now();
    this.buckets.forEach((bucket, ip) => {
      const elapsed = (now - bucket.lastRefill) / 1000;
      const newTokens = elapsed * this.refillRate;
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + newTokens);
      bucket.lastRefill = now;
    });
  }

  _cleanup() {
    const cutoff = Date.now() - 300000; // 5 dakika inaktif
    this.buckets.forEach((bucket, ip) => {
      if (bucket.lastRefill < cutoff) this.buckets.delete(ip);
    });
  }

  getStats() {
    let totalAccepted = 0, totalRejected = 0;
    this.buckets.forEach(b => {
      totalAccepted += b.totalAccepted;
      totalRejected += b.totalRejected;
    });
    return {
      activeBuckets: this.buckets.size,
      totalAccepted,
      totalRejected,
      rejectRate: (totalAccepted + totalRejected) > 0
        ? parseFloat(((totalRejected / (totalAccepted + totalRejected)) * 100).toFixed(2))
        : 0
    };
  }

  updateConfig(config) {
    if (config.maxTokens) this.maxTokens = config.maxTokens;
    if (config.refillRate) this.refillRate = config.refillRate;
  }
}

module.exports = new TokenBucketRateLimiter({ maxTokens: 20, refillRate: 10 });
