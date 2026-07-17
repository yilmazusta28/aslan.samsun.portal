// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/team-forecast-engine.js
//  Phase 4.0 + 4.1 — Executive Dashboard AI
//
//  Sorumluluk: Ekip geneli forecast ve prim projeksiyonu
//    • buildTeamForecast([ttts]) → {
//        teamForecast, teamHedef, teamSatis, projectedTL,
//        projectedPrim, confidence, byTTT[]
//      }
//
//  Bağımlılık:
//    js/core/constants.js                (ALL_TTTS)
//    js/data/data-state.js               (GENEL)
//    js/core/prim-calc.js                (calcPrimForTTT, getCarpan)
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, ALL_TTTS, calculateRunRate, calcPrimForTTT, getCarpan */

(function () {
  'use strict';

  // ── buildTeamForecast ─────────────────────────────────────
  // @param {string[]} [ttts]
  // @returns {{
  //   teamForecast:   number,   — ağırlıklı ortalama forecast %
  //   teamHedef:      number,   — toplam hedef TL
  //   teamSatis:      number,   — toplam mevcut satış TL
  //   projectedTL:    number,   — dönem sonu tahmini toplam TL
  //   projectedPrim:  number,   — toplam prim projeksiyonu
  //   confidence:     number,   — ortalama forecast güveni (0-100)
  //   repsAbove91:    number,   — %91 üzerinde forecast olanlar
  //   repsBelow91:    number,
  //   byTTT:          Array<{ ttt, realization, forecast, projectedTL, prim, confidence }>
  // }}
  function buildTeamForecast(ttts) {
    var list = ttts || (typeof ALL_TTTS !== 'undefined' ? ALL_TTTS : []);

    var teamHedef    = 0;
    var teamSatis    = 0;
    var projectedTL  = 0;
    var projectedPrim = 0;
    var confSum      = 0;
    var confCount    = 0;
    var byTTT        = [];

    list.forEach(function (ttt) {
      var gt = (GENEL || []).find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (!gt) return;

      var real     = gt.tl_pct   || 0;
      var hedef    = gt.hedef_tl || 0;
      var satis    = gt.satis_tl || 0;

      // Back-calculate hedef when missing (Phase 3.0.3 fix pattern)
      if (hedef === 0 && real > 0 && satis > 0) {
        hedef = Math.round(satis / (real / 100));
      }

      // Forecast via run-rate engine
      var forecast   = real;
      var projTL     = satis;
      var confidence = 30;
      try {
        if (typeof calculateRunRate === 'function') {
          var rr = calculateRunRate(ttt);
          if (rr) {
            forecast   = rr.projectedRealization || real;
            projTL     = rr.projectedMonthEnd    || satis;
            confidence = rr.confidence            || 30;
          }
        }
      } catch (e) { /* silent */ }

      // Prim projeksiyonu (forecast realizasyona göre)
      var prim = 0;
      try {
        if (typeof calcPrimForTTT === 'function') prim = calcPrimForTTT(ttt);
        // Eğer forecast daha yüksekse forward-looking prim hesapla
        if (typeof getCarpan === 'function' && forecast > real && forecast >= 91) {
          var carpanFC = getCarpan(forecast);
          prim = Math.round(carpanFC * 55000 * 1.2); // yaklaşık
        }
      } catch (e) { /* silent */ }

      teamHedef    += hedef;
      teamSatis    += satis;
      projectedTL  += projTL;
      projectedPrim += prim;
      confSum      += confidence;
      confCount++;

      byTTT.push({
        ttt:          ttt,
        realization:  Math.round(real * 10) / 10,
        forecast:     Math.round(forecast * 10) / 10,
        projectedTL:  Math.round(projTL),
        prim:         Math.round(prim),
        confidence:   confidence
      });
    });

    // Ekip geneli forecast % (toplam hedef üzerinden)
    var teamForecast = teamHedef > 0
      ? Math.round((projectedTL / teamHedef) * 1000) / 10
      : 0;

    var avgConf = confCount > 0 ? Math.round(confSum / confCount) : 0;

    var repsAbove91 = byTTT.filter(function (r) { return r.forecast >= 91; }).length;
    var repsBelow91 = byTTT.length - repsAbove91;

    // Forecast sırasına göre sırala
    byTTT.sort(function (a, b) { return b.forecast - a.forecast; });

    return {
      teamForecast:  teamForecast,
      teamHedef:     teamHedef,
      teamSatis:     teamSatis,
      projectedTL:   projectedTL,
      projectedPrim: Math.round(projectedPrim),
      confidence:    avgConf,
      repsAbove91:   repsAbove91,
      repsBelow91:   repsBelow91,
      byTTT:         byTTT
    };
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildTeamForecast = buildTeamForecast;

  console.debug('[team-forecast-engine] Phase 4.0 yüklendi.');
})();
