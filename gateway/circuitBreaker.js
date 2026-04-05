/**
 * NetSentinel — Circuit Breaker
 *
 * State Machine:
 *
 *   CLOSED ──(failCount >= threshold)──▶ OPEN
 *     ▲                                    │
 *     │                              (timeout expires)
 *     │                                    ▼
 *     └──(success)────────────── HALF-OPEN
 *
 * CLOSED    : Normal çalışma. İstekler geçiyor.
 * OPEN      : Devre açık. İstekler direkt reddedilir.
 * HALF-OPEN : Test modu. 1 deneme isteği gönderilir.
 *             Başarılıysa → CLOSED, başarısızsa → OPEN
 */

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreaker {
  constructor(options = {}) {
    this.threshold     = options.threshold     || 5;     // Kaç hatadan sonra OPEN
    this.timeout       = options.timeout       || 10000; // OPEN → HALF_OPEN süresi (ms)
    this.successNeeded = options.successNeeded || 1;     // HALF_OPEN'da kaç başarı → CLOSED

    // Backend başına state
    this.breakers = new Map();
  }

  _getBreaker(backendId) {
    if (!this.breakers.has(backendId)) {
      this.breakers.set(backendId, {
        state: STATES.CLOSED,
        failCount: 0,
        successCount: 0,
        lastFailTime: null,
        openedAt: null,
        totalTripped: 0
      });
    }
    return this.breakers.get(backendId);
  }

  /**
   * İstek gönderilebilir mi?
   */
  canRequest(backendId) {
    const cb = this._getBreaker(backendId);

    if (cb.state === STATES.CLOSED) return true;

    if (cb.state === STATES.OPEN) {
      const elapsed = Date.now() - cb.openedAt;
      if (elapsed >= this.timeout) {
        cb.state = STATES.HALF_OPEN;
        cb.successCount = 0;
        console.log(`[CB] ${backendId}: OPEN → HALF_OPEN`);
        return true; // Test isteğine izin ver
      }
      return false; // Hâlâ açık
    }

    if (cb.state === STATES.HALF_OPEN) return true;

    return false;
  }

  /**
   * Başarılı istek kaydı
   */
  onSuccess(backendId) {
    const cb = this._getBreaker(backendId);
    cb.failCount = 0;

    if (cb.state === STATES.HALF_OPEN) {
      cb.successCount++;
      if (cb.successCount >= this.successNeeded) {
        cb.state = STATES.CLOSED;
        console.log(`[CB] ${backendId}: HALF_OPEN → CLOSED ✅`);
      }
    }
  }

  /**
   * Başarısız istek kaydı
   */
  onFailure(backendId) {
    const cb = this._getBreaker(backendId);
    cb.failCount++;
    cb.lastFailTime = Date.now();

    if (cb.state === STATES.HALF_OPEN) {
      cb.state = STATES.OPEN;
      cb.openedAt = Date.now();
      console.log(`[CB] ${backendId}: HALF_OPEN → OPEN 🔴`);
      return;
    }

    if (cb.state === STATES.CLOSED && cb.failCount >= this.threshold) {
      cb.state = STATES.OPEN;
      cb.openedAt = Date.now();
      cb.totalTripped++;
      console.log(`[CB] ${backendId}: CLOSED → OPEN 🔴 (${cb.failCount} hata)`);
    }
  }

  getState(backendId) {
    return this._getBreaker(backendId).state;
  }

  getAllStates() {
    const result = {};
    this.breakers.forEach((cb, id) => {
      result[id] = {
        state: cb.state,
        failCount: cb.failCount,
        totalTripped: cb.totalTripped,
        openedAt: cb.openedAt,
        remainingOpenMs: cb.state === STATES.OPEN
          ? Math.max(0, this.timeout - (Date.now() - cb.openedAt))
          : 0
      };
    });
    return result;
  }

  reset(backendId) {
    const cb = this._getBreaker(backendId);
    cb.state = STATES.CLOSED;
    cb.failCount = 0;
    cb.successCount = 0;
  }
}

module.exports = { CircuitBreaker: new CircuitBreaker({ threshold: 5, timeout: 10000 }), STATES };
