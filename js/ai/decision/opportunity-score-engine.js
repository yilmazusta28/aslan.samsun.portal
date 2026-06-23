// ══════════════════════════════════════════════════════════════════════
//  js/ai/decision/opportunity-score-engine.js
//  FAZ 6.5 — 8-Bileşenli Opportunity Score Engine
//
//  Sorumluluk:
//    Master Prompt'un istediği tam 8-bileşenli fırsat skorunu üretir.
//    Mevcut `brick-ranking-engine.js`'in (Phase 3.3) çıktısını alıp,
//    3 yeni bileşen (Learning, Outcome, Sipariş Döngüsü) ekleyerek
//    genişletir. KOD YENİDEN YAZIMI DEĞİL — bağlama (wiring) işi.
//
//  ⚠️ TASARIM KARARI (roadmap §7 "Decision Engine seviyesinde yapılmalı"):
//    `brick-ranking-engine.js` DEĞİŞTİRİLMEDİ. Bu motor onun çıktısını
//    bir SONRAKI KATMANDA genişletir. Eski `rankBricks()` hâlâ kendi
//    başına tam çalışıyor, hiçbir çağrısı kırılmıyor.
//
//  MEVCUT 5 BİLEŞEN (brick-ranking-engine.js'den geliyor, değişmedi):
//    %30 Realizasyon Açığı  — ne kadar hedefin gerisinde?
//    %25 Büyüme Potansiyeli — IMS pazar hacmi
//    %20 Pazar Fırsatı      — rakip zayıflığı / pazar boşluğu
//       (NOT: competitive-adapter.js (FAZ 6.4) ile gerçek rakip verisi
//        artık var — şimdilik brick-ranking'in proxy değeri kullanılıyor,
//        MarketShareEngine (FAZ 6.3.5) ile entegrasyon ayrı bir adım)
//    %15 Kapsama Zayıflığı  — son ziyaretten geçen gün
//    %10 MI&GI Fırsatı      — endeks fırsatı
//
//  YENİ 3 BİLEŞEN (bu motor bağlar):
//    Learning  — PatternLearningEngine.getCachedSummary().bestPatterns'tan
//                o brick için geçmiş başarı oranı (senkron, FAZ 6.2 hazır)
//    Outcome   — OutcomeTracker.getCachedSummary().recentOutcomes'tan
//                o brick'teki son öneri başarı oranı (senkron, FAZ 1.3 hazır)
//    Sipariş   — PharmacyBehaviorEngine.buildBehaviorProfiles(ttt)'nin
//    Döngüsü     avgOrderCycle / daysToNextOrder bileşeni (FAZ 6.1 hazır,
//                roadmap §7: "Sipariş Döngüsü — pharmacy-intelligence'da
//                avgOrderCycle var ama brick-ranking'e bağlı değil")
//
//  AĞIRLIK DAĞILIMI — 8 bileşen, toplam 100 puan:
//    Mevcut 5 bileşen: orijinal ağırlıkları KORUR ama normalize edilir
//    (toplam %75'e indirilir — kalan %25 yeni 3 bileşene verilir):
//      %22.5 Realizasyon Açığı  (orijinal %30 × 0.75)
//      %18.75 Büyüme Potansiyeli (orijinal %25 × 0.75)
//      %15 Pazar Fırsatı         (orijinal %20 × 0.75)
//      %11.25 Kapsama Zayıflığı  (orijinal %15 × 0.75)
//      %7.5 MI&GI                (orijinal %10 × 0.75)
//    Yeni 3 bileşen:
//      %12 Learning              — geçmiş başarı örüntüsü
//      %8  Outcome               — son öneri sonuç oranı
//      %5  Sipariş Döngüsü       — eczane yeniden sipariş zamanlaması
//
//  ÖNEMLİ KISITLAR:
//    1. Learning ve Outcome brick bazlı senkron veri DEĞİL, tüm brick'lere
//       uygulanan bir ürün/genel başarı sinyali — bu bir yuvarlama, FAZ 6.5
//       kapsamında kasıtlı basitleştirme. Brick bazlı asenkron sorgulama
//       (getPatternsByBrick, getOutcomesByBrick) sonraki bir aşama.
//    2. Sipariş Döngüsü bileşeni brick bazlı değil, ttt bazlı brick'in
//       eczanelerinin ORTALAMASINDAN gelir (PharmacyBehaviorEngine).
//    3. Competitive Campaign bileşeni (roadmap §7'de "⚠️ Proxy") şimdilik
//       brick-ranking-engine'in mevcut Pazar Fırsatı bileşeninde kalıyor —
//       CompetitiveImpactEngine (FAZ 6.6) ile gerçek rakip kampanya sinyali
//       ileride bu bileşeni zenginleştirecek.
//
//  STANDART OpportunityScoreRecord MODELİ:
//    {
//      brick,
//      score8: number,        // 0-100, 8-bileşenli final skor
//      score5: number,        // brick-ranking-engine'in orijinal skoru (geriye dönük uyumluluk)
//      classification,        // OPPORTUNITY|STABLE|SATURATED|RESCUE (brick-ranking'den miras)
//      reason, detail,        // brick-ranking'den miras
//      scores: {
//        realization, growth, market, coverage, migi, // orijinal 5 (normalize edilmiş değil, ham)
//        learning, outcome, orderCycle                 // yeni 3 (0-100)
//      },
//      learningSignal: null|number,   // geçmiş başarı oranı (0-100), null = veri yok
//      outcomeSignal: null|number,    // son outcome başarı oranı (0-100), null = veri yok
//      orderCycleSignal: null|number  // sipariş aciliyeti skoru (0-100), null = veri yok
//    }
//
//  Public API:
//    rankBricks8(ttt)               → OpportunityScoreRecord[] (8-bileşenli, sıralı)
//    getOpportunityContext(ttt)     → { top3, rescue, signals } (AI promptu için özet)
//    clearCache()
//
//  Kurallar:
//    • brick-ranking-engine.js DEĞİŞTİRİLMEDİ.
//    • PatternLearningEngine / OutcomeTracker / PharmacyBehaviorEngine
//      DEĞİŞTİRİLMEDİ — sadece okunur.
//    • DOM erişimi YOK.
//
//  Bağımlılık: brick-ranking-engine.js (window.rankBricks — ZORUNLU),
//              PatternLearningEngine (opsiyonel), OutcomeTracker (opsiyonel),
//              PharmacyBehaviorEngine (opsiyonel)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._OPPORTUNITY_SCORE_ENGINE_LOADED) {
    console.warn('[opportunity-score-engine] Zaten yüklü — atlandı');
    return;
  }
  window._OPPORTUNITY_SCORE_ENGINE_LOADED = true;

  var ENGINE_VERSION = '1.0';

  // Ağırlıklar — orijinal 5 bileşen %75'e normalize, yeni 3 bileşen %25
  var W = {
    realization:  0.225,  // orijinal 0.30 × 0.75
    growth:       0.1875, // orijinal 0.25 × 0.75
    market:       0.15,   // orijinal 0.20 × 0.75
    coverage:     0.1125, // orijinal 0.15 × 0.75
    migi:         0.075,  // orijinal 0.10 × 0.75
    learning:     0.12,   // YENİ — geçmiş başarı örüntüsü
    outcome:      0.08,   // YENİ — son öneri başarı oranı
    orderCycle:   0.05    // YENİ — sipariş döngüsü aciliyeti
  };
  // Toplam kontrol: 0.225+0.1875+0.15+0.1125+0.075+0.12+0.08+0.05 = 1.00 ✓

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) LEARNING SİNYALİ — PatternLearningEngine'den ürün bazlı
  //     geçmiş başarı oranı (en yüksek başarılı ürünü bul, o brick
  //     için proxy olarak kullan — §Kısıtlar 1. madde)
  // ──────────────────────────────────────────────────────────────────
  function _getLearningSignal() {
    return _safe(function () {
      if (!window.PatternLearningEngine ||
          typeof window.PatternLearningEngine.getCachedSummary !== 'function') return null;
      var summary = window.PatternLearningEngine.getCachedSummary(null);
      if (!summary || !summary.bestPatterns || !summary.bestPatterns.length) return null;
      // Tüm pattern'ların ağırlıklı ortalama başarı oranı (brick bazlı değil,
      // genel sistem öğrenmesi — §Kısıtlar 1. madde)
      var totalN = 0, weighted = 0;
      summary.bestPatterns.forEach(function (p) {
        var n = (p.outcomes && p.outcomes.sampleSize) || 0;
        var r = (p.outcomes && p.outcomes.successRate) || 0;
        totalN += n; weighted += r * n;
      });
      return totalN > 0 ? Math.round((weighted / totalN) * 10) / 10 : null;
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) OUTCOME SİNYALİ — OutcomeTracker'dan global başarı oranı
  //     (brick bazlı asenkron değil, genel cached başarı oranı)
  // ──────────────────────────────────────────────────────────────────
  function _getOutcomeSignal() {
    return _safe(function () {
      if (!window.OutcomeTracker ||
          typeof window.OutcomeTracker.getCachedSummary !== 'function') return null;
      var summary = window.OutcomeTracker.getCachedSummary();
      return (summary && summary.successRate != null) ? summary.successRate : null;
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) SİPARİŞ DÖNGÜSÜNü SİNYALİ — PharmacyBehaviorEngine'den
  //     o brick'teki eczanelerin ortalama sipariş aciliyeti
  //     (daysToNextOrder düşükse = sipariş yakın = yüksek sinyal)
  // ──────────────────────────────────────────────────────────────────
  function _getOrderCycleByBrick(ttt) {
    return _safe(function () {
      if (!window.PharmacyBehaviorEngine ||
          typeof window.PharmacyBehaviorEngine.buildBehaviorProfiles !== 'function') return {};
      var profiles = window.PharmacyBehaviorEngine.buildBehaviorProfiles(ttt);
      var byBrick = {};
      profiles.forEach(function (p) {
        if (!p.brick) return;
        if (!byBrick[p.brick]) byBrick[p.brick] = { totalDays: 0, count: 0 };
        byBrick[p.brick].totalDays += (p.daysToNextOrder || 30);
        byBrick[p.brick].count++;
      });
      // Her brick için ortalama "kalan gün" → 0=acil(100 puan), 30+=bekleme(0 puan)
      var result = {};
      Object.keys(byBrick).forEach(function (brick) {
        var avg = byBrick[brick].totalDays / byBrick[brick].count;
        // 0 gün → skor 100, 30 gün → skor 0, lineer (sipariş YAKLAŞIYOR = fırsat)
        result[brick] = Math.max(0, Math.round((1 - Math.min(avg, 30) / 30) * 100));
      });
      return result;
    }, {});
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) ANA FONKSİYON — rankBricks8(ttt)
  // ──────────────────────────────────────────────────────────────────
  var _cache = {}; // ttt → { records, timestamp }
  var CACHE_TTL_MS = 60000;

  function rankBricks8(ttt) {
    if (!ttt) return [];
    if (!window.rankBricks) {
      console.warn('[opportunity-score-engine] brick-ranking-engine.js yüklü değil — boş dönüyor');
      return [];
    }

    var now = Date.now();
    if (_cache[ttt] && (now - _cache[ttt].timestamp) < CACHE_TTL_MS) {
      return _cache[ttt].records;
    }

    var base = window.rankBricks(ttt); // brick-ranking-engine'in 5-bileşenli çıktısı
    if (!base || !base.length) return [];

    // Sinyalleri BİR KERE hesapla (tüm brick'ler için aynı genel sinyaller)
    var learningSignal = _getLearningSignal();  // 0-100 veya null
    var outcomeSignal  = _getOutcomeSignal();   // 0-100 veya null
    var orderCycleByBrick = _getOrderCycleByBrick(ttt); // { brick → 0-100 }

    var records = base.map(function (b) {
      // Orijinal skor bileşenlerini 0-100 olarak kullan (zaten normalize)
      var s5 = b.scores || {};

      var learningScore   = learningSignal  != null ? learningSignal  : 50; // null → nötr
      var outcomeScore    = outcomeSignal   != null ? outcomeSignal   : 50; // null → nötr
      var orderCycleScore = (orderCycleByBrick[b.brick] != null)
        ? orderCycleByBrick[b.brick] : 50; // null → nötr

      var score8 = +(
        (s5.realization || 0) * W.realization +
        (s5.growth      || 0) * W.growth      +
        (s5.market      || 0) * W.market      +
        (s5.coverage    || 0) * W.coverage    +
        (s5.migi        || 0) * W.migi        +
        learningScore         * W.learning    +
        outcomeScore          * W.outcome     +
        orderCycleScore       * W.orderCycle
      ).toFixed(1);

      return {
        brick:          b.brick,
        score8:         +score8,
        score5:         b.score, // orijinal 5-bileşenli skor (geriye dönük)
        classification: b.classification,
        reason:         b.reason,
        detail:         b.detail,
        scores: {
          realization: s5.realization || 0,
          growth:      s5.growth      || 0,
          market:      s5.market      || 0,
          coverage:    s5.coverage    || 0,
          migi:        s5.migi        || 0,
          learning:    +learningScore.toFixed(1),
          outcome:     +outcomeScore.toFixed(1),
          orderCycle:  +orderCycleScore.toFixed(1)
        },
        learningSignal:    learningSignal,
        outcomeSignal:     outcomeSignal,
        orderCycleSignal:  orderCycleByBrick[b.brick] != null ? orderCycleByBrick[b.brick] : null
      };
    });

    // 8-bileşenli skora göre yeniden sırala
    records.sort(function (a, b) { return b.score8 - a.score8; });

    _cache[ttt] = { records: records, timestamp: now };
    return records;
  }

  // ──────────────────────────────────────────────────────────────────
  //  5) getOpportunityContext(ttt) — AI promptu için kısa özet
  //     (AIContextBuilder.context.opportunity alanına beslenecek —
  //     FAZ 6.3'te placeholder olarak null bırakılmıştı, şimdi dolar)
  // ──────────────────────────────────────────────────────────────────
  function getOpportunityContext(ttt) {
    var all = rankBricks8(ttt);
    if (!all.length) return { top3: [], rescue: [], signals: {} };

    var rescue = all.filter(function (r) { return r.classification === 'RESCUE'; });
    var top3   = all.filter(function (r) { return r.classification !== 'RESCUE'; }).slice(0, 3);

    var signals = {
      learningSignal:  _getLearningSignal(),
      outcomeSignal:   _getOutcomeSignal(),
      hasOrderCycleData: Object.keys(_getOrderCycleByBrick(ttt)).length > 0
    };

    return { top3: top3, rescue: rescue, signals: signals };
  }

  function clearCache() { _cache = {}; }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.OpportunityScoreEngine = {
    rankBricks8:           rankBricks8,
    getOpportunityContext: getOpportunityContext,
    clearCache:            clearCache,
    weights:               W,  // dışa açık — test/debug için
    version:               ENGINE_VERSION
  };

  console.debug('[opportunity-score-engine] yüklendi. Versiyon:', ENGINE_VERSION,
    '| Ağırlıklar: 5-bileşen %75 + Learning %12 + Outcome %8 + Sipariş %5');

})();
