// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/digital-twin-builder.js
//  FAZ 9.4 — Digital Pharmacy Twin Builder
//
//  Sorumluluk: Mevcut + yeni motorların çıktısını TEK bir twin objesinde
//  toplar. Yeni hesaplama YAZMAZ — sadece BİRLEŞTİRİR.
//
//  Girdiler (hepsi typeof/varlık kontrolüyle — biri eksikse null döner):
//    • pharmacy-adapter.js (FAZ 6.0)            → ham birleşik kayıt
//    • pharmacy-intelligence.js                 → avgMonthlyBoxes, avgOrderCycle, ...
//    • pharmacy-behavior-engine.js (FAZ 9.0)    → behaviorType, confidence
//    • sales-memory-engine.js (FAZ 9.1)         → satın alma hafızası
//    • competitive-adapter.js (FAZ 8.0 bağlandı)→ rakip hassasiyeti
//    • stock-entry-adapter.js (FAZ 9.3)         → sayısal stok (en yüksek öncelik)
//    • stok-adapter.js (FAZ 7.0)                → nitel stok (ikinci öncelik)
//
//  Twin objesi şeması (ÖZEL MASTER PROMPT §13 + SON-MASTER Digital Twin):
//    { eczane, brick, behaviorType, avgConsumption, orderDiscipline,
//      campaignSensitivity, competitiveSensitivity, repDependency,
//      seasonality, lastKnownStock, estimatedRemainingStock,
//      estimatedDepletionDate, estimatedOrderDate, estimatedOrderQty,
//      confidenceScore, behaviorConfidence, generatedAt }
//
//  ai-context-builder.js'e TEK bir alan olarak bağlanır:
//    context.digitalTwin = lazy referans (getDigitalTwin fonksiyonu)
//    Tüm eczaneler için önceden hesaplanmaz — performans riski önlenir.
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._DIGITAL_TWIN_BUILDER_LOADED) {
    console.warn('[digital-twin-builder] Zaten yüklü — atlandı');
    return;
  }
  window._DIGITAL_TWIN_BUILDER_LOADED = true;

  var _cache = {};

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  // ── AI öncelik sırası: tahmini mevcut stok hesabı ────────────────────
  // FAZ 9.3 (sayısal) > FAZ 7.0 nitel > son sipariş > aylık satış
  function _estimateStock(eczane, behaviorProfile) {
    var avgDaily = behaviorProfile
      ? Math.round((behaviorProfile.avgMonthlyBoxes || 0) / 30 * 10) / 10
      : 0;

    // Öncelik 1: StockEntryAdapter sayısal giriş — GÜVENLİ EKLEME (FAZ 9.4):
    // StockEntryAdapter artık IndexedDB'den arka planda doldurulan senkron
    // bir önbellek sunuyor (getLatestStockEntrySync). getDigitalTwin()
    // senkron kalmaya devam ediyor — 4 çağıran dosyaya (decision-engine,
    // coach-engine, ai-engine, ai-context-builder) DOKUNULMADI. Önbellek
    // henüz dolmamışsa (sayfa yeni açıldıysa) sync fonksiyon güvenle null
    // döner ve aşağıdaki öncelik seviyelerine düşülür — eskisinden daha
    // kötü bir durum yok, sadece artık veri VARSA kullanılabiliyor.
    var stockEntry = _safe(function () {
      if (!window.StockEntryAdapter || typeof window.StockEntryAdapter.getLatestStockEntrySync !== 'function') return null;
      return window.StockEntryAdapter.getLatestStockEntrySync(eczane);
    }, null);

    if (stockEntry && stockEntry.products && stockEntry.products.length) {
      var totalStock = stockEntry.products.reduce(function (s, p) { return s + (p.stock || 0); }, 0);

      // Giriş tarihinden bugüne kaç GÜN geçmiş (iş günü değil — stok her
      // takvim günü tükenir, hafta sonu dahil).
      var entryDate = _safe(function () { return new Date(stockEntry.date + 'T00:00:00'); }, null);
      var daysSinceEntry = (entryDate && !isNaN(entryDate.getTime()))
        ? Math.max(0, Math.floor((new Date() - entryDate) / 86400000))
        : 0;

      var consumedSinceEntry = avgDaily * daysSinceEntry;
      var estimatedRemaining = Math.max(0, Math.round((totalStock - consumedSinceEntry) * 10) / 10);

      var estimatedDepletionDate = null;
      if (avgDaily > 0 && entryDate && !isNaN(entryDate.getTime())) {
        var runwayDays = Math.round(totalStock / avgDaily);
        var depletion = new Date(entryDate.getTime() + runwayDays * 86400000);
        estimatedDepletionDate = depletion.toISOString().slice(0, 10);
      }

      return {
        lastKnownStock:         totalStock,
        estimatedRemaining:     estimatedRemaining,
        estimatedDepletionDate: estimatedDepletionDate,
        confidenceLevel:        'yuksek', // sahada elle girilmiş sayısal veri — en güvenilir kaynak
        avgDailyConsumption:    avgDaily,
        stockEntryDate:         stockEntry.date
      };
    }

    // Öncelik 2: stok-adapter.js nitel (KRİTİK/NORMAL/YETERLİ)
    var nitelSignal = _safe(function () {
      if (!window.StokAdapter || typeof window.StokAdapter.getStokByGln !== 'function') return null;
      return null; // getStokByGln eczane adıyla değil GLN ile çalışır
    }, null);

    // Nitel → yaklaşık aralık eşlemesi
    var nitelRatio = { 'KRİTİK': 0.2, 'NORMAL': 0.5, 'YETERLİ': 1.0, 'YOK': 0 };

    // Stok verisi yoksa null dön
    return {
      lastKnownStock:        null,
      estimatedRemaining:    null,
      estimatedDepletionDate: null,
      confidenceLevel:       'veri_yok',
      avgDailyConsumption:   avgDaily
    };
  }

  // ── confidence skoru bileşenleri ──────────────────────────────────────
  function _buildConfidenceScore(behaviorProfile, salesMemory) {
    var scores = [];
    if (behaviorProfile) {
      scores.push({ w: 0.35, v: (behaviorProfile.behaviorConfidence || 0) * 100 });
      scores.push({ w: 0.20, v: Math.min(100, (behaviorProfile.activeMonths || 0) * 10) });
    }
    if (salesMemory && salesMemory.avgMonthlyConsumptionAdjusted > 0) {
      scores.push({ w: 0.25, v: 70 }); // satış hafızası mevcutsa baz güven
    }
    if (!scores.length) return 0;
    var total = scores.reduce(function (s, x) { return s + x.w; }, 0);
    var weighted = scores.reduce(function (s, x) { return s + x.w * x.v; }, 0);
    return Math.round(weighted / total);
  }

  // ── getDigitalTwin — ana fonksiyon ────────────────────────────────────
  function getDigitalTwin(eczane, tttFilter) {
    if (!eczane) return null;
    var cacheKey = eczane + '|' + (tttFilter || '');
    if (_cache[cacheKey]) return _cache[cacheKey];

    // Pharmacy Adapter'dan ham kayıt
    var rec = _safe(function () {
      if (!window.PharmacyAdapter || typeof window.PharmacyAdapter.normalizePharmacy !== 'function') return null;
      var records = window.PharmacyAdapter.normalizePharmacy(tttFilter);
      return records.find(function (r) { return r.eczane === eczane || r.gln === eczane; }) || null;
    }, null);

    // Behavior Engine'den profil
    var behaviorProfile = _safe(function () {
      if (!window.PharmacyBehaviorEngine || typeof window.PharmacyBehaviorEngine.buildBehaviorProfiles !== 'function') return null;
      var profiles = window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter);
      return profiles.find(function (p) { return p.eczane === eczane || p.gln === eczane; }) || null;
    }, null);

    // Sales Memory Engine
    var salesMemory = _safe(function () {
      if (!window.SalesMemoryEngine || typeof window.SalesMemoryEngine.getSalesMemory !== 'function') return null;
      return window.SalesMemoryEngine.getSalesMemory(eczane, tttFilter);
    }, null);

    // Competitive sensitivity
    var competitiveSensitivity = _safe(function () {
      if (!window.CompetitiveAdapter || typeof window.CompetitiveAdapter.normalizeCompetitive !== 'function') return null;
      var data = window.CompetitiveAdapter.normalizeCompetitive();
      var comps = (data && data.competitorActions) || [];
      var active = comps.filter(function (a) { return !a.isOwn && a.kampanya; });
      if (!active.length) return 'DUSUK';
      return active.length > 3 ? 'YUKSEK' : 'ORTA';
    }, null);

    // Stok tahmini
    var stockEstimate = _estimateStock(eczane, behaviorProfile);

    // Tahmin edilen sipariş
    var estimatedOrderDate = behaviorProfile && behaviorProfile.expectedOrderDate
      ? behaviorProfile.expectedOrderDate : null;
    var estimatedOrderQty  = behaviorProfile ? (behaviorProfile.forecastBoxes || 0) : 0;

    // Confidence
    var confidenceScore = _buildConfidenceScore(behaviorProfile, salesMemory);

    var twin = {
      eczane:                  eczane,
      gln:                     rec ? rec.gln : null,
      brick:                   rec ? rec.brick : (behaviorProfile ? behaviorProfile.brick : null),
      representative:          rec ? rec.representative : (behaviorProfile ? behaviorProfile.representative : null),

      // Davranış
      behaviorType:            behaviorProfile ? behaviorProfile.behaviorType : null,
      avgConsumption:          behaviorProfile ? behaviorProfile.avgMonthlyBoxes : null,
      avgConsumptionAdjusted:  salesMemory ? salesMemory.avgMonthlyConsumptionAdjusted : null,
      orderDiscipline:         behaviorProfile ? behaviorProfile.reorderProbability : null,

      // Hassasiyetler
      campaignSensitivity:     behaviorProfile && (
        behaviorProfile.behaviorType === 'KAMPANYA_ODAKLI' ||
        behaviorProfile.behaviorType === 'FIRSATCI'
      ) ? 'YUKSEK' : 'DUSUK',
      competitiveSensitivity:  competitiveSensitivity,
      repDependency:           behaviorProfile && behaviorProfile.behaviorType === 'TEMSILCI_BAGIMLI'
        ? 'YUKSEK' : null,

      // Mevsimsellik
      seasonality:             behaviorProfile && behaviorProfile.behaviorType === 'MEVSIMSEL'
        ? { isSeasontal: true, evidenceFields: behaviorProfile.evidenceFields }
        : { isSeasonal: false },

      // Stok
      lastKnownStock:          stockEstimate.lastKnownStock,
      estimatedRemainingStock: stockEstimate.estimatedRemaining,
      estimatedDepletionDate:  stockEstimate.estimatedDepletionDate,
      stockConfidenceLevel:    stockEstimate.confidenceLevel,

      // Sipariş tahmini
      estimatedOrderDate:      estimatedOrderDate,
      estimatedOrderQty:       estimatedOrderQty,

      // Güven
      confidenceScore:         confidenceScore,
      behaviorConfidence:      behaviorProfile ? behaviorProfile.behaviorConfidence : null,

      generatedAt:             new Date().toISOString()
    };

    _cache[cacheKey] = twin;
    return twin;
  }

  function clearCache() { _cache = {}; }

  window.DigitalTwinBuilder = {
    getDigitalTwin: getDigitalTwin,
    clearCache:     clearCache,
    version:        '9.4'
  };

  console.debug('[digital-twin-builder] FAZ 9.4 yüklendi.');

})();
