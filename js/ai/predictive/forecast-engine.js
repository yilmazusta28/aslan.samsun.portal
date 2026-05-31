// ══════════════════════════════════════════════════════════════════════
//  js/ai/predictive/forecast-engine.js
//  Phase 3.1 — Predictive Forecast Engine
//
//  Sorumluluk: Dönem sonu TL / kutu satış tahmini
//    • generateForecast(ttt) → { projectedTL, projectedBox, confidence, methodology }
//
//  Yöntemler (en iyi sonuç seçilir):
//    1. Linear projection   — tüm haftalara eşit ağırlık, doğrusal trendten extrapole
//    2. Weighted recent trend — son 3 haftaya 2×, önceki haftalara 1× ağırlık
//    3. Trend-adjusted run rate — run rate × trend düzeltme faktörü
//
//  Bağımlılık:
//    js/ai/predictive/runrate-engine.js  (calculateRunRate, _rrCurrentPeriod)
//    js/data/data-state.js               (GENEL, IMS, KUTU)
//    js/core/constants.js                (IMS_TL_MAP, URUN_ORDER)
//    js/core/date-utils.js               (PERIODS, workDays)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, KUTU, IMS_TL_MAP, URUN_ORDER, calculateRunRate, _rrCurrentPeriod */

(function () {
  'use strict';

  // ── _weeklyTLSeries ───────────────────────────────────────
  // ttt için haftalık toplam TL serisini döndürür (artık→azalan hftya göre sıralı).
  function _weeklyTLSeries(ttt) {
    var rows = (typeof IMS !== 'undefined' ? IMS : [])
      .filter(function (r) { return r.ttt === ttt; });
    var map = {};
    rows.forEach(function (r) {
      var w = r.hafta || 0;
      if (!w) return;
      if (!map[w]) map[w] = 0;
      // own_tl varsa kullan, yoksa own_kutu × birim fiyat
      var tl = (r.own_tl || 0);
      if (!tl && r.own_kutu && typeof IMS_TL_MAP !== 'undefined') {
        tl = (r.own_kutu || 0) * (IMS_TL_MAP[r.ilac] || 0);
      }
      map[w] += tl;
    });
    return Object.keys(map)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (w) { return map[w]; });
  }

  // ── _weeklyBoxSeries ──────────────────────────────────────
  function _weeklyBoxSeries(ttt) {
    var rows = (typeof IMS !== 'undefined' ? IMS : [])
      .filter(function (r) { return r.ttt === ttt; });
    var map = {};
    rows.forEach(function (r) {
      var w = r.hafta || 0;
      if (!w) return;
      if (!map[w]) map[w] = 0;
      map[w] += (r.own_kutu || 0);
    });
    return Object.keys(map)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (w) { return map[w]; });
  }

  // ── _linearSlope ─────────────────────────────────────────
  function _linearSlope(vals) {
    var n = vals.length;
    if (n < 2) return 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
      sumX += i; sumY += vals[i];
      sumXY += i * vals[i]; sumX2 += i * i;
    }
    var d = n * sumX2 - sumX * sumX;
    return d !== 0 ? (n * sumXY - sumX * sumY) / d : 0;
  }

  // ── METHOD 1: Linear projection ──────────────────────────
  // Mevcut haftalara doğrusal eğim fit ederek kalan haftaları extrapole eder.
  function _linearProjection(vals, remainingWeeks) {
    if (!vals.length) return 0;
    var slope   = _linearSlope(vals);
    var lastVal = vals[vals.length - 1];
    var sum = 0;
    for (var i = 1; i <= remainingWeeks; i++) {
      var projected = Math.max(0, lastVal + slope * i);
      sum += projected;
    }
    return sum;
  }

  // ── METHOD 2: Weighted recent trend ──────────────────────
  // Son 3 haftaya 2×, daha öncekilere 1× ağırlık → haftalık ortalama hesapla.
  function _weightedRecentTrend(vals, remainingWeeks) {
    if (!vals.length) return 0;
    var recent  = vals.slice(-3);
    var earlier = vals.slice(0, Math.max(0, vals.length - 3));
    var wSum = 0, wCnt = 0;
    recent.forEach(function  (v) { wSum += v * 2; wCnt += 2; });
    earlier.forEach(function (v) { wSum += v * 1; wCnt += 1; });
    var weeklyAvg = wCnt > 0 ? wSum / wCnt : 0;
    return weeklyAvg * remainingWeeks;
  }

  // ── METHOD 3: Trend-adjusted run rate ────────────────────
  // Run rate × trend faktörü (son 3 hafta ortalaması / önceki 3 hafta ortalaması).
  function _trendAdjustedRunRate(runRateProjected, vals) {
    if (vals.length < 4) return runRateProjected;
    var recent  = vals.slice(-3);
    var prev    = vals.slice(-6, -3);
    if (!prev.length) return runRateProjected;
    var recentAvg = recent.reduce(function (s, v) { return s + v; }, 0) / recent.length;
    var prevAvg   = prev.reduce(function (s, v) { return s + v; }, 0)   / prev.length;
    var factor = prevAvg > 0 ? recentAvg / prevAvg : 1;
    // Faktörü sınırla (sert sapmalardan koruma)
    factor = Math.min(1.5, Math.max(0.5, factor));
    return runRateProjected * factor;
  }

  // ── _bestEstimate ─────────────────────────────────────────
  // 3 metodun ortalaması; aykırı değerleri dışlar.
  function _bestEstimate(v1, v2, v3) {
    var vals = [v1, v2, v3].sort(function (a, b) { return a - b; });
    // Median of 3
    return vals[1];
  }

  // ── _productForecasts ─────────────────────────────────────
  // Ürün bazlı TL tahminleri.
  function _productForecasts(ttt, remainingWeeks) {
    var urunOrder  = (typeof URUN_ORDER !== 'undefined') ? URUN_ORDER : [];
    var tlMap      = (typeof IMS_TL_MAP !== 'undefined') ? IMS_TL_MAP : {};
    var genelRows  = (typeof GENEL !== 'undefined' ? GENEL : [])
      .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
    var imsAll     = (typeof IMS !== 'undefined' ? IMS : [])
      .filter(function (r) { return r.ttt === ttt; });

    return urunOrder.map(function (urun) {
      var gr = genelRows.find(function (r) { return r.urun === urun; });
      if (!gr) return { urun: urun, currentTL: 0, projectedTL: 0, hedefTL: 0, projectedReal: 0 };

      // Haftalık TL serisi bu ürün için
      var imsUrun = imsAll.filter(function (r) { return r.ilac === urun || r.urun === urun; });
      var wMap = {};
      imsUrun.forEach(function (r) {
        var w = r.hafta || 0; if (!w) return;
        if (!wMap[w]) wMap[w] = 0;
        var tl = (r.own_tl || 0) || ((r.own_kutu || 0) * (tlMap[urun] || 0));
        wMap[w] += tl;
      });
      var wVals = Object.keys(wMap).map(Number).sort(function (a, b) { return a - b; })
        .map(function (w) { return wMap[w]; });

      var currentTL = gr.satis_tl  || 0;
      var hedefTL   = gr.hedef_tl  || 0;
      var slope     = _linearSlope(wVals);
      var lastW     = wVals.length ? wVals[wVals.length - 1] : 0;
      var addedTL   = 0;
      for (var i = 1; i <= remainingWeeks; i++) {
        addedTL += Math.max(0, lastW + slope * i);
      }
      var projTL    = currentTL + addedTL;
      var projReal  = hedefTL > 0 ? (projTL / hedefTL) * 100 : 0;

      return {
        urun:         urun,
        currentTL:    Math.round(currentTL),
        projectedTL:  Math.round(projTL),
        hedefTL:      Math.round(hedefTL),
        projectedReal: Math.round(projReal * 10) / 10
      };
    });
  }

  // ── generateForecast ─────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   projectedTL:      number,
  //   projectedBox:     number,
  //   projectedReal:    number,
  //   currentTL:        number,
  //   hedefTL:          number,
  //   confidence:       number,
  //   methodology:      string,
  //   productForecasts: Array,
  //   runRate:          object,
  //   insights:         string[]
  // }}
  function generateForecast(ttt) {
    var result = {
      projectedTL:      0,
      projectedBox:     0,
      projectedReal:    0,
      currentTL:        0,
      hedefTL:          0,
      confidence:       0,
      methodology:      'Veri yetersiz',
      productForecasts: [],
      runRate:          {},
      insights:         []
    };

    try {
      // ── Run rate hesapla ──────────────────────────────────
      var rr = (typeof calculateRunRate === 'function')
        ? calculateRunRate(ttt)
        : { projectedMonthEnd: 0, dailyRunRate: 0, remainingDays: 0, confidence: 0 };
      result.runRate = rr;

      // ── GENEL veri ────────────────────────────────────────
      var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      var currentTL = genelTotal ? (genelTotal.satis_tl || 0) : 0;
      var hedefTL   = genelTotal ? (genelTotal.hedef_tl  || 0) : 0;
      result.currentTL = currentTL;
      result.hedefTL   = hedefTL;

      // ── Haftalık seriler ──────────────────────────────────
      var tlVals  = _weeklyTLSeries(ttt);
      var boxVals = _weeklyBoxSeries(ttt);

      // ── Kalan haftaları tahmin et ─────────────────────────
      var period = (typeof _rrCurrentPeriod === 'function') ? _rrCurrentPeriod() : null;
      var totalWeeks    = period ? Math.round(rr.totalDays    / 5) : 9;
      var elapsedWeeks  = tlVals.length || Math.round(rr.elapsedDays  / 5);
      var remainingWeeks = Math.max(0, totalWeeks - elapsedWeeks);

      // ── TL: 3 yöntem ─────────────────────────────────────
      var addedByLinear  = _linearProjection(tlVals, remainingWeeks);
      var addedByWeighted = _weightedRecentTrend(tlVals, remainingWeeks);
      var addedByRunRate = _trendAdjustedRunRate(rr.dailyRunRate * rr.remainingDays, tlVals);

      var bestAdded  = _bestEstimate(addedByLinear, addedByWeighted, addedByRunRate);
      var projectedTL = Math.max(currentTL, currentTL + bestAdded);

      // ── Box: aynı yöntemle ────────────────────────────────
      var boxAdded = _bestEstimate(
        _linearProjection(boxVals, remainingWeeks),
        _weightedRecentTrend(boxVals, remainingWeeks),
        _trendAdjustedRunRate(
          (boxVals.length ? boxVals.reduce(function(s,v){return s+v;},0) / boxVals.length : 0) * remainingWeeks,
          boxVals
        )
      );
      var projectedBox = Math.round((typeof KUTU !== 'undefined'
        ? (KUTU.filter(function(r){return r.ttt===ttt;}).reduce(function(s,r){return s+(r.cikan_kutu||0);},0))
        : 0) + boxAdded);

      // ── Realizasyon tahmini ──────────────────────────────
      var projReal = hedefTL > 0 ? (projectedTL / hedefTL) * 100 : 0;

      result.projectedTL   = Math.round(projectedTL);
      result.projectedBox  = Math.round(Math.max(0, projectedBox));
      result.projectedReal = Math.round(projReal * 10) / 10;
      result.confidence    = rr.confidence;
      result.methodology   = tlVals.length >= 3
        ? 'Ağırlıklı trend + lineer projeksiyon (median seçimi)'
        : tlVals.length >= 1
          ? 'Run rate bazlı projeksiyon'
          : 'Sadece run rate (haftalık veri yok)';

      // ── Ürün bazlı tahminler ──────────────────────────────
      result.productForecasts = _productForecasts(ttt, remainingWeeks);

      // ── Akıllı insight'lar ────────────────────────────────
      var insights = [];
      if (projReal >= 100) {
        insights.push('📈 Mevcut hız %100 hedefi aşmaya yetiyor.');
      } else if (projReal >= 91) {
        insights.push('✅ Run rate %91 prim eşiğini karşılıyor (tahmini %' + result.projectedReal + ').');
      } else if (projReal >= 75) {
        insights.push('⚠️ Mevcut hız %91 eşiğinin altında — kalan günlerde ivme gerekli (tahmini %' + result.projectedReal + ').');
      } else {
        insights.push('🔴 Mevcut run rate dönem sonunda %' + result.projectedReal + ' realizasyona işaret ediyor — acil aksiyon şart.');
      }

      result.productForecasts.forEach(function (pf) {
        if (pf.projectedReal >= 105) {
          insights.push('🏆 ' + pf.urun + ' planı aşacak (tahmin: %' + pf.projectedReal + ').');
        } else if (pf.projectedReal < 70) {
          insights.push('⚠️ ' + pf.urun + ' hedefin çok altında kalmaya devam edecek (tahmin: %' + pf.projectedReal + ').');
        }
      });

      result.insights = insights;

    } catch (e) {
      console.warn('[forecast-engine] generateForecast hata:', e.message);
      result.methodology = 'Hesaplama hatası: ' + e.message;
    }

    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.generateForecast = generateForecast;
  console.debug('[forecast-engine] Phase 3.1 yüklendi.');

})();
