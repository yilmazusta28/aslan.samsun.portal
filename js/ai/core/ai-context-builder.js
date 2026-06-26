// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ai-context-builder.js
//  FAZ 0 — AI Consolidation · AI Core Mimarisi
//  FAZ 6.3 — AIContextBuilder v2 (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §11)
//
//  Sorumluluk: Tüm AI Core modüllerinin (orchestrator, coach, intelligence)
//    kullandığı TEK ORTAK context nesnesini üretmek.
//
//    • buildContext(overrides) → {
//        ttt, brick, product, period, dateRange,
//        filters, userPrefs, data: { ims, genel, migi, eczane },
//        learning, outcomes, patterns,
//        normalizedIMS, imsMetadata, growthSummary, trendSummary,
//        coverage, planning, forecast, recommendationHistory,        ← FAZ 6.3 YENİ
//        competitiveCampaigns, decision, rca, opportunity,            ← FAZ 6.3 placeholder (sonraki fazlar doldurur)
//        generatedAt
//      }
//
//  ÖNEMLİ — bu dosya buildTTTContext()'in (ai-context.js) YERİNİ ALMAZ.
//  buildTTTContext() hâlâ AI sohbet asistanı için METİN tabanlı prompt
//  üretir ve değiştirilmedi (geriye dönük uyumluluk). ai-context-builder.js
//  ise yapısal (object) context üretir — ai-orchestrator.js ve gelecekteki
//  tüketiciler için.
//
//  FAZ 6.3 GENİŞLETMESİ — NE EKLENDİ, NE DEĞİŞMEDİ:
//    EKLENDİ (§11 şeması): coverage, planning, forecast,
//    recommendationHistory — dördü de MEVCUT motorları (coverage-engine,
//    territory-engine, forecast-engine, runrate-engine, recommendation-
//    memory) OLDUKLARI GİBİ çağırır, hiçbiri değiştirilmedi.
//
//    learning ALANI DEĞİŞTİ (önceki stub {available:bool} yerine artık
//    GERÇEK veri): FAZ 6.2'de eklenen learning-hub.js mevcutsa
//    LearningHub.getLearningContext(ttt) okunur — bu, outcomes/patterns
//    alanlarının okuduğu AYNI alt sistemleri (OutcomeTracker,
//    PatternLearningEngine) + EK olarak predictionAccuracy/behaviorSignals/
//    teamBestPractices/recommendationStats'ı tek nesnede toplar.
//    outcomes/patterns alanları KASTEN DOKUNULMADI (geriye dönük
//    uyumluluk — mevcut tüketiciler varsa kırılmasın); evet artık
//    learning.recentOutcomes ile outcomes.recentOutcomes içerik olarak
//    örtüşüyor, bu KASITLI bir geçiş dönemi fazlalığı, veri kaybı değil.
//
//    competitiveCampaigns/decision/rca/opportunity ŞİMDİLİK null/boş
//    PLACEHOLDER — bunlar sırasıyla FAZ 6.4 (competitive-adapter.js),
//    FAZ 6.7 (Decision Engine), FAZ 6.6 (RCA Engine), FAZ 6.5 (8-bileşenli
//    Opportunity Score) tarafından doldurulacak. Şemada YER AYRILDI ki
//    o fazlar geldiğinde context tüketicileri (ai-orchestrator.js vb.)
//    ŞİMDİDEN bu alanların VARLIĞINA güvenebilsin (undefined değil, null).
//
//    PERFORMANS (§12 kuralı): coverage VE planning AYRI AYRI
//    hesaplanmıyor — territory-engine.js'in buildTerritoryStrategy(ttt)
//    zaten coverage'ı kendi pipeline'ında (rankBricks → analyzeCoverage →
//    buildVisitPlan → analyzeWorkload) üretiyor; result.coverage TEK
//    çağrıdan ikisine de dağıtılır, analyzeCoverage() İKİNCİ KEZ
//    ÇAĞRILMAZ.
//
//  AI MİMARİ STABİLİZASYONU (bkz. docs/AI_MIMARI_STABILIZASYON_RAPORU.md):
//    normalizedIMS/imsMetadata/growthSummary/trendSummary alanları
//    js/ai/core/ims-adapter.js üzerinden gelir — GERÇEK parseIMSCSV()
//    çıktısından normalize edilmiş veri. data.ims (HAM global dizi)
//    geriye dönük uyumluluk için OLDUĞU GİBİ KORUNDU; yeni alanlar EK
//    gelir, onun yerini almaz.
//
//  Kurallar:
//    • Eksik veri / global değişken durumunda HATA VERMEZ.
//    • Her alan için güvenli varsayılan değer kullanılır.
//    • DOM erişimi YOK.
//
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js,
//              js/core/date-utils.js, js/core/constants.js
//              (hepsi opsiyonel — typeof ile kontrol edilir)
//  Yükleme sırası: ims-adapter.js, data-state.js, date-utils.js SONRASI
//                  ai-orchestrator.js, ai-core.js ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._AI_CONTEXT_BUILDER_LOADED) {
    console.warn('[ai-context-builder] Zaten yüklü — atlandı');
    return;
  }
  window._AI_CONTEXT_BUILDER_LOADED = true;

  // ── _safe — global okuma sırasında hata yutan yardımcı ─────────────
  function _safe(fn, fallback) {
    try {
      var v = fn();
      return (v === undefined || v === null) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // ── _resolveTTT — context.ttt için olası kaynaklardan ilk geçerliyi al
  function _resolveTTT(overrides) {
    if (overrides && overrides.ttt) return overrides.ttt;
    return _safe(function () { return engineSelTTT; }, null) ||
           _safe(function () { return selAiTTT; }, null) ||
           _safe(function () { return selTTT; }, null) ||
           null;
  }

  // ── _resolvePeriod — bugünün tarihine göre aktif dönemi bulur ───────
  function _resolvePeriod() {
    var today = _safe(function () { return new Date().toISOString().slice(0, 10); }, null);
    var periods = _safe(function () { return PERIODS; }, []);
    var cur = (periods || []).find(function (p) { return today >= p.start && today <= p.end; });
    if (!cur) return { key: null, label: '—', start: null, end: null, remainingWorkDays: 0 };
    var remaining = _safe(function () { return workDays(today, cur.end); }, 0);
    return {
      key: cur.key,
      label: cur.label,
      start: cur.start,
      end: cur.end,
      remainingWorkDays: remaining
    };
  }

  // ── _resolveFilters — ekranlarda kullanılan ortak filtre state'i ───
  // Mevcut global filtre değişkenleri varsa enstantane (snapshot) olarak
  // okunur. Hiçbiri yoksa boş obje döner — hata vermez.
  function _resolveFilters(overrides) {
    var snapshot = {
      group:        _safe(function () { return selGroup; }, null),
      week:         _safe(function () { return selHafta; }, null),
      kutuUruns:    _safe(function () { return selKutuUruns; }, null),
      eczaneTTT:    _safe(function () { return selEczaneTTT; }, null),
      eczaneBrick:  _safe(function () { return selEczaneBrick; }, null),
      eczaneUrun:   _safe(function () { return selEczaneUrun; }, null),
      eczaneAy:     _safe(function () { return selEczaneAy; }, null)
    };
    return Object.assign(snapshot, (overrides && overrides.filters) || {});
  }

  // ── _resolveUserPrefs — kullanıcı tercihleri (varsa storage'dan) ───
  function _resolveUserPrefs() {
    return _safe(function () {
      if (typeof loadProxyUrl === 'function') {
        return { proxyConfigured: !!(window.AI_PROXY_URL) };
      }
      return {};
    }, {});
  }

  // ── _resolveLearning — FAZ 6.2 Learning Hub entegrasyonu ─────────────
  // ÖNCEKİ HALİ: sadece { available: bool } stub'ı döndürüyordu.
  // FAZ 6.3: learning-hub.js (FAZ 6.2) mevcutsa GERÇEK birleşik öğrenme
  // context'i okunur (bestPatterns, successRate, predictionAccuracy,
  // recentOutcomes, behaviorSignals, teamBestPractices,
  // recommendationStats — bkz. learning-hub.js dosya başı şema).
  // LearningHub yüklü değilse (rollback / FAZ 6.2 öncesi durum) eski
  // stub davranışına düşülür — hata vermez.
  function _resolveLearning(ttt) {
    return _safe(function () {
      if (window.LearningHub && typeof window.LearningHub.getLearningContext === 'function') {
        var ctx = window.LearningHub.getLearningContext(ttt);
        ctx.available = true; // eski stub'ın {available} alanı geriye dönük korunur
        return ctx;
      }
      return { available: false };
    }, { available: false });
  }

  // ── _resolveTerritory — FAZ 6.3: coverage + planning TEK ÇAĞRIDAN ───
  // territory-engine.js'in buildTerritoryStrategy(ttt) fonksiyonu zaten
  // coverage-engine.js'i kendi pipeline'ında çağırıyor (§12 performans
  // kuralı: analyzeCoverage() İKİNCİ KEZ ÇAĞRILMAZ — sadece
  // buildTerritoryStrategy() bir kez çağrılır, sonucu hem coverage hem
  // planning alanlarına dağıtılır).
  // @returns {{ coverage: Array, planning: Object }}
  function _resolveTerritory(ttt) {
    return _safe(function () {
      if (!ttt || typeof window.buildTerritoryStrategy !== 'function') {
        return { coverage: [], planning: {} };
      }
      var strategy = window.buildTerritoryStrategy(ttt);
      return {
        coverage: strategy.coverage || [],
        planning: strategy // tüm strateji nesnesi (topBricks/weakBricks/visitPlan/workload/strategy dahil)
      };
    }, { coverage: [], planning: {} });
  }

  // ── _resolveForecast — FAZ 6.3: forecast-engine + runrate-engine ────
  // İki motor da ayrı, bağımsız hesap yapıyor (biri ürün bazlı projeksiyon,
  // diğeri günlük run-rate) — roadmap §11 şeması ikisini "forecast" altında
  // birleştirmeyi istiyor, bu yüzden TEK nesneye toplanır. Hiçbir motor
  // değiştirilmedi.
  function _resolveForecast(ttt) {
    return _safe(function () {
      var forecast = (ttt && typeof window.generateForecast === 'function')
        ? window.generateForecast(ttt) : null;
      var runRate = (ttt && typeof window.calculateRunRate === 'function')
        ? window.calculateRunRate(ttt) : null;
      return { forecast: forecast, runRate: runRate };
    }, { forecast: null, runRate: null });
  }

  // ── _resolveRecommendationHistory — FAZ 6.3: recommendation-memory.js ─
  // recommendation-memory.js type="module" olarak yüklenir (deferred) —
  // window.RecommendationMemory bridge'i ÇAĞRI ZAMANINDA kontrol edilir,
  // dosya henüz yüklenmemişse güvenli boş dizi döner.
  function _resolveRecommendationHistory(ttt) {
    return _safe(function () {
      if (!window.RecommendationMemory) return [];
      if (ttt && typeof window.RecommendationMemory.getRecommendationsByRepresentative === 'function') {
        return window.RecommendationMemory.getRecommendationsByRepresentative(ttt) || [];
      }
      if (typeof window.RecommendationMemory.getRecommendations === 'function') {
        return window.RecommendationMemory.getRecommendations() || [];
      }
      return [];
    }, []);
  }

  // ── _resolveOutcomes — FAZ 1.3 Outcome Tracker entegrasyonu ─────────
  // outcome-tracker.js senkron bir cache sunar (window.OutcomeTracker.
  // getCachedSummary()) — IndexedDB sorgusu ASENKRON olduğu için
  // buildContext()'in senkron sözleşmesini bozmadan en son hesaplanmış
  // özet burada okunur. outcome-tracker.js yüklenmemişse güvenli
  // varsayılanlar döner (hata vermez).
  function _resolveOutcomes() {
    return _safe(function () {
      if (window.OutcomeTracker && typeof window.OutcomeTracker.getCachedSummary === 'function') {
        var s = window.OutcomeTracker.getCachedSummary();
        return {
          recentOutcomes:        s.recentOutcomes        || [],
          successRate:           (typeof s.successRate === 'number') ? s.successRate : null,
          lastSuccessfulActions: s.lastSuccessfulActions || [],
          lastFailedActions:     s.lastFailedActions     || []
        };
      }
      return { recentOutcomes: [], successRate: null, lastSuccessfulActions: [], lastFailedActions: [] };
    }, { recentOutcomes: [], successRate: null, lastSuccessfulActions: [], lastFailedActions: [] });
  }

  // ── _resolvePatterns — FAZ 1.4 Learning Engine (Pattern Learning) ────
  // js/ai/learning/learning-engine.js senkron bir cache sunar
  // (window.PatternLearningEngine.getCachedSummary(product)) — aynı
  // senkron-cache deseni FAZ 1.3'teki gibi kullanılır. NOT: bu motor
  // window.LearningEngine (Phase 5.4, tahmin doğruluğu) İLE AYNI ŞEY
  // DEĞİLDİR — window.PatternLearningEngine kullanılır (isim çakışması
  // önlemi, bkz. FAZ1.4 raporu).
  function _resolvePatterns(product) {
    return _safe(function () {
      if (window.PatternLearningEngine && typeof window.PatternLearningEngine.getCachedSummary === 'function') {
        var s = window.PatternLearningEngine.getCachedSummary(product);
        return {
          bestPatterns:           s.bestPatterns           || [],
          relevantPatterns:       s.relevantPatterns        || [],
          historicalSuccessRates: s.historicalSuccessRates  || {},
          historicalFailures:     s.historicalFailures      || [],
          learningConfidence:     (typeof s.learningConfidence === 'number') ? s.learningConfidence : null
        };
      }
      return { bestPatterns: [], relevantPatterns: [], historicalSuccessRates: {}, historicalFailures: [], learningConfidence: null };
    }, { bestPatterns: [], relevantPatterns: [], historicalSuccessRates: {}, historicalFailures: [], learningConfidence: null });
  }

  // ── _resolveNormalizedIMS — AI MİMARİ STABİLİZASYONU ─────────────────
  // ims-adapter.js üzerinden NORMALİZE EDİLMİŞ IMSRecord dizisini
  // döndürür. ims-adapter.js'in kendi içsel cache'i sayesinde (ttt +
  // içerik imzası bazlı) bu çağrı, trend/risk/insight/recommendation/
  // opportunity/forecast motorlarının ZATEN hesapladığı SONUCU yeniden
  // kullanır — parser/normalize işlemi gerçekte BİR KEZ çalışır (Master
  // Prompt'un "Tüm motorlar aynı nesneyi kullanmalı" performans kuralı).
  function _resolveNormalizedIMS(ttt) {
    return _safe(function () {
      if (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function') {
        return window.IMSAdapter.normalizeIMS(ttt) || [];
      }
      return [];
    }, []);
  }

  // ── _resolveImsMetadata — normalize edilmiş veri setinin özeti ──────
  function _resolveImsMetadata(records) {
    return _safe(function () {
      var products = records.map(function (r) { return r.product; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
      var bricks = records.map(function (r) { return r.brick; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
      var totalVolume = records.reduce(function (s, r) { return s + (r.total || 0); }, 0);
      return {
        recordCount:    records.length,
        productCount:   products.length,
        brickCount:     bricks.length,
        totalVolume:    totalVolume,
        adapterVersion: (window.IMSAdapter && window.IMSAdapter.version) || null
      };
    }, { recordCount: 0, productCount: 0, brickCount: 0, totalVolume: 0, adapterVersion: null });
  }

  // ── _resolveGrowthSummary — temsilcinin GENEL büyüme görünümü ───────
  // (tüm ürünlerin birleşik haftalık hacminden tek bir growth/trend)
  function _resolveGrowthSummary(records) {
    return _safe(function () {
      if (!records.length || !window.IMSAdapter || typeof window.IMSAdapter.aggregateRecords !== 'function') {
        return { overallGrowth: 0, overallTrend: 'stable', risingProducts: [], decliningProducts: [] };
      }
      var agg = window.IMSAdapter.aggregateRecords(records);
      var rising     = records.filter(function (r) { return r.calculated.trend === 'up';   }).map(function (r) { return r.product; });
      var declining  = records.filter(function (r) { return r.calculated.trend === 'down'; }).map(function (r) { return r.product; });
      return {
        overallGrowth:    agg ? agg.calculated.growth : 0,
        overallTrend:     agg ? agg.calculated.trend  : 'stable',
        risingProducts:    rising,
        decliningProducts: declining
      };
    }, { overallGrowth: 0, overallTrend: 'stable', risingProducts: [], decliningProducts: [] });
  }

  // ── _resolveSourceAdapterFields — FAZ 7.0 GENEL köprü ────────────────
  // SourceAdapterRegistry'ye kayıtlı TÜM adapter'ların (şu an:
  // fieldObservations, stockSignals — ileride SharePoint/Temsilci
  // Notları/vb.) normalize edilmiş çıktısını, KENDİ contextHook alan
  // adlarıyla döner. YENİ BİR KAYNAK EKLENDİĞİNDE BU FONKSİYON
  // DEĞİŞMEZ — registry kendi içinde genel (§13, §16 FAZ 7.0).
  // SourceAdapterRegistry yüklü değilse (rollback / FAZ 7.0 öncesi durum)
  // boş obje döner — context'in geri kalanı ETKİLENMEZ.
  function _resolveSourceAdapterFields() {
    return _safe(function () {
      if (window.SourceAdapterRegistry && typeof window.SourceAdapterRegistry.getContextFields === 'function') {
        return window.SourceAdapterRegistry.getContextFields();
      }
      return {};
    }, {});
  }

  // ── _resolveTrendSummary — ürün bazlı trend dağılımı ─────────────────
  function _resolveTrendSummary(records) {
    return _safe(function () {
      return {
        up:     records.filter(function (r) { return r.calculated.trend === 'up';     }).map(function (r) { return r.product; }),
        down:   records.filter(function (r) { return r.calculated.trend === 'down';   }).map(function (r) { return r.product; }),
        stable: records.filter(function (r) { return r.calculated.trend === 'stable'; }).map(function (r) { return r.product; })
      };
    }, { up: [], down: [], stable: [] });
  }

  // ── buildContext — ana giriş noktası ────────────────────────────────
  // @param {Object} [overrides] — { ttt, brick, product, filters, dateRange }
  // @returns {Object} yapısal AI context'i
  function buildContext(overrides) {
    overrides = overrides || {};

    var ttt     = _resolveTTT(overrides);
    var product = overrides.product || _safe(function () { return selKutuUruns; }, null);

    // AI MİMARİ STABİLİZASYONU: normalize edilmiş IMS BİR KEZ hesaplanır
    // (ims-adapter.js'in kendi cache'i sayesinde), growthSummary/
    // trendSummary/imsMetadata bu TEK sonuçtan türetilir — tekrar parser
    // çağrısı veya tekrar normalize işlemi YOK.
    var normalizedIMS = _resolveNormalizedIMS(ttt);

    // FAZ 6.3: territory-engine tek seferde çağrılır (coverage + planning
    // ikisi de buradan dağıtılır — bkz. _resolveTerritory yorum notu)
    var territory = _resolveTerritory(ttt);


    var context = {
      ttt:     ttt,
      brick:   overrides.brick || _safe(function () { return selEczaneBrick; }, null),
      product: product,

      period:    _resolvePeriod(),
      dateRange: overrides.dateRange || null,

      filters:   _resolveFilters(overrides),
      userPrefs: _resolveUserPrefs(),

      data: {
        ims:    _safe(function () { return IMS    || []; }, []),
        genel:  _safe(function () { return GENEL  || []; }, []),
        migi:   _safe(function () { return MIGI_BRICK_TL_RAW || []; }, []),
        eczane: _safe(function () {
          return (eczaneLoaded && ECZANE_RAW) ? ECZANE_RAW : [];
        }, [])
      },

      learning: _resolveLearning(ttt),

      // FAZ 1.3: Outcome Tracker — son 6 aylık öneri sonuç özetleri.
      // Mevcut alanlara EK olarak gelir, hiçbir alanı değiştirmez/silmez.
      outcomes: _resolveOutcomes(),

      // FAZ 1.4: Learning Engine (Pattern Learning) — ürüne göre ilgili
      // pattern'lar + genel en-iyi pattern'lar. Mevcut alanlara EK olarak
      // gelir, hiçbir alanı değiştirmez/silmez.
      patterns: _resolvePatterns(product),

      // AI MİMARİ STABİLİZASYONU: ims-adapter.js üzerinden normalize
      // edilmiş IMS + türetilmiş özetler. data.ims (yukarıda, HAM/ham
      // global dizi) GERİYE DÖNÜK UYUMLULUK için OLDUĞU GİBİ KORUNDU —
      // bu yeni alanlar EK gelir, data.ims'in yerini almaz.
      normalizedIMS:  normalizedIMS,
      imsMetadata:    _resolveImsMetadata(normalizedIMS),
      growthSummary:  _resolveGrowthSummary(normalizedIMS),
      trendSummary:   _resolveTrendSummary(normalizedIMS),

      // FAZ 6.3 (§11 şeması) — coverage + planning TEK territory
      // çağrısından (bkz. _resolveTerritory yorum notu, performans §12)
      coverage: territory.coverage,
      planning: territory.planning,

      // FAZ 6.3 — forecast-engine + runrate-engine birleşik
      forecast: _resolveForecast(ttt),

      // FAZ 6.3 — recommendation-memory.js geçmişi (ttt bazlı, varsa)
      recommendationHistory: _resolveRecommendationHistory(ttt),

      // FAZ 6.3 — PLACEHOLDER alanlar (§11 şeması, sonraki fazlar doldurur):
      //   competitiveCampaigns ← FAZ 6.4 (competitive-adapter.js)
      //   decision             ← FAZ 6.7 (Decision Engine)
      //   rca                  ← FAZ 6.6 (RCA Engine)
      competitiveCampaigns: null,

      // FAZ 6.7 — Decision Engine (DecisionEngine.decide())
      decision: _safe(function () {
        if (!window.DecisionEngine) return null;
        return window.DecisionEngine.decide(ttt);
      }, null),

      rca: null,

      // FAZ 6.5 — 8-bileşenli Opportunity Score (OpportunityScoreEngine).
      // OpportunityScoreEngine yüklü değilse null → geriye dönük uyumlu.
      opportunity: _safe(function () {
        if (!window.OpportunityScoreEngine) return null;
        return window.OpportunityScoreEngine.getOpportunityContext(ttt);
      }, null),

      generatedAt: new Date().toISOString()
    };

    // FAZ 7.0 — SourceAdapterRegistry köprüsü (AI_MIMARI_ANALIZ_VE_YOL_
    // HARITASI.md §13, §16). Yukarıdaki context nesnesi DEĞİŞMEDEN bırakılır
    // ("ekle, kırma" prensibi) — kayıtlı adapter'ların alanları buraya
    // SONRADAN eklenir. Yeni bir kaynak eklendiğinde bu satır AYNEN kalır.
    Object.assign(context, _resolveSourceAdapterFields());

    return context;
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.AIContextBuilder = {
    buildContext: buildContext
  };

  console.debug('[ai-context-builder] FAZ 0 + FAZ 1.3 (outcomes) + FAZ 1.4 (patterns) + AI Mimari Stabilizasyonu (normalizedIMS) + FAZ 6.3 v2 (learning/coverage/planning/forecast/recommendationHistory) + FAZ 6.5 (opportunity/8-bileşen) yüklendi.');

})();
