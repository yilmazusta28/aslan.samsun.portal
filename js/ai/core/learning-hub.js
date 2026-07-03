// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/learning-hub.js
//  FAZ 6.2 — Learning Hub (Unified Learning & Memory Layer — okuma katmanı)
//
//  Sorumluluk:
//    Projede halihazırda var olan BEŞ ayrı öğrenme/hafıza alt sistemini
//    (her biri kendi dosyasında, kendi IndexedDB/localStorage'ında, kendi
//    public API'siyle) TEK bir senkron okuma fonksiyonunda toplar:
//      getLearningContext(tttFilter) → { bestPatterns, successRate,
//        predictionAccuracy, recentOutcomes, behaviorSignals,
//        teamBestPractices }
//
//  ⚠️ NEDEN BU DOSYA VAR (bkz. AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §8, §16 FAZ 6.2):
//    §3.2'de tespit edilen 5 parçalı öğrenme yapısı (PatternLearningEngine,
//    OutcomeTracker, RecommendationMemory, AI_MEMORY, LearningEngine/MAPE)
//    AYRI AYRI var ama hiçbiri birbirini bilmiyor — ve Master Prompt'un
//    context şemasında zaten talep edilen "Learning" ve "Outcome" bileşenleri
//    (bkz. §7 brick-ranking tablosu — Learning ❌ Yok, Outcome ❌ Yok) hiçbir
//    motora BAĞLANMAMIŞ durumdaydı. Bu, kod eksikliği değil — "bağlama"
//    (wiring) eksikliği. learning-hub.js sadece bu bağlamayı kurar.
//
//  ⚠️ KRİTİK TASARIM KISITI (kod incelemesiyle doğrulandı — roadmap §8'in
//    "senkron" varsayımı kısmen YANLIŞTI, burada düzeltildi):
//    PatternLearningEngine.getBestPatterns() ASENKRON (IndexedDB Promise
//    zinciri) — ama PatternLearningEngine.getCachedSummary(product) zaten
//    SENKRON bir önbellek sunuyor (ai-context-builder.js'in zaten kullandığı
//    desen). AYNI ŞEKİLDE OutcomeTracker.getCachedSummary() de senkron.
//    Bu yüzden learning-hub.js ASLA ham IndexedDB sorgusu (getPatterns,
//    getOutcomes vb.) ÇAĞIRMAZ — SADECE iki motorun zaten ürettiği senkron
//    getCachedSummary() çıktılarını okur. getLearningContext() bu sayede
//    tamamen senkron kalır, AIContextBuilder'ın senkron context oluşturma
//    akışını bozmaz.
//
//  GERİYE DÖNÜK UYUMLULUK / DEĞİŞMEYEN DOSYALAR (rapor §15 risk azaltma):
//    Beş alt sistemden HİÇBİRİ değiştirilmedi, taşınmadı, yeniden
//    adlandırılmadı:
//      • js/ai/learning/learning-engine.js   (PatternLearningEngine)
//      • js/ai/outcomes/outcome-tracker.js   (OutcomeTracker)
//      • js/ai/recommendation-memory.js      (RecommendationMemory, ES module)
//      • js/ai/memory/ai-memory.js           (AI_MEMORY)
//      • js/ai/learning-engine.js            (LearningEngine — MAPE/MAE/RMSE,
//        Phase 5.4 — DİKKAT: js/ai/learning/learning-engine.js'den AYRI bir
//        dosya, isim çakışması rapor §4'te zaten tespit edilmişti, BU FAZ'DA
//        ÇÖZÜLMEDİ — sadece her ikisi de değişmeden kendi global adlarıyla
//        (PatternLearningEngine / LearningEngine) okunuyor, çakışma sadece
//        DOSYA ADI seviyesinde, GLOBAL DEĞİŞKEN seviyesinde değil, bu yüzden
//        çalışma zamanında sorun YOK — isimlendirme netliği ayrı, isteğe
//        bağlı bir temizlik konusu)
//    learning-hub.js bu beşinin YERİNE geçmiyor — onları OKUYAN ek bir
//    katman. Bu dosyayı silmek hiçbirini bozmaz; sadece getLearningContext()
//    artık çağrılamaz.
//
//  Public API:
//    getLearningContext(tttFilter)   → senkron, AŞAĞIDAKİ alanları döner
//      {
//        bestPatterns:        [],   // PatternLearningEngine.getCachedSummary().bestPatterns
//        successRate:         null, // OutcomeTracker.getCachedSummary().successRate (0-100 | null)
//        predictionAccuracy:  null, // LearningEngine.getAccuracyMetrics() (MAPE/MAE/RMSE/hitRate)
//        recentOutcomes:      [],   // OutcomeTracker.getCachedSummary().recentOutcomes
//        behaviorSignals:     null, // AI_MEMORY.behavior[tttFilter] (varsa) | null
//        teamBestPractices:   [],   // bkz. getTeamBestPractices() — aynı çıktı
//        recommendationStats: null, // RecommendationMemory.getRecommendationStats() (varsa)
//        sourcesAvailable:    {}    // { pattern, outcome, prediction, memory, recMemory } — şeffaflık
//      }
//    getTeamBestPractices(limit)     → senkron, brick/ürün bazlı en başarılı pattern'lar
//                                       (PatternLearningEngine.getCachedSummary().bestPatterns'tan
//                                       süzülür — temsilciye özel DEĞİL, bkz. §8 notu)
//    clearCache()                    → iç cache temizle (alt sistemlerin kendi cache'lerine DOKUNMAZ)
//
//  CACHE: Bu dosya kendi içinde HİÇBİR veri SAKLAMAZ — her çağrıda alt
//  sistemlerin GÜNCEL senkron state'ini okur (ucuz: hepsi zaten memory'de
//  cache'li referanslar). clearCache() bu yüzden çoğunlukla no-op'tur,
//  ileride bu dosyaya gerçek bir ara-cache eklenirse diye API'de tutulur.
//
//  Kurallar:
//    • Hiçbir alt motor DEĞİŞTİRİLMEDİ.
//    • DOM erişimi YOK.
//    • Her alt sistem okuması ayrı ayrı try/catch + typeof guard ile
//      sarılı — biri eksik/bozuksa diğerleri etkilenmez (null-safe).
//    • ASLA asenkron IndexedDB sorgusu tetiklemez (yukarıdaki kısıt notu).
//
//  Bağımlılık: window.PatternLearningEngine, window.OutcomeTracker,
//              window.LearningEngine, window.AI_MEMORY,
//              window.RecommendationMemory (hepsi OPSİYONEL — typeof ile
//              kontrol edilir, hiçbiri zorunlu değildir)
//  Yükleme sırası: beş alt sistemden SONRA olması idealdir (ama çağrı-
//                  zamanlı okuma yaptığı için kesin şart değildir — bkz.
//                  pharmacy-adapter.js'teki aynı gerekçe). AIContextBuilder
//                  ÖNCESİ olmalıdır (context.learning'i o tüketecek).
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._LEARNING_HUB_LOADED) {
    console.warn('[learning-hub] Zaten yüklü — atlandı');
    return;
  }
  window._LEARNING_HUB_LOADED = true;

  var HUB_VERSION = '1.0';
  var DEFAULT_TEAM_PRACTICES_LIMIT = 10;

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) PatternLearningEngine → bestPatterns (SENKRON — getCachedSummary)
  // ──────────────────────────────────────────────────────────────────
  function _readPatternSummary(product) {
    return _safe(function () {
      if (!window.PatternLearningEngine || typeof window.PatternLearningEngine.getCachedSummary !== 'function') {
        return null;
      }
      return window.PatternLearningEngine.getCachedSummary(product);
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) OutcomeTracker → successRate, recentOutcomes (SENKRON)
  // ──────────────────────────────────────────────────────────────────
  function _readOutcomeSummary() {
    return _safe(function () {
      if (!window.OutcomeTracker || typeof window.OutcomeTracker.getCachedSummary !== 'function') {
        return null;
      }
      return window.OutcomeTracker.getCachedSummary();
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) LearningEngine (Phase 5.4 — MAPE/MAE/RMSE) → predictionAccuracy
  // ──────────────────────────────────────────────────────────────────
  function _readPredictionAccuracy() {
    return _safe(function () {
      if (!window.LearningEngine || typeof window.LearningEngine.getAccuracyMetrics !== 'function') {
        return null;
      }
      return window.LearningEngine.getAccuracyMetrics();
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) AI_MEMORY → behaviorSignals (tttFilter bazlı, zaten senkron state)
  // ──────────────────────────────────────────────────────────────────
  function _readBehaviorSignals(tttFilter) {
    return _safe(function () {
      if (!window.AI_MEMORY || !window.AI_MEMORY.behavior) return null;
      if (!tttFilter) return window.AI_MEMORY.behavior; // tüm temsilciler
      return window.AI_MEMORY.behavior[tttFilter] || null;
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  5) RecommendationMemory → recommendationStats (SENKRON, localStorage)
  // ──────────────────────────────────────────────────────────────────
  function _readRecommendationStats() {
    return _safe(function () {
      if (!window.RecommendationMemory || typeof window.RecommendationMemory.getRecommendationStats !== 'function') {
        return null;
      }
      return window.RecommendationMemory.getRecommendationStats();
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  6) TAKIM ÖĞRENMESİ — getTeamBestPractices(limit)
  //     PatternLearningEngine.getCachedSummary().bestPatterns zaten
  //     brick/ürün bazlı (temsilciye özel DEĞİL — §8 notu, kod
  //     incelemesiyle doğrulandı: IndexedDB index'leri sadece product/
  //     brick/recommendationType üzerinde). Bu yüzden "en başarılı
  //     davranışı öğren, diğerlerine öner" özelliği EK MOTOR GEREKTİRMEZ
  //     — sadece bestPatterns'ı insan-okur bir öneri formatına süzer.
  // ──────────────────────────────────────────────────────────────────
  function getTeamBestPractices(limit) {
    limit = limit || DEFAULT_TEAM_PRACTICES_LIMIT;
    var summary = _readPatternSummary(null);
    if (!summary || !summary.bestPatterns || !summary.bestPatterns.length) return [];

    return summary.bestPatterns.slice(0, limit).map(function (p) {
      var sampleSize = (p.outcomes && p.outcomes.sampleSize) || 0;
      var successRate = (p.outcomes && p.outcomes.successRate) || 0;
      return {
        brick: p.brick || null,
        product: p.product || null,
        recommendationType: p.recommendationType || null,
        successRate: successRate,
        sampleSize: sampleSize,
        // İnsan-okur, takıma yayılabilir öneri cümlesi (executive-engine.js
        // veya AI context'in doğrudan kullanabileceği formatta)
        practiceNote: (p.product ? p.product + ' için ' : '') +
          (p.brick ? p.brick + ' brick\'inde ' : '') +
          (p.recommendationType || 'bu aksiyon') + ' — %' + successRate +
          ' başarı (' + sampleSize + ' örnek)'
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  7) ANA API — getLearningContext(tttFilter)
  // ──────────────────────────────────────────────────────────────────
  function getLearningContext(tttFilter) {
    var patternSummary  = _readPatternSummary(null);
    var outcomeSummary  = _readOutcomeSummary();
    var predictionAcc   = _readPredictionAccuracy();
    var behaviorSignals = _readBehaviorSignals(tttFilter);
    var recStats        = _readRecommendationStats();

    return {
      bestPatterns:        patternSummary ? (patternSummary.bestPatterns || []) : [],
      successRate:         outcomeSummary ? (outcomeSummary.successRate != null ? outcomeSummary.successRate : null) : null,
      predictionAccuracy:  predictionAcc,
      recentOutcomes:      outcomeSummary ? (outcomeSummary.recentOutcomes || []) : [],
      behaviorSignals:     behaviorSignals,
      teamBestPractices:   getTeamBestPractices(),
      recommendationStats: recStats,
      sourcesAvailable: {
        pattern:   !!patternSummary,
        outcome:   !!outcomeSummary,
        prediction: !!predictionAcc,
        memory:    !!(window.AI_MEMORY && window.AI_MEMORY.behavior),
        recMemory: !!recStats
      }
    };
  }

  function clearCache() {
    // Bu dosya kendi cache'ini tutmuyor (her çağrıda taze okur) — bu
    // fonksiyon API simetrisi/ileri uyumluluk için tutulur, şu an no-op.
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.LearningHub = {
    getLearningContext: getLearningContext,
    getTeamBestPractices: getTeamBestPractices,
    clearCache: clearCache,
    version: HUB_VERSION
  };

  console.debug('[learning-hub] yüklendi. Versiyon:', HUB_VERSION);

})();
