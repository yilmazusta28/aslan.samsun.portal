// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/trend-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  Phase 1 Refactor — IMS Data Model Unification
//
//  Sorumluluk: Haftalık/aylık/YTD trend analizi
//    • analyzeTrends(ttt) → { trend, confidence, summary, details }
//
//  DEĞİŞİKLİK: IMS global'a doğrudan erişim YOK.
//    Tüm IMS verisi window.IMSAdapter üzerinden gelir.
//    r.hafta, r.own_kutu, r.own_tl → adapter metodları ile değiştirildi.
//    _linearSlope ve _confidence → IMSAdapter.linearSlope / trendConfidence
//    paylaşımlı yardımcılar kullanılıyor (duplikasyon kaldırıldı).
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMSAdapter, GENEL */

(function() {
  'use strict';

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
      // ── IMSAdapter'dan kendi ürünlerin haftalık TL serisi ──
      // own_tl = own_kutu × IMS_TL_MAP; adapter bunu sağlar.
      var weekVals = IMSAdapter.getOwnWeeklySeries(ttt, true /* asTL */);

      if (weekVals.length >= 2) {
        var wSlope = IMSAdapter.linearSlope(weekVals);
        var wConf  = IMSAdapter.trendConfidence(weekVals, wSlope);

        result.weekly = {
          slope:     +wSlope.toFixed(2),
          direction: wSlope > 0 ? 'UP' : wSlope < 0 ? 'DOWN' : 'FLAT'
        };

        // İvme: son 3 haftanın eğimi vs önceki 3 haftanın eğimi
        if (weekVals.length >= 6) {
          var recentSlope = IMSAdapter.linearSlope(weekVals.slice(-3));
          var prevSlope   = IMSAdapter.linearSlope(weekVals.slice(-6, -3));
          result.acceleration = (recentSlope > prevSlope * 1.15);
          result.reversal     = (recentSlope > 0 && prevSlope < 0) ||
                                (recentSlope < 0 && prevSlope > 0);
        }

        result.trend      = wSlope > 500 ? 'UP' : wSlope < -500 ? 'DOWN' : 'FLAT';
        result.confidence = wConf;

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
        var ytdVals  = genelRows.map(function(r){ return r.satis_tl || 0; });
        var ytdSlope = IMSAdapter.linearSlope(ytdVals);
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
  console.debug('[trend-engine] Phase 3.0 + Phase 1 Refactor yüklendi.');

})();
