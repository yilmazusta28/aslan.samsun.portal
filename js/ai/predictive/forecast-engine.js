// ══════════════════════════════════════════════════════════════════════
//  js/ai/predictive/forecast-engine.js
//  Phase 3.1 — Predictive Forecast Engine
//  Phase 1 Refactor — IMS Data Model Unification
//
//  Sorumluluk: Dönem sonu TL / kutu satış tahmini
//    • generateForecast(ttt) → { projectedTL, projectedBox, confidence, methodology }
//
//  DEĞİŞİKLİK: r.hafta, r.own_tl, r.own_kutu → YOK.
//    Haftalık seri IMSAdapter.getOwnWeeklySeries() üzerinden alınıyor.
//    _linearSlope → IMSAdapter.linearSlope (paylaşımlı yardımcı, duplikasyon kaldırıldı).
//
//  Bağımlılık:
//    js/ai/core/ims-adapter.js
//    js/ai/predictive/runrate-engine.js  (calculateRunRate, _rrCurrentPeriod)
//    js/data/data-state.js               (GENEL, KUTU)
//    js/core/constants.js                (IMS_TL_MAP, URUN_ORDER)
//    js/core/date-utils.js               (PERIODS, workDays)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMSAdapter, GENEL, KUTU, IMS_TL_MAP, URUN_ORDER, calculateRunRate, _rrCurrentPeriod */

(function () {
  'use strict';

  // ── METHOD 1: Linear projection ──────────────────────────
  function _linearProjection(vals, remainingWeeks) {
    if (!vals.length) return 0;
    var slope   = IMSAdapter.linearSlope(vals);
    var lastVal = vals[vals.length - 1];
    var sum = 0;
    for (var i = 1; i <= remainingWeeks; i++) {
      sum += Math.max(0, lastVal + slope * i);
    }
    return sum;
  }

  // ── METHOD 2: Weighted recent trend ──────────────────────
  function _weightedRecentTrend(vals, remainingWeeks) {
    if (!vals.length) return 0;
    var recent  = vals.slice(-3);
    var earlier = vals.slice(0, Math.max(0, vals.length - 3));
    var wSum = 0, wCnt = 0;
    recent.forEach(function(v)  { wSum += v * 2; wCnt += 2; });
    earlier.forEach(function(v) { wSum += v * 1; wCnt += 1; });
    var weeklyAvg = wCnt > 0 ? wSum / wCnt : 0;
    return weeklyAvg * remainingWeeks;
  }

  // ── METHOD 3: Trend-adjusted run rate ────────────────────
  function _trendAdjustedRunRate(runRateProjected, vals) {
    if (vals.length < 4) return runRateProjected;
    var recent = vals.slice(-3);
    var prev   = vals.slice(-6, -3);
    if (!prev.length) return runRateProjected;
    var recentAvg = recent.reduce(function(s,v){ return s+v; }, 0) / recent.length;
    var prevAvg   = prev.reduce(function(s,v){ return s+v; }, 0)   / prev.length;
    var factor = prevAvg > 0 ? recentAvg / prevAvg : 1;
    factor = Math.min(1.5, Math.max(0.5, factor));
    return runRateProjected * factor;
  }

  // ── _bestEstimate: 3 metodun median'ı ────────────────────
  function _bestEstimate(v1, v2, v3) {
    var vals = [v1, v2, v3].sort(function(a, b){ return a - b; });
    return vals[1];
  }

  // ── _productForecasts ─────────────────────────────────────
  function _productForecasts(ttt, remainingWeeks) {
    var urunOrder = (typeof URUN_ORDER !== 'undefined') ? URUN_ORDER : [];
    var genelRows = (typeof GENEL !== 'undefined' ? GENEL : [])
      .filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });

    // Adapter cache'inden ürün başına haftalık seri
    var imsCache = IMSAdapter.getIMSCache().filter(function(r){
      return r.representative === ttt && r.isOwn;
    });

    return urunOrder.map(function(urun) {
      var gr = genelRows.find(function(r){ return r.urun === urun; });
      if (!gr) return { urun: urun, currentTL: 0, projectedTL: 0, hedefTL: 0, projectedReal: 0 };

      // Bu ürünün haftalık kutu serisi (adapter'dan)
      var urunRecords = imsCache.filter(function(r){
        return r.product === urun || r.ilac === urun;
      });

      var tlMap  = (typeof IMS_TL_MAP !== 'undefined') ? IMS_TL_MAP : {};
      var wSums  = [0,0,0,0,0,0,0,0,0];
      urunRecords.forEach(function(r) {
        for (var i = 0; i < 9; i++) {
          var kutu = r.weeks['w' + (i+1)] || 0;
          var birim = tlMap[r.product] || tlMap[r.ilac] || 0;
          wSums[i] += kutu * birim;
        }
      });
      var wVals = wSums.filter(function(v){ return v > 0; });

      var currentTL = gr.satis_tl || 0;
      var hedefTL   = gr.hedef_tl || 0;
      var slope     = IMSAdapter.linearSlope(wVals);
      var lastW     = wVals.length ? wVals[wVals.length - 1] : 0;
      var addedTL   = 0;
      for (var i = 1; i <= remainingWeeks; i++) {
        addedTL += Math.max(0, lastW + slope * i);
      }
      var projTL   = currentTL + addedTL;
      var projReal = hedefTL > 0 ? (projTL / hedefTL) * 100 : 0;

      return {
        urun:          urun,
        currentTL:     Math.round(currentTL),
        projectedTL:   Math.round(projTL),
        hedefTL:       Math.round(hedefTL),
        projectedReal: Math.round(projReal * 10) / 10
      };
    });
  }

  // ── generateForecast ─────────────────────────────────────
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
      var rr = (typeof calculateRunRate === 'function')
        ? calculateRunRate(ttt)
        : { projectedMonthEnd: 0, dailyRunRate: 0, remainingDays: 0, confidence: 0 };
      result.runRate = rr;

      var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function(r){ return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      var currentTL = genelTotal ? (genelTotal.satis_tl || 0) : 0;
      var hedefTL   = genelTotal ? (genelTotal.hedef_tl  || 0) : 0;
      result.currentTL = currentTL;
      result.hedefTL   = hedefTL;

      // ── Haftalık seriler — adapter üzerinden (own_tl, own_kutu YOK) ──
      var tlVals  = IMSAdapter.getOwnWeeklySeries(ttt, true  /* asTL  */);
      var boxVals = IMSAdapter.getOwnWeeklySeries(ttt, false /* asKutu */);

      var period = (typeof _rrCurrentPeriod === 'function') ? _rrCurrentPeriod() : null;
      var totalWeeks     = period ? Math.round(rr.totalDays   / 5) : 9;
      var elapsedWeeks   = tlVals.filter(function(v){ return v > 0; }).length || Math.round((rr.elapsedDays || 0) / 5);
      var remainingWeeks = Math.max(0, totalWeeks - elapsedWeeks);

      var addedByLinear   = _linearProjection(tlVals, remainingWeeks);
      var addedByWeighted = _weightedRecentTrend(tlVals, remainingWeeks);
      var addedByRunRate  = _trendAdjustedRunRate(rr.dailyRunRate * rr.remainingDays, tlVals);

      var bestAdded   = _bestEstimate(addedByLinear, addedByWeighted, addedByRunRate);
      var projectedTL = Math.max(currentTL, currentTL + bestAdded);

      var boxAdded = _bestEstimate(
        _linearProjection(boxVals, remainingWeeks),
        _weightedRecentTrend(boxVals, remainingWeeks),
        _trendAdjustedRunRate(
          (boxVals.length ? boxVals.reduce(function(s,v){return s+v;},0) / boxVals.length : 0) * remainingWeeks,
          boxVals
        )
      );
      var currentBox = (typeof KUTU !== 'undefined')
        ? KUTU.filter(function(r){return r.ttt===ttt;}).reduce(function(s,r){return s+(r.cikan_kutu||0);},0)
        : 0;
      var projectedBox = Math.round(currentBox + boxAdded);

      var projReal = hedefTL > 0 ? (projectedTL / hedefTL) * 100 : 0;

      result.projectedTL   = Math.round(projectedTL);
      result.projectedBox  = Math.round(Math.max(0, projectedBox));
      result.projectedReal = Math.round(projReal * 10) / 10;
      result.confidence    = rr.confidence;
      result.methodology   = tlVals.filter(function(v){return v>0;}).length >= 3
        ? 'Ağırlıklı trend + lineer projeksiyon (median seçimi)'
        : tlVals.filter(function(v){return v>0;}).length >= 1
          ? 'Run rate bazlı projeksiyon'
          : 'Sadece run rate (haftalık veri yok)';

      result.productForecasts = _productForecasts(ttt, remainingWeeks);

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

      result.productForecasts.forEach(function(pf) {
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

    if (window.LearningEngine && result.projectedBox > 0) {
      window.LearningEngine.recordPrediction({
        type:'forecast', engine:'forecast', ttt:ttt,
        predictedQty:result.projectedBox, predictedTL:result.projectedTL,
        confidence:result.confidence||70,
        meta:{ methodology:result.methodology, projectedReal:result.projectedReal }
      });
    }
    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.generateForecast = generateForecast;
  console.debug('[forecast-engine] Phase 3.1 + Phase 1 Refactor yüklendi.');

})();
