// ══════════════════════════════════════════════════════════════════════
//  js/ai/learning/learning-engine.js
//  FAZ 1.4 — Learning Engine (Öğrenme Motoru / Pattern Learning)
//
//  Sorumluluk:
//    Outcome Tracker'ın ürettiği sonuçlardan (success/partial/fail)
//    PATTERN'lar (örüntüler) öğrenmek — "Panocer + yükselen trend +
//    düşük risk → %84 başarı" gibi genellenebilir bilgiler üretmek.
//
//  Akış:
//    IMS → Analiz → Öneri → Outcome → Pattern Oluşturma → Öğrenme →
//    Daha Akıllı Öneri (BU DOSYA, "Pattern Oluşturma + Öğrenme" katmanı)
//
//  ⚠️ İSİMLENDİRME UYARISI (şeffaflık için — bkz. FAZ1.4 raporu §2):
//    Projede ZATEN `js/ai/learning-engine.js` (Phase 5.4) adlı, TAMAMEN
//    FARKLI bir motor var — o, pharmacy-forecast TAHMİN doğruluğunu
//    (MAPE/MAE/RMSE) takip eder ve `window.LearningEngine` global'ini
//    kullanır. Bu dosya ONUNLA AYNI İSMİ TAŞIDIĞI İÇİN (her ikisi de
//    "learning-engine.js") `window.LearningEngine` global'ini KULLANMAZ
//    — çakışmayı önlemek için `window.PatternLearningEngine` kullanılır.
//    İki dosya da bağımsız çalışır, biri diğerine dokunmaz.
//
//  Public API:
//    updateLearningPatterns(outcome)        → Promise<pattern>  (ana fonksiyon)
//    createPattern(outcome, conditions)     → pattern (senkron, saf)
//    updatePattern(existingPattern, outcome)→ pattern (senkron, saf)
//    findMatchingPatterns(criteria)         → Promise<pattern[]> (kısmi eşleşme)
//    getPatterns()                          → Promise<pattern[]>
//    getPatternsByProduct(product)          → Promise<pattern[]>
//    getPatternsByBrick(brick)              → Promise<pattern[]>
//    getBestPatterns(limit, minSampleSize)  → Promise<pattern[]>
//    deletePattern(id)                      → Promise<boolean>
//    getPatternInsight(product, recType, conditions) → Promise<string|null>
//                                              (ileride recommendation-engine
//                                              için hazır — bkz. §FAZ 1.5)
//    getCachedSummary(product?)             → senkron { bestPatterns,
//                                              relevantPatterns,
//                                              historicalSuccessRates,
//                                              historicalFailures,
//                                              learningConfidence }
//                                              (ai-context-builder.js bunu kullanır)
//    formatPatternSummary(pattern)          → { successRatePct, sampleSize,
//                                              confidenceLabel, lastUpdated }
//                                              (ileride UI için hazır)
//
//  Depolama: IndexedDB → DB: pharma_ai_learning_db, store: learning_patterns
//  (outcome-tracker.js'in DB'sinden BİLEREK AYRI tutuldu — bkz. rapor §3.2)
//  IndexedDB yoksa bellek-içi fallback diziye otomatik düşer.
//
//  Otomatik tetikleme: js/ai/outcomes/outcome-tracker.js → saveOutcome()
//  başarılı her kayıttan sonra updateLearningPatterns()'ı guarded olarak
//  çağırır (bkz. outcome-tracker.js'teki FAZ 1.4 entegrasyon notu).
//
//  Bağımlılık (opsiyonel, typeof ile kontrol edilir):
//    js/ai/recommendation-memory.js (window.RecommendationMemory — contextSnapshot için)
//  Yükleme sırası: recommendation-memory.js SONRASI, outcome-tracker.js
//    SONRASI önerilir (zorunlu değil — fonksiyonlar çağrı anında aranır)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._PATTERN_LEARNING_ENGINE_LOADED) {
    console.warn('[learning-engine/pattern] Zaten yüklü — atlandı');
    return;
  }
  window._PATTERN_LEARNING_ENGINE_LOADED = true;

  var ENGINE_VERSION = '1.0';
  var DB_NAME    = 'pharma_ai_learning_db';
  var DB_VERSION = 1;
  var STORE_NAME = 'learning_patterns';
  var CONTEXT_BEST_PATTERNS_LIMIT    = 10;
  var CONTEXT_RELEVANT_PATTERNS_LIMIT = 5;
  var CONTEXT_FAILURES_LIMIT          = 5;
  var MIN_SAMPLE_SIZE_FOR_CONTEXT     = 2; // tek örnekli pattern'lar AI context'e gürültü katar

  // ── Bellek-içi fallback ──────────────────────────────────────────────
  var _memoryFallback = [];
  var _usingFallback  = false;

  // ── ai-context-builder.js için senkron cache ────────────────────────
  var _contextCache = {
    bestPatterns:           [],
    byProduct:              {},   // { 'PANOCER': pattern[], ... } — relevantPatterns kaynağı
    historicalSuccessRates: {},   // { 'PANOCER': 84.0, ... } — ürün bazlı ağırlıklı ortalama
    historicalFailures:     [],
    learningConfidence:     null, // tüm pattern'ların ortalama effectiveConfidence'ı
    computedAt:             null
  };

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) INDEXEDDB KATMANI
  // ──────────────────────────────────────────────────────────────────

  var _dbPromise = null;

  function _openDB() {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB bu tarayıcıda desteklenmiyor'));
        return;
      }
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            var store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('product',             'product',             { unique: false });
            store.createIndex('brick',                'brick',                { unique: false });
            store.createIndex('recommendationType',   'recommendationType',  { unique: false });
          }
        };

        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror   = function (e) {
          reject((e.target && e.target.error) || new Error('IndexedDB açma hatası'));
        };
      } catch (e) {
        reject(e);
      }
    }).catch(function (e) {
      console.warn('[learning-engine/pattern] IndexedDB açılamadı, bellek-içi fallback kullanılacak:', e.message);
      _usingFallback = true;
      return null;
    });

    return _dbPromise;
  }

  function _withStore(mode, fn) {
    return _openDB().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        try {
          var tx    = db.transaction(STORE_NAME, mode);
          var store = tx.objectStore(STORE_NAME);
          var result = fn(store);
          tx.oncomplete = function () { resolve(result); };
          tx.onerror    = function (e) { reject((e.target && e.target.error) || new Error('TX hata')); };
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function _getPatternById(id) {
    if (_usingFallback) {
      return Promise.resolve(_memoryFallback.find(function (p) { return p.id === id; }) || null);
    }
    return _withStore('readonly', function (store) {
      if (!store) return _memoryFallback.find(function (p) { return p.id === id; }) || null;
      return new Promise(function (resolve, reject) {
        var req = store.get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror   = function (e) { reject((e.target && e.target.error) || new Error('get hata')); };
      });
    }).catch(function (e) {
      console.warn('[learning-engine/pattern] _getPatternById hata, fallback:', e.message);
      return _memoryFallback.find(function (p) { return p.id === id; }) || null;
    });
  }

  function _putPattern(pattern) {
    if (_usingFallback) {
      var idx = _memoryFallback.findIndex(function (p) { return p.id === pattern.id; });
      if (idx !== -1) _memoryFallback[idx] = pattern; else _memoryFallback.push(pattern);
      return Promise.resolve(pattern);
    }
    return _withStore('readwrite', function (store) {
      if (!store) {
        var i2 = _memoryFallback.findIndex(function (p) { return p.id === pattern.id; });
        if (i2 !== -1) _memoryFallback[i2] = pattern; else _memoryFallback.push(pattern);
        return pattern;
      }
      store.put(pattern); // aynı id varsa ÜZERİNE YAZAR — duplicate oluşmaz (deterministik id)
      return pattern;
    }).catch(function (e) {
      console.warn('[learning-engine/pattern] _putPattern hata, fallback:', e.message);
      _usingFallback = true;
      var i3 = _memoryFallback.findIndex(function (p) { return p.id === pattern.id; });
      if (i3 !== -1) _memoryFallback[i3] = pattern; else _memoryFallback.push(pattern);
      return pattern;
    });
  }

  function getPatterns() {
    if (_usingFallback) return Promise.resolve(_memoryFallback.slice());
    return _withStore('readonly', function (store) {
      if (!store) return _memoryFallback.slice();
      return new Promise(function (resolve, reject) {
        var req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror   = function (e) { reject((e.target && e.target.error) || new Error('getAll hata')); };
      });
    }).then(function (r) { return Array.isArray(r) ? r : (r || []); })
      .catch(function (e) {
        console.warn('[learning-engine/pattern] getPatterns hata, fallback:', e.message);
        return _memoryFallback.slice();
      });
  }

  function getPatternsByProduct(product) {
    if (!product) return Promise.resolve([]);
    return getPatterns().then(function (all) {
      return all.filter(function (p) { return (p.product || '').toUpperCase() === product.toUpperCase(); });
    });
  }

  function getPatternsByBrick(brick) {
    if (!brick) return Promise.resolve([]);
    return getPatterns().then(function (all) {
      return all.filter(function (p) { return p.brick === brick; });
    });
  }

  function deletePattern(id) {
    if (!id) return Promise.resolve(false);
    if (_usingFallback) {
      var before = _memoryFallback.length;
      _memoryFallback = _memoryFallback.filter(function (p) { return p.id !== id; });
      return Promise.resolve(_memoryFallback.length < before);
    }
    return _withStore('readwrite', function (store) {
      if (!store) {
        var before2 = _memoryFallback.length;
        _memoryFallback = _memoryFallback.filter(function (p) { return p.id !== id; });
        return _memoryFallback.length < before2;
      }
      store.delete(id);
      return true;
    }).catch(function (e) {
      console.warn('[learning-engine/pattern] deletePattern hata:', e.message);
      return false;
    });
  }

  // ── findMatchingPatterns(criteria) — KISMİ eşleşme (AI'nın yeni bir
  //    öneri üretirken "bana benzer durumları getir" demesi için) ─────
  // @param {Object} criteria - { product?, recommendationType?, growthRange?,
  //        riskLevel?, trendDirection?, coverageLevel?, scheduleFit? }
  //        Sadece verilen alanlar filtrelenir; eksik alanlar göz ardı edilir.
  function findMatchingPatterns(criteria) {
    criteria = criteria || {};
    return getPatterns().then(function (all) {
      return all.filter(function (p) {
        if (criteria.product && (p.product || '').toUpperCase() !== String(criteria.product).toUpperCase()) return false;
        if (criteria.recommendationType && p.recommendationType !== criteria.recommendationType) return false;
        var c = p.conditions || {};
        if (criteria.growthRange     && c.growthRange     !== criteria.growthRange)     return false;
        if (criteria.riskLevel       && c.riskLevel        !== criteria.riskLevel)        return false;
        if (criteria.trendDirection  && c.trendDirection   !== criteria.trendDirection)   return false;
        if (criteria.coverageLevel   && c.coverageLevel     !== criteria.coverageLevel)     return false;
        if (criteria.scheduleFit     && c.scheduleFit       !== criteria.scheduleFit)       return false;
        return true;
      });
    });
  }

  // ── getBestPatterns(limit, minSampleSize) ───────────────────────────
  function getBestPatterns(limit, minSampleSize) {
    limit = limit || CONTEXT_BEST_PATTERNS_LIMIT;
    minSampleSize = (typeof minSampleSize === 'number') ? minSampleSize : MIN_SAMPLE_SIZE_FOR_CONTEXT;
    return getPatterns().then(function (all) {
      return all
        .filter(function (p) { return p.outcomes && p.outcomes.sampleSize >= minSampleSize; })
        .map(function (p) { return Object.assign({}, p, { _effectiveConfidence: _effectiveConfidence(p) }); })
        .sort(function (a, b) {
          var scoreA = (a.outcomes.successRate || 0) * a._effectiveConfidence;
          var scoreB = (b.outcomes.successRate || 0) * b._effectiveConfidence;
          return scoreB - scoreA;
        })
        .slice(0, limit);
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) CONDITION ÇIKARIMI (outcome + recommendation.contextSnapshot'tan)
  // ──────────────────────────────────────────────────────────────────

  function _growthRangeBucket(g) {
    if (typeof g !== 'number' || isNaN(g)) return 'unknown';
    if (g < 0)  return '<0';
    if (g < 5)  return '0-5';
    if (g < 10) return '5-10';
    if (g < 20) return '10-20';
    return '20+';
  }

  function _trendDirectionFromGrowth(g) {
    if (typeof g !== 'number' || isNaN(g)) return 'stable';
    if (g > 5)  return 'up';
    if (g < -5) return 'down';
    return 'stable';
  }

  // Not: contextSnapshot.riskLevel mevcut sistemde 'DÜŞÜK'|'ORTA'|'YÜKSEK'
  // (3 seviye, "critical" yok). Burada tlPct üzerinden 4 seviyeli (low/
  // medium/high/critical) bir sınıflandırma YENİDEN üretiliyor — Master
  // Prompt'un istediği 4 seviyeyi gerçekten kullanabilmek için. tlPct
  // mevcut değilse Türkçe riskLevel string'i 3 seviyeye map edilir.
  function _riskLevelBucket(contextSnapshot) {
    var tlPct = contextSnapshot && typeof contextSnapshot.tlPct === 'number' ? contextSnapshot.tlPct : null;
    if (tlPct !== null) {
      if (tlPct >= 100) return 'low';
      if (tlPct >= 91)  return 'medium';
      if (tlPct >= 70)  return 'high';
      return 'critical';
    }
    var rl = contextSnapshot && contextSnapshot.riskLevel;
    if (rl === 'DÜŞÜK')  return 'low';
    if (rl === 'ORTA')   return 'medium';
    if (rl === 'YÜKSEK') return 'high';
    return 'medium'; // güvenli varsayılan
  }

  function _remainingDaysRangeBucket(d) {
    if (typeof d !== 'number' || isNaN(d)) return 'unknown';
    if (d <= 3)  return '0-3';
    if (d <= 7)  return '4-7';
    if (d <= 15) return '8-15';
    return '15+';
  }

  // PROXY NOTU: contextSnapshot şu an ayrı bir "coverage" (kapsam) metriği
  // taşımıyor (örn. pharmacy-intelligence.js'in visitPriorityScore'u
  // recommendation-memory kaydına henüz aktarılmıyor). En yakın mevcut
  // proxy tlPct'tir (hedef realizasyon %). Gerçek bir kapsam metriği
  // ileride contextSnapshot'a eklenirse bu fonksiyon onu kullanacak
  // şekilde güncellenmelidir (bkz. rapor §FAZ 1.5 önerileri).
  function _coverageLevelBucket(contextSnapshot) {
    var tlPct = contextSnapshot && typeof contextSnapshot.tlPct === 'number' ? contextSnapshot.tlPct : null;
    if (tlPct === null) return 'unknown';
    if (tlPct >= 100) return 'high';
    if (tlPct >= 70)  return 'medium';
    if (tlPct >= 40)  return 'low';
    return 'none';
  }

  // Mevcut sistemde TÜM öneriler autonomous-planning-engine.js'in
  // "BUGÜNÜN GÖREVİ" (bugünkü ziyaret planı) çıktısıdır — yani üretildiği
  // anda hep 'today' kapsamındadır. recommendation.recommendation veya
  // recommendation üzerinde açık bir scheduleFit alanı varsa o öncelikli
  // kullanılır (ileriye dönük uyumluluk).
  function _scheduleFitOf(recDetail, rec) {
    if (recDetail && recDetail.scheduleFit) return recDetail.scheduleFit;
    if (rec && rec.scheduleFit) return rec.scheduleFit;
    return 'today';
  }

  // ── _deriveConditions(outcome, recommendation) ──────────────────────
  // @param {Object} outcome - outcome-tracker.js çıktısı
  // @param {Object|null} recommendation - RecommendationMemory tam kaydı
  //        (contextSnapshot için gerekli; bulunamazsa güvenli varsayılanlar)
  function _deriveConditions(outcome, recommendation) {
    var ctxSnap = (recommendation && recommendation.contextSnapshot) || {};
    var recDetail = (recommendation && recommendation.recommendation) || {};

    return {
      growthRange:        _growthRangeBucket(outcome.baselineGrowth),
      riskLevel:           _riskLevelBucket(ctxSnap),
      remainingDaysRange:  _remainingDaysRangeBucket(ctxSnap.remainingDays),
      trendDirection:      _trendDirectionFromGrowth(outcome.baselineGrowth),
      coverageLevel:       _coverageLevelBucket(ctxSnap),
      scheduleFit:         _scheduleFitOf(recDetail, recommendation)
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) PATTERN ID / CONFIDENCE / AGE-WEIGHT
  // ──────────────────────────────────────────────────────────────────

  // Deterministik kompozit ID — AYNI koşullar her zaman AYNI id'yi üretir.
  // Bu, "Duplicate pattern oluşmasın" kuralını ARAMA YAPMADAN, depolama
  // katmanında (store.put aynı id'nin üzerine yazar) garanti eder.
  function _buildPatternId(product, recommendationType, conditions) {
    var parts = [
      (product || 'UNKNOWN').toUpperCase().trim().replace(/\s+/g, '-'),
      (recommendationType || 'UNKNOWN').toUpperCase().trim().replace(/\s+/g, '-'),
      conditions.growthRange, conditions.riskLevel, conditions.trendDirection,
      conditions.coverageLevel, conditions.scheduleFit
    ];
    return 'pat_' + parts.join('_');
  }

  // confidence: sampleSize<3 → düşük (0.1–0.3), 3–10 → orta (0.3–0.7),
  // >10 → yüksek (0.7–1.0). Sürekli (smooth) ama bantlar Master Prompt'un
  // verdiği eşiklerle (3 ve 10) tam örtüşür.
  function _computeConfidence(sampleSize) {
    var n = sampleSize || 0;
    var c;
    if (n < 3)       c = 0.1 + (n / 3) * 0.2;
    else if (n <= 10) c = 0.3 + ((n - 3) / 7) * 0.4;
    else              c = 0.7 + Math.min(1, (n - 10) / 20) * 0.3;
    return Math.round(Math.max(0.1, Math.min(1, c)) * 100) / 100;
  }

  // PATTERN ESKİMESİ — confidence'ı KALICI OLARAK DEĞİŞTİRMEZ (o, örnek
  // sayısına dayalı istatistiksel güvenilirliktir). Bunun yerine OKUMA
  // ANINDA confidence'a çarpılan bir "yaş ağırlığı" döner — pattern'ın
  // GÜNCEL kullanılabilirliğini düşürür ama geçmiş istatistiğini silmez.
  function _ageWeight(lastUpdatedIso) {
    if (!lastUpdatedIso) return 1;
    var ms = Date.now() - new Date(lastUpdatedIso).getTime();
    if (isNaN(ms) || ms < 0) return 1;
    var months = ms / (1000 * 60 * 60 * 24 * 30.44);
    if (months <= 3)  return 1.0;
    if (months <= 6)  return 0.75;
    if (months <= 12) return 0.5;
    return 0.25;
  }

  function _effectiveConfidence(pattern) {
    return Math.round((pattern.confidence || 0) * _ageWeight(pattern.lastUpdated) * 100) / 100;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) createPattern / updatePattern (SAF — DOM/async YOK)
  // ──────────────────────────────────────────────────────────────────

  // FAZ 11.2: manualFeedback varsa otomatik status'a tercih edilir (temsilci gözlemi öncelikli).
  var _MANUAL_TO_STATUS = {
    UYGULANDIM:           'success',
    SIPARIS_ALINDI:       'success',
    SIPARIS_ALINAMADI:    'fail',
    ZIYARET_GERCEKLESMEDI:'not_evaluable'
  };
  function _effectiveStatus(outcome) {
    if (outcome.manualFeedback && outcome.manualFeedback.type) {
      return _MANUAL_TO_STATUS[outcome.manualFeedback.type] || outcome.status;
    }
    return outcome.status;
  }

  // ── createPattern(outcome, conditions) ──────────────────────────────
  function createPattern(outcome, conditions) {
    var now = new Date().toISOString();
    var eff       = _effectiveStatus(outcome);
    var isSuccess = eff === 'success';
    var isPartial = eff === 'partial';
    var isFail    = eff === 'fail';

    var sampleSize    = 1;
    var successCount  = isSuccess ? 1 : 0;
    var partialCount  = isPartial ? 1 : 0;
    var failCount     = isFail    ? 1 : 0;
    var successRate   = Math.round(((successCount + partialCount * 0.5) / sampleSize) * 1000) / 10;

    return {
      id:                  _buildPatternId(outcome.product, outcome.recommendationType, conditions),
      product:             outcome.product,
      brick:               outcome.brick,    // bilgilendirme amaçlı — eşleştirmede KULLANILMAZ
      pharmacy:            outcome.pharmacy,  // bilgilendirme amaçlı — eşleştirmede KULLANILMAZ
      recommendationType:  outcome.recommendationType,
      conditions:          conditions,
      outcomes: {
        sampleSize:         sampleSize,
        successCount:       successCount,
        partialCount:        partialCount,
        failCount:           failCount,
        successRate:         successRate,
        averageDeltaTL:      outcome.deltaTL     || 0,
        averageDeltaGrowth:  outcome.deltaGrowth || 0
      },
      confidence:  _computeConfidence(sampleSize),
      lastUpdated: now,
      createdAt:   now,
      metadata: {
        engineVersion: ENGINE_VERSION,
        updatedBy:     'system',
        updatedAt:     now
      }
    };
  }

  // ── updatePattern(existingPattern, outcome) ─────────────────────────
  // Incremental güncelleme — TÜM geçmiş outcome'ları yeniden okumaz,
  // sadece mevcut sayaçları + ortalamaları O(1) günceller.
  function updatePattern(existingPattern, outcome) {
    var now = new Date().toISOString();
    var o   = existingPattern.outcomes;

    var eff       = _effectiveStatus(outcome);
    var isSuccess = eff === 'success';
    var isPartial = eff === 'partial';
    var isFail    = eff === 'fail';

    var newSampleSize   = o.sampleSize + 1;
    var newSuccessCount = o.successCount + (isSuccess ? 1 : 0);
    var newPartialCount = o.partialCount + (isPartial ? 1 : 0);
    var newFailCount    = o.failCount    + (isFail    ? 1 : 0);
    var newSuccessRate  = Math.round(((newSuccessCount + newPartialCount * 0.5) / newSampleSize) * 1000) / 10;

    // İncremental ortalama: yeni_ortalama = (eski_ortalama × eski_n + yeni_değer) / yeni_n
    var newAvgDeltaTL     = ((o.averageDeltaTL     * o.sampleSize) + (outcome.deltaTL     || 0)) / newSampleSize;
    var newAvgDeltaGrowth = ((o.averageDeltaGrowth * o.sampleSize) + (outcome.deltaGrowth || 0)) / newSampleSize;

    return Object.assign({}, existingPattern, {
      brick:    outcome.brick    || existingPattern.brick,   // son örneğe göre güncellenir (bilgi amaçlı)
      pharmacy: outcome.pharmacy || existingPattern.pharmacy,
      outcomes: {
        sampleSize:         newSampleSize,
        successCount:       newSuccessCount,
        partialCount:        newPartialCount,
        failCount:           newFailCount,
        successRate:         newSuccessRate,
        averageDeltaTL:      Math.round(newAvgDeltaTL * 100) / 100,
        averageDeltaGrowth:  Math.round(newAvgDeltaGrowth * 10) / 10
      },
      confidence:  _computeConfidence(newSampleSize),
      lastUpdated: now,
      metadata: {
        engineVersion: ENGINE_VERSION,
        updatedBy:     'system',
        updatedAt:     now
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  5) ANA FONKSİYON — updateLearningPatterns(outcome)
  // ──────────────────────────────────────────────────────────────────

  // @param {Object} outcome - outcome-tracker.js'in evaluateRecommendationOutcome()
  //        çıktısı (status, product, brick, pharmacy, recommendationType,
  //        baselineGrowth, deltaTL, deltaGrowth, recommendationId vb. içerir)
  // @returns {Promise<Object|null>} güncellenen/oluşturulan pattern, veya
  //        öğrenme sinyali yoksa (not_evaluable) null
  function updateLearningPatterns(outcome) {
    try {
      if (!outcome || !outcome.product) {
        console.warn('[learning-engine/pattern] updateLearningPatterns: geçersiz outcome');
        return Promise.resolve(null);
      }

      // not_evaluable sonuçlar öğrenme sinyali taşımaz — pattern'ı
      // güncellemiyoruz (sampleSize'ı anlamsız şekilde şişirmemek için).
      // FAZ 11.2: manualFeedback varsa ve not_evaluable'a map ediyorsa da atla.
      if (_effectiveStatus(outcome) === 'not_evaluable') {
        return Promise.resolve(null);
      }

      var recommendationPromise = (window.RecommendationMemory &&
        typeof window.RecommendationMemory.getRecommendationById === 'function' &&
        outcome.recommendationId)
        ? Promise.resolve(window.RecommendationMemory.getRecommendationById(outcome.recommendationId))
        : Promise.resolve(null);

      return recommendationPromise.then(function (recommendation) {
        var conditions = _deriveConditions(outcome, recommendation);
        var id = _buildPatternId(outcome.product, outcome.recommendationType, conditions);

        return _getPatternById(id).then(function (existing) {
          var pattern = existing ? updatePattern(existing, outcome) : createPattern(outcome, conditions);
          return _putPattern(pattern);
        });
      }).then(function (pattern) {
        return refreshContextCache().then(function () {
          console.debug('[learning-engine/pattern] updateLearningPatterns tamamlandı:',
            pattern.id, '| sampleSize:', pattern.outcomes.sampleSize,
            '| successRate:', pattern.outcomes.successRate);
          return pattern;
        });
      }).catch(function (e) {
        console.warn('[learning-engine/pattern] updateLearningPatterns hata:', e.message);
        return null;
      });

    } catch (e) {
      console.warn('[learning-engine/pattern] updateLearningPatterns hata (senkron):', e.message);
      return Promise.resolve(null);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  6) AI CONTEXT ENTEGRASYONU — senkron cache
  // ──────────────────────────────────────────────────────────────────

  function refreshContextCache() {
    return getPatterns().then(function (all) {
      var withEff = all.map(function (p) {
        return Object.assign({}, p, { _effectiveConfidence: _effectiveConfidence(p) });
      });

      var meaningful = withEff.filter(function (p) { return p.outcomes.sampleSize >= MIN_SAMPLE_SIZE_FOR_CONTEXT; });

      var bestPatterns = meaningful.slice().sort(function (a, b) {
        return (b.outcomes.successRate * b._effectiveConfidence) - (a.outcomes.successRate * a._effectiveConfidence);
      }).slice(0, CONTEXT_BEST_PATTERNS_LIMIT);

      var byProduct = {};
      meaningful.forEach(function (p) {
        var key = (p.product || '').toUpperCase();
        if (!byProduct[key]) byProduct[key] = [];
        byProduct[key].push(p);
      });
      Object.keys(byProduct).forEach(function (key) {
        byProduct[key] = byProduct[key].sort(function (a, b) {
          return (b.outcomes.successRate * b._effectiveConfidence) - (a.outcomes.successRate * a._effectiveConfidence);
        }).slice(0, CONTEXT_RELEVANT_PATTERNS_LIMIT);
      });

      // Ürün bazlı tarihsel başarı oranı — örnek sayısı ağırlıklı ortalama
      var historicalSuccessRates = {};
      Object.keys(byProduct).forEach(function (key) {
        var patterns = meaningful.filter(function (p) { return (p.product || '').toUpperCase() === key; });
        var totalN  = patterns.reduce(function (a, p) { return a + p.outcomes.sampleSize; }, 0);
        var weighted = patterns.reduce(function (a, p) { return a + (p.outcomes.successRate * p.outcomes.sampleSize); }, 0);
        historicalSuccessRates[key] = totalN ? Math.round((weighted / totalN) * 10) / 10 : null;
      });

      var historicalFailures = meaningful
        .filter(function (p) { return p.outcomes.successRate < 40; })
        .sort(function (a, b) { return new Date(b.lastUpdated) - new Date(a.lastUpdated); })
        .slice(0, CONTEXT_FAILURES_LIMIT);

      var learningConfidence = meaningful.length
        ? Math.round((meaningful.reduce(function (a, p) { return a + p._effectiveConfidence; }, 0) / meaningful.length) * 100) / 100
        : null;

      _contextCache = {
        bestPatterns:           bestPatterns,
        byProduct:              byProduct,
        historicalSuccessRates: historicalSuccessRates,
        historicalFailures:     historicalFailures,
        learningConfidence:     learningConfidence,
        computedAt:             new Date().toISOString()
      };

      return _contextCache;
    }).catch(function (e) {
      console.warn('[learning-engine/pattern] refreshContextCache hata:', e.message);
      return _contextCache;
    });
  }

  // ── getCachedSummary(product?) — SENKRON, ai-context-builder.js çağırır
  function getCachedSummary(product) {
    var key = product ? String(product).toUpperCase() : null;
    return {
      bestPatterns:           _contextCache.bestPatterns,
      relevantPatterns:       key ? (_contextCache.byProduct[key] || []) : _contextCache.bestPatterns,
      historicalSuccessRates: _contextCache.historicalSuccessRates,
      historicalFailures:     _contextCache.historicalFailures,
      learningConfidence:     _contextCache.learningConfidence
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  7) AI KULLANIMI — recommendation-engine için hazır yardımcı
  //     (ŞU AN HİÇBİR YERDEN ÇAĞRILMIYOR — bkz. rapor §FAZ 1.5)
  // ──────────────────────────────────────────────────────────────────

  // ── getPatternInsight(product, recommendationType, conditions) ──────
  // Bir öneri ÜRETİLİRKEN, benzer geçmiş koşullara bakıp insan-okur metin
  // döndürür. Örnek: "Benzer koşullarda başarı oranı %78 (12 örnek)."
  // Yeterli örnek yoksa veya pattern bulunamazsa null döner (AI bu durumda
  // hiçbir şey eklemez — yanıltıcı düşük-güven mesajı üretmez).
  function getPatternInsight(product, recommendationType, conditions) {
    var criteria = Object.assign({ product: product, recommendationType: recommendationType }, conditions || {});
    return findMatchingPatterns(criteria).then(function (matches) {
      var best = matches.filter(function (p) { return p.outcomes.sampleSize >= MIN_SAMPLE_SIZE_FOR_CONTEXT; })
        .sort(function (a, b) { return b.outcomes.sampleSize - a.outcomes.sampleSize; })[0];
      if (!best) return null;

      var rate = best.outcomes.successRate;
      var n    = best.outcomes.sampleSize;
      if (rate >= 60) {
        return 'Benzer koşullarda başarı oranı %' + rate + ' (' + n + ' örnek).';
      }
      return 'Bu öneri benzer koşullarda geçmişte düşük başarı göstermiştir (%' + rate + ', ' + n + ' örnek).';
    }).catch(function (e) {
      console.warn('[learning-engine/pattern] getPatternInsight hata:', e.message);
      return null;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  8) UI YARDIMCISI (ileride kullanım için hazır — UI değişmedi)
  // ──────────────────────────────────────────────────────────────────

  function formatPatternSummary(pattern) {
    if (!pattern) return null;
    var confLabel = pattern.outcomes.sampleSize < 3 ? 'Düşük'
                  : pattern.outcomes.sampleSize <= 10 ? 'Orta' : 'Yüksek';
    return {
      successRatePct:  pattern.outcomes.successRate,
      sampleSize:       pattern.outcomes.sampleSize,
      confidenceLabel:  confLabel,
      lastUpdated:      pattern.lastUpdated
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Başlangıç — best-effort cache doldurma
  // ──────────────────────────────────────────────────────────────────
  refreshContextCache();

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.PatternLearningEngine = {
    updateLearningPatterns: updateLearningPatterns,
    createPattern:           createPattern,
    updatePattern:            updatePattern,
    findMatchingPatterns:     findMatchingPatterns,
    getPatterns:              getPatterns,
    getPatternsByProduct:      getPatternsByProduct,
    getPatternsByBrick:         getPatternsByBrick,
    getBestPatterns:             getBestPatterns,
    deletePattern:                deletePattern,
    getPatternInsight:             getPatternInsight,
    refreshContextCache:            refreshContextCache,
    getCachedSummary:                 getCachedSummary,
    formatPatternSummary:              formatPatternSummary,
    version: ENGINE_VERSION
  };

  console.debug('[learning-engine/pattern] FAZ 1.4 yüklendi (window.PatternLearningEngine).');

})();
