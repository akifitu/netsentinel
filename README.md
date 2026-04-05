# NetSentinel — Distributed Load Balancer & API Gateway

<div align="center">

![NetSentinel](https://img.shields.io/badge/NetSentinel-v1.0.0-purple?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-v18+-green?style=for-the-badge&logo=node.js)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

**Distributed Load Balancing · Rate Limiting · Circuit Breaker · Health Checking**

[🚀 Hızlı Başlangıç](#-hızlı-başlangıç) · [📊 Özellikler](#-özellikler) · [🏗️ Mimari](#️-mimari) · [🔬 Algoritmalar](#-algoritmalar)

</div>

---

## 📋 Proje Hakkında

**NetSentinel**, gerçek dünya dağıtık sistemlerinde kullanılan temel örüntüleri — **Load Balancing**, **Rate Limiting**, **Circuit Breaker** ve **Health Checking** — tam implementasyonuyla sunan bir API Gateway platformudur.

Sistem mühendisliği mülakatlarının en sık sorgulanan konularını canlı, çalışan kod üzerinden gösterir.

---

## 🚀 Hızlı Başlangıç

```bash
git clone https://github.com/akifitu/netsentinel.git
cd netsentinel

# Bağımlılıkları kur
cd gateway && npm install && cd ..

# 1. Mock backend'leri başlat (4001-4004)
node backends/mockServer.js &

# 2. Gateway'i başlat
node gateway/server.js
```

| Servis | URL |
|--------|-----|
| 🌐 Dashboard | http://localhost:3002 |
| 🔀 Gateway   | http://localhost:3001 |
| 📡 WebSocket | ws://localhost:3002   |

---

## 📊 Özellikler

### 🔀 Load Balancing — 3 Algoritma
| Algoritma | Açıklama | Ne Zaman? |
|-----------|----------|-----------|
| **Round Robin** | Sırayla eşit dağıtım | Eşit kapasiteli backend'ler |
| **Least Connections** | En az aktif bağlantı | Değişken süreli istekler |
| **Weighted Round Robin** | Ağırlığa orantılı dağıtım | Farklı kapasiteli backend'ler |

### 🪣 Rate Limiting — Token Bucket
- Her IP için bağımsız token kovası
- Yapılandırılabilir: `maxTokens` (kova kapasitesi) + `refillRate` (token/sn)
- `429 Too Many Requests` + `Retry-After` header'ı
- Bellek verimliliği: inaktif bucket'lar otomatik temizlenir

### ⚡ Circuit Breaker — 3 Durumlu State Machine
```
CLOSED ──(5 hata)──▶ OPEN
  ▲                    │
  │              (10sn timeout)
  │                    ▼
  └──(success)── HALF-OPEN
```
- `CLOSED`: Normal trafik akışı
- `OPEN`: İstekler anında reddedilir (backend korunur)
- `HALF-OPEN`: Test isteği gönderilir, başarılıysa CLOSED'a döner

### 🏥 Health Checking
- 5 saniyede bir aktif HTTP `/health` kontrolü
- Uptime yüzdesi hesaplama
- Otomatik backend sağlık durumu güncelleme

### 📊 Real-Time Analytics
- Anlık RPS (Request Per Second)
- Latency percentilleri: P50 / P95 / P99
- Error rate (son 60 saniye sliding window)
- Backend başına trafik dağılımı

---

## 🏗️ Mimari

```
CLIENT REQUEST
      │
      ▼
┌─────────────────────────────────────────┐
│          NetSentinel Gateway            │
│  ┌───────────────┐                      │
│  │  Rate Limiter │ Token Bucket (IP)    │
│  └───────┬───────┘                      │
│          │ (izin verildi)               │
│  ┌───────▼───────┐                      │
│  │ Load Balancer │ RR / LC / Weighted   │
│  └───────┬───────┘                      │
│          │ (backend seçildi)            │
│  ┌───────▼───────┐                      │
│  │Circuit Breaker│ CLOSED/OPEN/HALF     │
│  └───────┬───────┘                      │
│          │ (devre kapalı)               │
│  ┌───────▼───────┐                      │
│  │  HTTP Proxy   │ http-proxy           │
│  └───────┬───────┘                      │
└──────────┼──────────────────────────────┘
           │
    ┌──────▼──────────────────────┐
    │   Backend Services           │
    │  :4001 reliable  (hata: 2%) │
    │  :4002 moderate  (hata: 5%) │
    │  :4003 flaky     (hata: 60%)│ ← CB tetikler
    │  :4004 heavy     (hata: 1%) │
    └─────────────────────────────┘
```

---

## 🔬 Algoritmalar

### Token Bucket Rate Limiter
```
Kova kapasitesi: maxTokens
Dolum hızı:      refillRate token/saniye
Her istek:       1 token tüketir

IF tokens >= 1:  İsteğe izin ver, tokens--
ELSE:            429 Too Many Requests
```

### Smooth Weighted Round Robin (Nginx Algoritması)
```python
# Her iterasyonda:
for each backend:
    backend.currentWeight += backend.weight

chosen = backend with max currentWeight
chosen.currentWeight -= totalWeight
```

### Circuit Breaker State Transitions
```
onFailure(): failCount++
  if failCount >= threshold: CLOSED → OPEN

onSuccess(): failCount = 0
  if state == HALF_OPEN and successCount >= needed:
    HALF_OPEN → CLOSED

canRequest():
  if OPEN and elapsed >= timeout: OPEN → HALF_OPEN
```

---

## 📡 API Referansı

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/api/status` | GET | Gateway durumu |
| `/api/backends` | GET | Tüm backend durumları |
| `/api/analytics` | GET | Trafik analitiği |
| `/api/ratelimiter` | GET | RL istatistikleri |
| `/api/circuitbreaker` | GET | CB durumları |
| `/api/algorithm` | PUT | Algoritma değiştir |
| `/api/ratelimiter/config` | PUT | RL yapılandır |
| `/api/circuitbreaker/reset/:id` | POST | CB sıfırla |
| `/api/load-test` | POST | Yük testi çalıştır |

---

## 📁 Proje Yapısı

```
netsentinel/
├── gateway/
│   ├── server.js          # Ana gateway + WebSocket
│   ├── loadBalancer.js    # 3 LB algoritması
│   ├── rateLimiter.js     # Token Bucket implementasyonu
│   ├── circuitBreaker.js  # State machine
│   ├── healthChecker.js   # Aktif health polling
│   ├── analytics.js       # Sliding window metrikleri
│   └── package.json
├── backends/
│   └── mockServer.js      # 4 profilli mock backend
├── dashboard/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       └── charts.js
└── README.md
```

---

## 🎤 Mülakat Anlatım Noktaları

1. **"Load balancing algoritmaları nelerdir?"** → 3 algoritmayı canlı göster, geçiş yap
2. **"Rate limiting nasıl çalışır?"** → Token Bucket matematiksel açıklaması
3. **"Circuit Breaker nedir?"** → State machine geçişlerini anlat, backend-3'ü kasıtlı boz
4. **"Health checking nasıl yapılır?"** → Aktif vs pasif monitoring farkı
5. **"Sliding window nedir?"** → 60 saniyelik pencere analitik hesabı

---

## 📄 Lisans

MIT License

---

<div align="center">

Sistem Mühendisliği Portfolyo Projesi #2

**NetSentinel** — *"Build for failure. Design for resilience."*

</div>
