// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/trend-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  AI MİMARİ STABİLİZASYONU GÜNCELLEMESİ — artık js/ai/core/ims-adapter.js
//  kullanır, parser'a (IMS) DOĞRUDAN ERİŞMEZ.
//
//  Sorumluluk: Haftalık/aylık/YTD trend analizi
//    • analyzeTrends(ttt) → { trend, confidence, summary, details }
//
//  ⚠️ ÖNEMLİ DÜZELTME NOTU (bkz. AI_MIMARI_STABILIZASYON_RAPORU.md):
//    Bu dosya ÖNCEDEN r.hafta / r.own_kutu / r.own_tl alanlarını okuyordu
//    — bu alanlar GERÇEK parseIMSCSV() çıktısında HİÇBİR ZAMAN var olmadı.
//    Sonuç: haftalık trend bloğu HER ZAMAN devre dışı kalıyordu (trend
//    HER ZAMAN 'FLAT', confidence HER ZAMAN 50 dönüyordu — gerçek satış
//    verisinden bağımsız olarak). Bu motor artık js/ai/core/ims-adapter.js
//    üzerinden GERÇEK h1..h9 haftalık hacim verisini kullanıyor ve trend
//    GERÇEKTEN değişkenlik gösteriyor. Bu kasıtlı bir DÜZELTMEdir —
//    "mevcut fonksiyonelliği bozma" ilkesi, zaten devre dışı olan bir
//    bloğu ÇALIŞIR HALE GETİRMEYİ kapsar (bozma değil, onarım).
//
//  Analiz: IMS haftalık hacim verisi (adapter üzerinden) — ivme, yavaşlama,
//  dönüş noktası. YTD trend GENEL.satis_tl üzerinden (değişmedi).
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js (GENEL)
//  Yükleme sırası: ims-adapter.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL */

(function() {
  'use strict';

  // ── _linearSlope — basit doğrusal eğim hesabı ─────────────
  // values: number[] — zaman serisi (eski→yeni)
  // @returns {number} — pozitif = yükseliş, negatif = düşüş
  function _linearSlope(values) {
    var n = values.length;
    if (n < 2) return 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
      sumX  += i;
      sumY  += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    var denom = (n * sumX2 - sumX * sumX);
    return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  }

  // ── _confidence — eğim tutarlılığı (0-100) ────────────────
  // Değerlerin eğim yönüyle ne kadar tutarlı olduğunu ölçer.
  function _confidence(values, slope) {
    if (values.length < 2) return 50;
    var matchCount = 0;
    for (var i = 1; i < values.length; i++) {
      var delta = values[i] - values[i - 1];
      if ((slope >= 0 && delta >= 0) || (slope < 0 && delta < 0)) matchCount++;
    }
    return Math.round((matchCount / (values.length - 1)) * 100);
  }

  // Adapter'ın 'up'|'down'|'stable' çıktısını bu motorun MEVCUT, geriye
  // dönük uyumlu sözleşmesine ('UP'|'DOWN'|'FLAT') eşler — dışarıya
  // bakan davranış/sözleşme DEĞİŞMEDİ, sadece içerideki hesaplama düzeldi.
  var DIRECTION_MAP = { up: 'UP', down: 'DOWN', stable: 'FLAT' };

  // ── analyzeTrends ─────────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   trend: 'UP'|'DOWN'|'FLAT',
  //   confidence: number,
  //   summary: string,
  //   weekly: { slope, direction },
  //   ytd: { slope, direction },
  //   acceleration: boolean,
  //   reversal: boolean
  // }}
  function analyzeTrends(ttt) {
    var result = {
      trend: 'FLAT',
      confidence: 50,
      summary: 'Trend verisi yetersiz.',
      weekly: { slope: 0, direction: 'FLAT' },
      ytd:    { slope: 0, direction: 'FLAT' },
      acceleration: false,
      reversal: false
    };

    try {
      // ── Haftalık trend — ims-adapter.js üzerinden GERÇEK h1..h9 ────
      var records = (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function')
        ? window.IMSAdapter.normalizeIMS(ttt) : [];
      var aggregate = (window.IMSAdapter && typeof window.IMSAdapter.aggregateRecords === 'function')
        ? window.IMSAdapter.aggregateRecords(records) : null;

      if (aggregate) {
        var weekVals = window.IMSAdapter.weekValuesArray(aggregate.weeks);
        var wSlope = _linearSlope(weekVals);
        var wConf  = _confidence(weekVals, wSlope);
        result.weekly = {
          slope:     +wSlope.toFixed(2),
          direction: DIRECTION_MAP[aggregate.calculated.trend] || 'FLAT'
        };

        // İvme: son 3 haftanın eğimi vs önceki 3 haftanın eğimi
        if (weekVals.length >= 6) {
          var recentSlope = _linearSlope(weekVals.slice(-3));
          var prevSlope   = _linearSlope(weekVals.slice(-6, -3));
          result.acceleration = (recentSlope > prevSlope * 1.15);
          result.reversal     = (recentSlope > 0 && prevSlope < 0) ||
                                (recentSlope < 0 && prevSlope > 0);
        }

        // Ana trend kararı — adapter'ın relatif (% bazlı) sınıflandırması
        result.trend      = DIRECTION_MAP[aggregate.calculated.trend] || 'FLAT';
        result.confidence = wConf;

        // Özet metin
        if (result.trend === 'UP') {
          result.summary = result.acceleration
            ? 'Haftalık satışlar ivme kazanarak yükseliyor — ivme artışı var.'
            : 'Haftalık satışlar yükseliş trendinde.';
        } else if (result.trend === 'DOWN') {
          result.summary = result.reversal
            ? 'Önceki yükselişten sonra düşüş başladı — trend dönüşü.'
            : 'Haftalık satışlarda yavaşlama / düşüş trendi.';
        } else {
          result.summary = 'Satışlar yatay seyrediyor — belirgin trend yok.';
        }
      }

      // ── YTD trend (GENEL aylık satis_tl) ─────────────────
      var genelRows = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (genelRows.length >= 2) {
        var ytdVals = genelRows.map(function(r){ return r.satis_tl || 0; });
        var ytdSlope = _linearSlope(ytdVals);
        result.ytd = {
          slope:     +ytdSlope.toFixed(2),
          direction: ytdSlope > 0 ? 'UP' : ytdSlope < 0 ? 'DOWN' : 'FLAT'
        };
      }

    } catch (e) {
      console.warn('[trend-engine] analyzeTrends hata:', e.message);
    }

    return result;
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.analyzeTrends = analyzeTrends;
  console.debug('[trend-engine] Phase 3.0 yüklendi (ims-adapter.js üzerinden).');

})();

