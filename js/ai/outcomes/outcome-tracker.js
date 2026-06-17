// ══════════════════════════════════════════════════════════════════════
//  js/ai/outcomes/outcome-tracker.js
//  FAZ 1.3 — Outcome Tracker (Öneri Sonuç Takip Motoru)
//
//  Sorumluluk:
//    AI tarafından verilen önerilerin (Recommendation Memory) sonraki
//    IMS verileriyle başarılı olup olmadığını otomatik değerlendirmek.
//    Learning Engine'in (js/ai/learning-engine.js) temel veri kaynağı.
//
//  Akış:
//    IMS → Analiz → Öneri → Yeni IMS → Sonuç Değerlendirmesi (BU DOSYA)
//
//  Public API:
//    evaluateRecommendationOutcome(recommendation, previousIMS, currentIMS)
//                                          → outcome (senkron, saf fonksiyon)
//    evaluateOpenRecommendations(currentIMSOverride)
//                                          → Promise<{evaluated, skipped, totalOpen}>
//    saveOutcome(outcome)                 → Promise<outcome|null>
//    getOutcomes()                        → Promise<outcome[]>
//    getOutcomeByRecommendationId(id)     → Promise<outcome|null>
//    getOutcomesByProduct(product)        → Promise<outcome[]>
//    getOutcomesByBrick(brick)            → Promise<outcome[]>
//    getOutcomesByStatus(status)          → Promise<outcome[]>
//    deleteOutcome(id)                    → Promise<boolean>
//    getCachedSummary()                   → senkron { recentOutcomes, successRate,
//                                            lastSuccessfulActions, lastFailedActions }
//                                            (ai-context-builder.js bunu kullanır)
//    formatOutcomeStatusIcon(status)      → '✓'|'≈'|'✕'|'?' (ileride UI için hazır)
//
//  Depolama: IndexedDB → DB: pharma_ai_outcomes_db, store: recommendation_outcomes
//  IndexedDB yoksa (örn. gizli sekme bazı tarayıcılarda) bellek-içi fallback
//  diziye otomatik düşer — sayfa kapanınca kaybolur ama UYGULAMA ÇÖKMEZ.
//
//  ÖNEMLİ VERİ NOTU (şeffaflık için):
//    IMS_TABLO.csv satırlarında (parseIMSCSV çıktısı) gerçek bir "TL" alanı
//    YOK — sadece kutu hacmi vardır (`toplam`, `h1..h9`). Bu modülde
//    "baselineTL" / "evaluationTL" alan adları Master Prompt'un istediği
//    şemayla uyumlu tutulmuştur, ancak IMS-bazlı (brick/ttt seviyeli)
//    karşılaştırmalarda gerçek değer kutu hacminden (toplam alanı) gelir.
//    Eczane (ECZANE_RAW) verisi `tutar` alanıyla GERÇEK TL içerir — bu
//    modül satır şekline bakıp otomatik olarak doğru alanı seçer
//    (bkz. _aggregateValue). Her outcome kaydında bu kaynak `notes`
//    alanında açıkça belirtilir.
//
//  Bağımlılık (opsiyonel, typeof ile kontrol edilir):
//    js/ai/recommendation-memory.js (window.RecommendationMemory)
//    js/core/date-utils.js (PERIODS)
//    js/data/data-state.js (IMS)
//  Yükleme sırası: recommendation-memory.js SONRASI önerilir (zorunlu değil
//    — sadece fonksiyon çağrısı anında window.RecommendationMemory aranır)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._OUTCOME_TRACKER_LOADED) {
    console.warn('[outcome-tracker] Zaten yüklü — atlandı');
    return;
  }
  window._OUTCOME_TRACKER_LOADED = true;

  var ALGORITHM_VERSION = '1.0';
  var DB_NAME    = 'pharma_ai_outcomes_db';
  var DB_VERSION = 1;
  var STORE_NAME = 'recommendation_outcomes';
  var PREV_IMS_SNAPSHOT_KEY = 'pharma_outcome_tracker_prev_ims_v1';
  var OUTCOME_CONTEXT_MONTHS = 6; // ai-context entegrasyonu için pencere

  // ── Bellek-içi fallback — IndexedDB yoksa/açılamazsa kullanılır ───────
  var _memoryFallback = [];
  var _usingFallback  = false;

  // ── ai-context-builder.js için senkron cache (bkz. dosya başlığı) ─────
  var _contextCache = {
    recentOutcomes:        [],
    successRate:           null,
    lastSuccessfulActions: [],
    lastFailedActions:     [],
    computedAt:            null
  };

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
            store.createIndex('recommendationId', 'recommendationId', { unique: false });
            store.createIndex('representative',   'representative',   { unique: false });
            store.createIndex('product',           'product',          { unique: false });
            store.createIndex('brick',              'brick',            { unique: false });
            store.createIndex('status',             'status',           { unique: false });
            store.createIndex('evaluationDate',     'evaluationDate',   { unique: false });
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
      console.warn('[outcome-tracker] IndexedDB açılamadı, bellek-içi fallback kullanılacak:', e.message);
      _usingFallback = true;
      return null; // db = null → tüm CRUD fonksiyonları fallback'e düşer
    });

    return _dbPromise;
  }

  function _withStore(mode, fn) {
    return _openDB().then(function (db) {
      if (!db) return fn(null); // fallback modu
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

  // ── saveOutcome(outcome) → Promise<outcome|null> ────────────────────
  function saveOutcome(outcome) {
    if (!outcome || !outcome.id) return Promise.resolve(null);

    if (_usingFallback) {
      var idx = _memoryFallback.findIndex(function (o) { return o.id === outcome.id; });
      if (idx !== -1) _memoryFallback[idx] = outcome; else _memoryFallback.push(outcome);
      return Promise.resolve(outcome);
    }

    return _withStore('readwrite', function (store) {
      if (!store) {
        var i2 = _memoryFallback.findIndex(function (o) { return o.id === outcome.id; });
        if (i2 !== -1) _memoryFallback[i2] = outcome; else _memoryFallback.push(outcome);
        return outcome;
      }
      store.put(outcome);
      return outcome;
    }).catch(function (e) {
      console.warn('[outcome-tracker] saveOutcome hata, fallback kullanılıyor:', e.message);
      _usingFallback = true;
      _memoryFallback.push(outcome);
      return outcome;
    });
  }

  // ── getOutcomes() → Promise<outcome[]> (tümü) ────────────────────────
  function getOutcomes() {
    if (_usingFallback) return Promise.resolve(_memoryFallback.slice());

    return _withStore('readonly', function (store) {
      if (!store) return _memoryFallback.slice();
      return new Promise(function (resolve, reject) {
        var req = store.getAll ? store.getAll() : null;
        if (req) {
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror   = function (e) { reject((e.target && e.target.error) || new Error('getAll hata')); };
        } else {
          // getAll() bulunmayan eski tarayıcılar için cursor fallback
          var out = [];
          var cur = store.openCursor();
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (c) { out.push(c.value); c.continue(); } else { resolve(out); }
          };
          cur.onerror = function (e) { reject((e.target && e.target.error) || new Error('cursor hata')); };
        }
      });
    }).then(function (r) {
      // _withStore readonly bir tx.oncomplete sonrası `result`'ı resolve eder;
      // burada iç promise zaten resolve edilmiş diziyi taşıyor olabilir.
      return Array.isArray(r) ? r : (r || []);
    }).catch(function (e) {
      console.warn('[outcome-tracker] getOutcomes hata, fallback kullanılıyor:', e.message);
      return _memoryFallback.slice();
    });
  }

  function getOutcomeByRecommendationId(recommendationId) {
    if (!recommendationId) return Promise.resolve(null);
    return getOutcomes().then(function (all) {
      return all.find(function (o) { return o.recommendationId === recommendationId; }) || null;
    });
  }

  function getOutcomesByProduct(product) {
    if (!product) return Promise.resolve([]);
    return getOutcomes().then(function (all) {
      return all.filter(function (o) { return o.product === product; });
    });
  }

  function getOutcomesByBrick(brick) {
    if (!brick) return Promise.resolve([]);
    return getOutcomes().then(function (all) {
      return all.filter(function (o) { return o.brick === brick; });
    });
  }

  function getOutcomesByStatus(status) {
    if (!status) return Promise.resolve([]);
    return getOutcomes().then(function (all) {
      return all.filter(function (o) { return o.status === status; });
    });
  }

  function deleteOutcome(id) {
    if (!id) return Promise.resolve(false);

    if (_usingFallback) {
      var before = _memoryFallback.length;
      _memoryFallback = _memoryFallback.filter(function (o) { return o.id !== id; });
      return Promise.resolve(_memoryFallback.length < before);
    }

    return _withStore('readwrite', function (store) {
      if (!store) {
        var before2 = _memoryFallback.length;
        _memoryFallback = _memoryFallback.filter(function (o) { return o.id !== id; });
        return _memoryFallback.length < before2;
      }
      store.delete(id);
      return true;
    }).catch(function (e) {
      console.warn('[outcome-tracker] deleteOutcome hata:', e.message);
      return false;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) EŞLEŞTİRME + AGREGASYON YARDIMCILARI
  //     (IMS-stili: ttt/brick/ilac/toplam/h1..h9 — gerçek parseIMSCSV şeması)
  //     (Eczane-stili: ttt/brick/urun/ad veya eczane/tutar/adet/ay — gerçek
  //      pharmacy-data-manager.js şeması)
  // ──────────────────────────────────────────────────────────────────

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  function _extractRecFields(recommendation) {
    var r = recommendation || {};
    var detail = r.recommendation || {};
    return {
      recommendationId: r.id || null,
      recommendationDate: r.createdAt || null,
      representative: r.representative || detail.representative || null,
      product:        (detail.product   !== undefined) ? detail.product   : (r.product   || null),
      brick:          (detail.brick     !== undefined) ? detail.brick     : (r.brick     || null),
      pharmacy:       (detail.pharmacy  !== undefined) ? detail.pharmacy  : (r.pharmacy !== undefined ? r.pharmacy : null),
      recommendationType: detail.action || r.recommendationType || r.action || null
    };
  }

  // ── _filterRows — ttt + brick + product (kendi ürün satırı) eşleşmesi ──
  function _filterRows(rows, fields) {
    if (!Array.isArray(rows) || !rows.length) return [];
    return rows.filter(function (r) {
      if (fields.representative && r.ttt !== fields.representative) return false;
      if (fields.brick && r.brick !== fields.brick) return false;

      if (fields.product) {
        if (r.ilac !== undefined) {
          // IMS-stili: pazar toplam satırını ELE — sadece kendi ürün satırı
          if (r.is_mkt) return false;
          if ((r.ilac || '').toUpperCase().trim() !== fields.product.toUpperCase().trim()) return false;
        } else if (r.urun !== undefined) {
          // Eczane-stili
          if ((r.urun || '').toUpperCase().trim() !== fields.product.toUpperCase().trim()) return false;
        }
      }

      if (fields.pharmacy) {
        var ph = r.ad || r.eczane;
        if (ph !== undefined && ph !== fields.pharmacy) return false;
        // ph === undefined (IMS-stili satır, eczane bilgisi yok) → filtrelemeden geç,
        // confidence hesabı bu durumu zaten cezalandırır (bkz. _computeConfidence).
      }

      return true;
    });
  }

  // ── _aggregateValue — satır kümesinden "değer" (TL veya proxy) çıkarır ─
  function _aggregateValue(rows) {
    if (!rows.length) return { value: 0, source: 'none', count: 0 };

    if (rows[0].tutar !== undefined) {
      var sumTL = rows.reduce(function (a, r) { return a + (parseFloat(r.tutar) || 0); }, 0);
      return { value: Math.round(sumTL * 100) / 100, source: 'tutar_tl', count: rows.length };
    }
    if (rows[0].toplam !== undefined) {
      var sumKutu = rows.reduce(function (a, r) { return a + (parseFloat(r.toplam) || 0); }, 0);
      return { value: Math.round(sumKutu * 100) / 100, source: 'toplam_kutu_proxy', count: rows.length };
    }
    return { value: 0, source: 'unknown', count: rows.length };
  }

  // ── _earlyLateGrowthPct — bir zaman serisinin ilk yarısı/son yarısı ────
  // arasındaki % değişim. (Genel amaçlı — hem hafta hem ay serisine uyar.)
  function _earlyLateGrowthPct(values) {
    var v = (values || []).filter(function (x) { return typeof x === 'number' && !isNaN(x); });
    if (v.length < 2) return 0;
    var mid   = Math.floor(v.length / 2);
    var early = v.slice(0, mid);
    var late  = v.slice(mid);
    var earlyAvg = early.reduce(function (a, b) { return a + b; }, 0) / (early.length || 1);
    var lateAvg  = late.reduce(function (a, b) { return a + b; }, 0) / (late.length || 1);
    if (earlyAvg === 0) return lateAvg > 0 ? 100 : 0;
    return Math.round(((lateAvg - earlyAvg) / earlyAvg) * 1000) / 10; // %0.1 hassasiyet
  }

  // ── _aggregateGrowthPct — satır kümesinin KENDİ İÇİNDEKİ zaman serisinden
  //    (IMS: h1..h9 hafta sütunları | Eczane: ay alanı) büyüme % hesaplar.
  function _aggregateGrowthPct(rows) {
    if (!rows.length) return 0;

    if (rows[0].h1 !== undefined) {
      var weekVals = [];
      for (var i = 1; i <= 9; i++) {
        var key = 'h' + i;
        weekVals.push(rows.reduce(function (a, r) { return a + (parseFloat(r[key]) || 0); }, 0));
      }
      return _earlyLateGrowthPct(weekVals);
    }

    if (rows[0].ay !== undefined) {
      var byAy = {};
      rows.forEach(function (r) {
        var k = r.ay || '?';
        byAy[k] = (byAy[k] || 0) + (parseFloat(r.tutar) || 0);
      });
      var ayKeys = Object.keys(byAy).sort();
      return _earlyLateGrowthPct(ayKeys.map(function (k) { return byAy[k]; }));
    }

    return 0;
  }

  // ── _computeConfidence — 0.1–1.0 aralığında normalize edilmiş güven ────
  function _computeConfidence(fields, prevAgg, currAgg) {
    var score = 1.0;
    if (!fields.brick)   score -= 0.15;
    if (!fields.product) score -= 0.15;
    if (prevAgg.count < 2) score -= 0.10;
    if (currAgg.count < 2) score -= 0.10;
    if (prevAgg.source !== currAgg.source) score -= 0.20; // farklı veri kaynağı karşılaştırması
    if (fields.pharmacy && prevAgg.source !== 'tutar_tl') score -= 0.20; // eczane hedefliydi, eczane verisi yoktu
    return Math.max(0.1, Math.min(1, Math.round(score * 100) / 100));
  }

  function _resolveCurrentPeriodKey() {
    return _safe(function () {
      var today   = new Date().toISOString().slice(0, 10);
      var periods = (typeof PERIODS !== 'undefined') ? PERIODS : [];
      var cur = periods.find(function (p) { return today >= p.start && today <= p.end; });
      return cur ? cur.key : null;
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) ANA DEĞERLENDİRME FONKSİYONU (saf — DOM/async YOK)
  // ──────────────────────────────────────────────────────────────────

  function _generateOutcomeId() {
    return 'out_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2, 6);
  }

  // ── evaluateRecommendationOutcome(recommendation, previousIMS, currentIMS) ─
  // @param {Object} recommendation - RecommendationMemory kayıt şekli
  //        ({ id, representative, createdAt, recommendation:{action,product,
  //        brick,pharmacy}, ... }) veya düz { representative, product, brick,
  //        pharmacy, recommendationType } şekli de kabul edilir.
  // @param {Array} previousIMS - karşılaştırma BAŞLANGICI veri seti
  //        (IMS-stili veya eczane-stili satır dizisi)
  // @param {Array} currentIMS  - karşılaştırma SONU (güncel) veri seti
  // @returns {Object} outcome kaydı (bkz. dosya başlığı şema)
  function evaluateRecommendationOutcome(recommendation, previousIMS, currentIMS) {
    var fields = _extractRecFields(recommendation);
    var now    = new Date().toISOString();

    var prevRows = _filterRows(previousIMS || [], fields);
    var currRows = _filterRows(currentIMS  || [], fields);

    var base = {
      id:                  _generateOutcomeId(),
      recommendationId:    fields.recommendationId,
      recommendationDate:  fields.recommendationDate,
      evaluationDate:      now,
      representative:      fields.representative,
      product:             fields.product,
      brick:               fields.brick,
      pharmacy:            fields.pharmacy,
      recommendationType:  fields.recommendationType,
      baselineIMSPeriod:   null,
      evaluationIMSPeriod: _resolveCurrentPeriodKey(),
      baselineTL:          null,
      evaluationTL:        null,
      baselineGrowth:      null,
      evaluationGrowth:    null,
      deltaTL:             null,
      deltaGrowth:         null,
      status:              'not_evaluable',
      confidence:          0,
      notes:               '',
      createdAt:           now,
      metadata: {
        evaluatedBy:      'system',
        algorithmVersion: ALGORITHM_VERSION,
        evaluatedAt:      now
      }
    };

    // ── NOT_EVALUABLE — ilgili veri hiçbir tarafta bulunamadı ───────────
    if (!prevRows.length || !currRows.length) {
      base.notes = !prevRows.length && !currRows.length
        ? 'Ne önceki ne de güncel veri setinde eşleşen satır bulundu.'
        : (!prevRows.length
            ? 'Önceki (baseline) veri setinde eşleşen satır bulunamadı.'
            : 'Güncel (evaluation) veri setinde eşleşen satır bulunamadı.');
      return base;
    }

    var prevAgg = _aggregateValue(prevRows);
    var currAgg = _aggregateValue(currRows);

    var baselineTL     = prevAgg.value;
    var evaluationTL    = currAgg.value;
    var baselineGrowth  = _aggregateGrowthPct(prevRows);
    var evaluationGrowth = _aggregateGrowthPct(currRows);

    var deltaTL     = Math.round((evaluationTL - baselineTL) * 100) / 100;
    var deltaGrowth = Math.round((evaluationGrowth - baselineGrowth) * 10) / 10;

    // ── DEĞERLENDİRME KURALLARI ──────────────────────────────────────
    // Sıra önemli: SUCCESS koşulu PARTIAL/FAIL'den önce kontrol edilir
    // (Master Prompt'taki kurallar arasında örtüşme var — örn. deltaTL>0
    // VE deltaGrowth<=0 aynı anda mümkün; bu durumda SUCCESS önceliklidir
    // çünkü ham TL/hacim artışı, büyüme yüzdesindeki gürültüden daha
    // güvenilir bir sinyaldir).
    var status;
    if (deltaTL > 0 || deltaGrowth >= 5) {
      status = 'success';
    } else if (deltaGrowth > 0 && deltaGrowth < 5) {
      status = 'partial';
    } else {
      status = 'fail';
    }

    var confidence = _computeConfidence(fields, prevAgg, currAgg);

    var sourceLabel = (currAgg.source === 'tutar_tl') ? 'eczane verisi (gerçek TL — tutar alanı)'
                     : (currAgg.source === 'toplam_kutu_proxy') ? 'IMS kutu hacmi (TL alanı mevcut değil — toplam alanı proxy olarak kullanıldı)'
                     : 'bilinmeyen kaynak';

    base.baselineTL          = baselineTL;
    base.evaluationTL        = evaluationTL;
    base.baselineGrowth      = baselineGrowth;
    base.evaluationGrowth    = evaluationGrowth;
    base.deltaTL             = deltaTL;
    base.deltaGrowth         = deltaGrowth;
    base.status              = status;
    base.confidence          = confidence;
    base.notes = 'Değer kaynağı: ' + sourceLabel + '. ' +
      'Eşleşen satır sayısı — baseline: ' + prevAgg.count + ', evaluation: ' + currAgg.count + '.';

    return base;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) ÖNCEKİ IMS SNAPSHOT YÖNETİMİ (localStorage — hafif, rolling)
  //
  //  Uygulama IMS dizisini her senkronizasyonda YERİNDE değiştiriyor
  //  (IMS.length=0; IMS.push(...)) — yani "önceki" veri kalıcı olarak
  //  saklanmıyor. Bu fonksiyonlar, bir önceki başarılı senkronizasyondaki
  //  IMS halini hafif bir localStorage anlık görüntüsü olarak saklar ki
  //  evaluateOpenRecommendations() her zaman gerçek bir "önce/sonra"
  //  karşılaştırması yapabilsin.
  // ──────────────────────────────────────────────────────────────────

  function _loadPreviousIMSSnapshot() {
    try {
      var raw = localStorage.getItem(PREV_IMS_SNAPSHOT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rows)) return null;
      return parsed;
    } catch (e) {
      console.warn('[outcome-tracker] _loadPreviousIMSSnapshot hata:', e.message);
      return null;
    }
  }

  function _saveCurrentAsSnapshot(rows, periodKey) {
    try {
      // Sadece gerekli alanları sakla (depolama boyutu için)
      var compact = (rows || []).map(function (r) {
        return {
          ttt: r.ttt, brick: r.brick, ilac: r.ilac, is_mkt: r.is_mkt,
          toplam: r.toplam,
          h1: r.h1, h2: r.h2, h3: r.h3, h4: r.h4, h5: r.h5,
          h6: r.h6, h7: r.h7, h8: r.h8, h9: r.h9
        };
      });
      localStorage.setItem(PREV_IMS_SNAPSHOT_KEY, JSON.stringify({
        period:     periodKey,
        capturedAt: new Date().toISOString(),
        rows:       compact
      }));
    } catch (e) {
      console.warn('[outcome-tracker] _saveCurrentAsSnapshot hata (sessiz):', e.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  5) OTOMATİK ÇALIŞMA — evaluateOpenRecommendations()
  // ──────────────────────────────────────────────────────────────────

  // ── _withinLastNMonths — ISO tarih son N ay içinde mi? ─────────────
  function _withinLastNMonths(iso, n) {
    if (!iso) return false;
    try {
      var d = new Date(iso);
      var cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - n);
      return d >= cutoff;
    } catch (e) { return false; }
  }

  // ── evaluateOpenRecommendations(currentIMSOverride) ─────────────────
  // Recommendation Memory'deki evaluated=false kayıtları tarar, her biri
  // için evaluateRecommendationOutcome() çalıştırır, sonucu IndexedDB'ye
  // kaydeder ve kaydı evaluated=true olarak işaretler.
  //
  // Performans: aynı (representative|brick|product|pharmacy) kombinasyonuna
  // sahip birden fazla açık öneri varsa hesaplama SADECE BİR KEZ yapılır
  // (memoizasyon) — "gereksiz tekrar değerlendirme yapmamalı" kuralı.
  //
  // @returns {Promise<{evaluated:number, skipped:number, totalOpen:number}>}
  function evaluateOpenRecommendations(currentIMSOverride) {
    try {
      if (!window.RecommendationMemory || typeof window.RecommendationMemory.getRecommendations !== 'function') {
        console.warn('[outcome-tracker] RecommendationMemory bulunamadı — atlanıyor.');
        return Promise.resolve({ evaluated: 0, skipped: 0, totalOpen: 0 });
      }

      var currentIMS = currentIMSOverride || (typeof IMS !== 'undefined' ? IMS : []);
      if (!currentIMS || !currentIMS.length) {
        console.warn('[outcome-tracker] Güncel IMS verisi yok — atlanıyor.');
        return Promise.resolve({ evaluated: 0, skipped: 0, totalOpen: 0 });
      }

      var prevSnap     = _loadPreviousIMSSnapshot();
      var previousIMS  = (prevSnap && prevSnap.rows) || [];

      var allRecs  = window.RecommendationMemory.getRecommendations() || [];
      var openRecs = allRecs.filter(function (r) { return !r.evaluated; });

      if (!openRecs.length) {
        _saveCurrentAsSnapshot(currentIMS, _resolveCurrentPeriodKey());
        return Promise.resolve({ evaluated: 0, skipped: 0, totalOpen: 0 });
      }

      // ── Memoizasyon: aynı kombinasyon için bir kez hesapla ────────────
      var memo = {};
      var savePromises = [];
      var evaluatedCount = 0;

      openRecs.forEach(function (rec) {
        var f = _extractRecFields(rec);
        var memoKey = [f.representative, f.brick, f.product, f.pharmacy].join('|');

        var outcome;
        if (memo.hasOwnProperty(memoKey)) {
          // Önceden hesaplanan sonucu bu öneriye özel alanlarla klonla
          var cached = memo[memoKey];
          outcome = Object.assign({}, cached, {
            id:                 _generateOutcomeId(),
            recommendationId:   f.recommendationId,
            recommendationDate: f.recommendationDate
          });
        } else {
          outcome = evaluateRecommendationOutcome(rec, previousIMS, currentIMS);
          memo[memoKey] = outcome;
        }

        // ── NOT_EVALUABLE özel durumu ────────────────────────────────
        // Henüz karşılaştırılabilir veri yoksa (örn. bu özelliğin
        // devreye alındığı İLK senkronizasyon — previousIMS snapshot'ı
        // henüz oluşmamış) öneriyi evaluated=false BIRAKIYORUZ ki bir
        // SONRAKİ senkronizasyonda gerçek veriyle yeniden denensin.
        // Aksi halde öneri kalıcı olarak "değerlendirilemedi" durumunda
        // SIKIŞIP KALIRDI. Ayrıca IndexedDB'ye gereksiz tekrar
        // not_evaluable kaydı yazılmaz (aynı kombinasyon her sync'te
        // tekrar denenecek, kayıt kirliliği oluşmaz).
        if (outcome.status === 'not_evaluable') {
          return; // bu rec için hiçbir şey yapma — bir sonraki sync'te tekrar denenecek
        }

        savePromises.push(
          saveOutcome(outcome).then(function () {
            if (typeof window.RecommendationMemory.markRecommendationEvaluated === 'function') {
              window.RecommendationMemory.markRecommendationEvaluated(rec.id, outcome.id);
            }
            evaluatedCount++;
          }).catch(function (e) {
            console.warn('[outcome-tracker] kayıt hatası, atlanıyor:', rec.id, e.message);
          })
        );
      });

      return Promise.all(savePromises).then(function () {
        _saveCurrentAsSnapshot(currentIMS, _resolveCurrentPeriodKey());
        return refreshContextCache().then(function () {
          var result = { evaluated: evaluatedCount, skipped: openRecs.length - evaluatedCount, totalOpen: openRecs.length };
          console.debug('[outcome-tracker] evaluateOpenRecommendations tamamlandı:', result);
          return result;
        });
      });

    } catch (e) {
      console.warn('[outcome-tracker] evaluateOpenRecommendations hata:', e.message);
      return Promise.resolve({ evaluated: 0, skipped: 0, totalOpen: 0, error: e.message });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  6) AI CONTEXT ENTEGRASYONU — senkron cache
  // ──────────────────────────────────────────────────────────────────

  function refreshContextCache() {
    return getOutcomes().then(function (all) {
      var recent = all.filter(function (o) { return _withinLastNMonths(o.evaluationDate, OUTCOME_CONTEXT_MONTHS); });

      var evaluable = recent.filter(function (o) { return o.status !== 'not_evaluable'; });
      var successN  = evaluable.filter(function (o) { return o.status === 'success'; }).length;
      var successRate = evaluable.length ? Math.round((successN / evaluable.length) * 1000) / 10 : null;

      var byDateDesc = recent.slice().sort(function (a, b) {
        return (b.evaluationDate || '').localeCompare(a.evaluationDate || '');
      });

      var lastSuccess = byDateDesc.filter(function (o) { return o.status === 'success'; }).slice(0, 5)
        .map(_toContextActionSummary);
      var lastFailed  = byDateDesc.filter(function (o) { return o.status === 'fail'; }).slice(0, 5)
        .map(_toContextActionSummary);

      _contextCache = {
        recentOutcomes:        byDateDesc.slice(0, 20).map(_toContextActionSummary),
        successRate:           successRate,
        lastSuccessfulActions: lastSuccess,
        lastFailedActions:     lastFailed,
        computedAt:            new Date().toISOString()
      };

      return _contextCache;
    }).catch(function (e) {
      console.warn('[outcome-tracker] refreshContextCache hata:', e.message);
      return _contextCache;
    });
  }

  function _toContextActionSummary(o) {
    return {
      recommendationType: o.recommendationType,
      product:             o.product,
      brick:               o.brick,
      pharmacy:            o.pharmacy,
      status:              o.status,
      deltaTL:             o.deltaTL,
      deltaGrowth:         o.deltaGrowth,
      evaluationDate:      o.evaluationDate
    };
  }

  // ── getCachedSummary() — SENKRON, ai-context-builder.js tarafından ──
  // çağrılır. Hiçbir async işlem yapmaz; en son refreshContextCache()
  // sonucunu döner (henüz hesaplanmadıysa boş şema döner — hata vermez).
  function getCachedSummary() {
    return _contextCache;
  }

  // ──────────────────────────────────────────────────────────────────
  //  7) UI YARDIMCISI (ileride kullanım için hazır — şu an hiçbir
  //     ekrana bağlanmadı, mevcut UI değişmedi)
  // ──────────────────────────────────────────────────────────────────

  function formatOutcomeStatusIcon(status) {
    var map = { success: '✓', partial: '≈', fail: '✕', not_evaluable: '?' };
    return map[status] || '?';
  }

  // ──────────────────────────────────────────────────────────────────
  //  Başlangıç — sayfa yüklenince mevcut IndexedDB kayıtlarından
  //  context cache'i en iyi çaba (best-effort) ile doldur.
  // ──────────────────────────────────────────────────────────────────
  refreshContextCache();

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.OutcomeTracker = {
    evaluateRecommendationOutcome: evaluateRecommendationOutcome,
    evaluateOpenRecommendations:   evaluateOpenRecommendations,
    saveOutcome:                   saveOutcome,
    getOutcomes:                   getOutcomes,
    getOutcomeByRecommendationId:  getOutcomeByRecommendationId,
    getOutcomesByProduct:          getOutcomesByProduct,
    getOutcomesByBrick:            getOutcomesByBrick,
    getOutcomesByStatus:           getOutcomesByStatus,
    deleteOutcome:                 deleteOutcome,
    refreshContextCache:           refreshContextCache,
    getCachedSummary:               getCachedSummary,
    formatOutcomeStatusIcon:        formatOutcomeStatusIcon
  };

  console.debug('[outcome-tracker] FAZ 1.3 yüklendi.');

})();
