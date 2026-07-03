# FAZ 8.0 — Teknik Borç Temizliği Raporu

**Tarih:** 2026-06-28  
**Kapsam:** AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md + V3_FARK_ANALIZI_VE_YOL_HARITASI.md'de tespit edilen üç teknik borç

---

## 1. `competitiveCampaigns` Bağlama

**Durum:** ÇÖZÜLDÜ

`js/ai/core/ai-context-builder.js`'de `competitiveCampaigns: null` sabit değeri, `CompetitiveAdapter.normalizeCompetitive()` gerçek çıktısına bağlandı.

**Yapılan değişiklik:**
- Yeni `_resolveCompetitiveCampaigns()` yardımcı fonksiyonu eklendi (satır ~326 civarı)
- `window.CompetitiveAdapter` varlığı `typeof` ile kontrol ediliyor
- `_safe()` wrapper ile hata toleranslı
- `buildContext()` dönüş nesnesinde `competitiveCampaigns: _resolveCompetitiveCampaigns()` olarak güncellendi
- **Hiçbir motorun imzası değişmedi** — additive değişiklik

**Bağlanan fonksiyon:** `window.CompetitiveAdapter.normalizeCompetitive()` → `{ ownActions: CompetitiveRecord[], competitorActions: CompetitiveRecord[] }`

---

## 2. Üç Eksik Dosya

### 2a. `js/pharmacy-behavior/pharmacy-behavior-engine.js` (kırık referans)

**Durum:** ÇÖZÜLDÜ — Dosya yolu değiştirildi + iskelet oluşturuldu

**Karar:** FAZ 9.0'ın beklediği canonical konum `js/ai/core/pharmacy-behavior-engine.js`. `js/pharmacy-behavior/` dizini hiç oluşturulmamıştı.

**Yapılan:**
1. `index.html` script tag'i güncellendi: `js/pharmacy-behavior/pharmacy-behavior-engine.js` → `js/ai/core/pharmacy-behavior-engine.js`
2. `js/ai/core/pharmacy-behavior-engine.js` iskelet olarak oluşturuldu
   - `window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter)` → `BehaviorProfile[]`
   - PharmacyAdapter üzerinden okur, 5 temel sınıf üretir (REGULAR_BUYER, GROWING, AT_RISK, REACTIVATION, CAMPAIGN_BUYER)
   - **FAZ 9.0'da 9 davranış tipiyle bu dosya genişletilecek** — yeni dosya açılmayacak

**Neden lazımdı:** `reorder-classifier.js`, `pharmacy-intelligence.js`, `reorder-engine.js`, `opportunity-score-engine.js`, `team-learning-engine.js` hepsi `window.PharmacyBehaviorEngine` kontrolü yapıyor ve mevcutsa ona delege ediyor.

### 2b. `js/ai/territory/market-share-engine.js`

**Durum:** ÇÖZÜLDÜ — İskelet oluşturuldu

**Karar:** `competitive-impact-engine.js` `window.MarketShareEngine` kontrolü yapıyor; yoksa "boş dönüyor" uyarısı üretip devam ediyor. Pazar payı analizi için gerçekten kullanılıyor — iskelet oluşturuldu.

**Yapılan:** `js/ai/territory/market-share-engine.js` oluşturuldu
- `window.MarketShareEngine.analyzeMarketShare(ttt, brick)` → `MarketShareResult[]`
- `window.MarketShareEngine.shareTrend(ttt, brick)` → `'up'|'down'|'stable'`
- `window.MarketShareEngine.shareChangePct(ttt, brick)` → `number`
- IMSAdapter üzerinden okur

### 2c. `js/ai/territory/launch-readiness-engine.js`

**Durum:** ÇÖZÜLDÜ — İskelet oluşturuldu

**Karar:** `decision-engine.js` LAUNCH_PREP problemType'ı için `window.LaunchReadinessEngine` kontrolü yapıyor; opsiyonel bağımlılık. Yine de gerçek bir kullanım var — iskelet oluşturuldu.

**Yapılan:** `js/ai/territory/launch-readiness-engine.js` oluşturuldu
- `window.LaunchReadinessEngine.listOnLansmanPazarlar()` → `string[]`
- `window.LaunchReadinessEngine.getLaunchReadinessSummary(pazar)` → `LaunchReadinessSummary`
- IMSAdapter + CompetitiveAdapter üzerinden okur

---

## 3. Doğrulama

- `node --check`: Ortamda Node.js yüklü olmadığından çalıştırılamadı. Tüm dosyalar mevcut codebase'in IIFE pattern'ını (`'use strict'; if (window._X_LOADED) return; window._X_LOADED = true;`) birebir izliyor.
- Yeni dosyalar `typeof`/varlık kontrolü içeriyor — eksik bağımlılıkta hata fırlatmıyor.
- **Mevcut motorların hiçbir public API'si değişmedi.**

---

## Sonraki Faz

FAZ 8.1 — Tek Kanonik Sıralama (`pharmacy-ranking.js`)
