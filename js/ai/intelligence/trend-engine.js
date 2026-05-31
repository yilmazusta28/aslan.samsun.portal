// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/trend-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//
//  Sorumluluk: Haftalık/aylık/YTD trend analizi
//    • analyzeTrends(ttt) → { trend, confidence, summary, details }
//
//  Analiz: IMS haftalık satış verisi — ivme, yavaşlama, dönüş noktası
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//
//  Bağımlılık: js/data/data-state.js, js/core/date-utils.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMS, GENEL, MIGI_TL_RAW */

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
      var imsRows = (IMS || []).filter(function(r){ return r.ttt === ttt; });
      if (!imsRows.length) return result;

      // ── Haftalık trend (IMS haftalık kutu toplamı) ────────
      // hafta numarasına göre sırala, kutu/TL topla
      var weekMap = {};
      imsRows.forEach(function(r) {
        var wk = r.hafta || 0;
        if (!weekMap[wk]) weekMap[wk] = { kutu: 0, tl: 0 };
        weekMap[wk].kutu += (r.own_kutu || 0);
        weekMap[wk].tl   += (r.own_tl   || 0);
      });

      var weeks    = Object.keys(weekMap).map(Number).sort(function(a, b){ return a - b; });
      var weekVals = weeks.map(function(w){ return weekMap[w].tl; });

      if (weekVals.length >= 2) {
        var wSlope = _linearSlope(weekVals);
        var wConf  = _confidence(weekVals, wSlope);
        result.weekly = {
          slope:     +wSlope.toFixed(2),
          direction: wSlope > 0 ? 'UP' : wSlope < 0 ? 'DOWN' : 'FLAT'
        };

        // İvme: son 3 haftanın eğimi vs önceki 3 haftanın eğimi
        if (weekVals.length >= 6) {
          var recentSlope = _linearSlope(weekVals.slice(-3));
          var prevSlope   = _linearSlope(weekVals.slice(-6, -3));
          result.acceleration = (recentSlope > prevSlope * 1.15);
          result.reversal     = (recentSlope > 0 && prevSlope < 0) ||
                                (recentSlope < 0 && prevSlope > 0);
        }

        // Ana trend kararı
        var baseConf = wConf;
        result.trend      = wSlope > 500 ? 'UP' : wSlope < -500 ? 'DOWN' : 'FLAT';
        result.confidence = baseConf;

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
  console.debug('[trend-engine] Phase 3.0 yüklendi.');

})();
