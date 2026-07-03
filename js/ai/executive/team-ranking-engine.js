// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/team-ranking-engine.js
//  Phase 4.0 + 4.1 — Executive Dashboard AI
//
//  Sorumluluk: Tüm ekip sıralaması + yönetim kategorilendirmesi
//    • buildTeamRanking()            → [{rank, ttt, realization, score, category}]
//    • getManagementCategories(list) → { stars, stable, watchlist, risk }
//
//  Skor Formülü:
//    30% Realization  (tl_pct → 0-100 normalize)
//    25% Forecast     (projectedReal → calculateRunRate)
//    20% Growth       (son trend — IMS h7-h9 slope)
//    15% Market Share (IMS pazar payı ortalaması)
//    10% Risk Adj.    (-10 per HIGH risk, -5 per MEDIUM)
//
//  Bağımlılık:
//    js/core/constants.js                (ALL_TTTS, URUN_ORDER)
//    js/data/data-state.js               (GENEL, IMS)
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//    js/ai/intelligence/risk-engine.js   (detectRisks)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, ALL_TTTS, calculateRunRate, detectRisks */

(function () {
  'use strict';

  // ── _safeReal ─────────────────────────────────────────────
  function _safeReal(ttt) {
    var gt = (GENEL || []).find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    return gt ? (gt.tl_pct || 0) : 0;
  }

  // ── _forecastReal ─────────────────────────────────────────
  function _forecastReal(ttt) {
    try {
      if (typeof calculateRunRate === 'function') {
        var rr = calculateRunRate(ttt);
        if (rr && rr.projectedRealization > 0) return rr.projectedRealization;
      }
    } catch (e) { /* silent */ }
    return _safeReal(ttt); // fallback: mevcut real
  }

  // ── _growthScore ──────────────────────────────────────────
  // Son 3 haftanın doğrusal eğimine göre büyüme puanı (0-100)
  function _growthScore(ttt) {
    var imsRows = (IMS || []).filter(function (r) { return r.ttt === ttt; });
    if (!imsRows.length) return 50; // veri yoksa nötr

    var wMap = {};
    imsRows.forEach(function (r) {
      var w = r.hafta || 0; if (!w) return;
      if (!wMap[w]) wMap[w] = 0;
      wMap[w] += (r.own_tl || 0);
    });
    var wVals = Object.keys(wMap).map(Number).sort(function (a, b) { return a - b; })
      .map(function (w) { return wMap[w]; });
    if (wVals.length < 2) return 50;

    var last3 = wVals.slice(-3);
    var prev3 = wVals.slice(-6, -3);
    if (!prev3.length) return 50;

    var lastAvg = last3.reduce(function (s, v) { return s + v; }, 0) / last3.length;
    var prevAvg = prev3.reduce(function (s, v) { return s + v; }, 0) / prev3.length;
    if (prevAvg === 0) return 50;

    var ratio = lastAvg / prevAvg; // 1.0 = yatay, >1 = büyüme, <1 = düşüş
    // Map ratio 0.5–1.5 → 0–100
    return Math.round(Math.min(100, Math.max(0, (ratio - 0.5) * 100)));
  }

  // ── _marketShareScore ─────────────────────────────────────
  function _marketShareScore(ttt) {
    var imsRows = (IMS || []).filter(function (r) { return r.ttt === ttt; });
    if (!imsRows.length) return 50;

    var ownTot = 0, mktTot = 0;
    imsRows.forEach(function (r) {
      if (r.is_mkt)      mktTot += (r.toplam || 0);
      else               ownTot += (r.toplam || 0);
    });
    var totalAll = ownTot + mktTot;
    if (totalAll === 0) return 50;

    var ppi = (ownTot / totalAll) * 100;
    // Map 0–50% pazar payı → 0–100 skor
    return Math.round(Math.min(100, ppi * 2));
  }

  // ── _riskAdjustment ───────────────────────────────────────
  function _riskAdjustment(ttt) {
    try {
      if (typeof detectRisks === 'function') {
        var risks = detectRisks(ttt) || [];
        var adj = 0;
        risks.forEach(function (r) {
          if (r.severity === 'HIGH')   adj -= 10;
          if (r.severity === 'MEDIUM') adj -= 5;
        });
        return adj;
      }
    } catch (e) { /* silent */ }
    return 0;
  }

  // ── _computeScore ─────────────────────────────────────────
  function _computeScore(ttt) {
    var real     = _safeReal(ttt);
    var forecast = _forecastReal(ttt);
    var growth   = _growthScore(ttt);
    var mktShare = _marketShareScore(ttt);
    var riskAdj  = _riskAdjustment(ttt);

    // Normalize real (cap 130 → 100)
    var realScore = Math.min(100, (real / 130) * 100);
    // Normalize forecast
    var fcScore   = Math.min(100, (forecast / 130) * 100);

    var raw = (realScore  * 0.30) +
              (fcScore    * 0.25) +
              (growth     * 0.20) +
              (mktShare   * 0.15) +
              riskAdj; // 0.10 weight already encoded as -10/-5 pts

    return Math.round(Math.min(100, Math.max(0, raw)));
  }

  // ── _category ─────────────────────────────────────────────
  function _category(real, score) {
    if (real >= 100 && score >= 80) return 'STAR';
    if (real >=  91 && score >= 60) return 'STABLE';
    if (real >=  70 && score >= 40) return 'WATCHLIST';
    return 'RISK';
  }

  // ── buildTeamRanking ──────────────────────────────────────
  // @param {string[]} [ttts]  — varsayılan ALL_TTTS
  // @returns {Array<{
  //   rank, ttt, realization, forecast, growthScore,
  //   marketShareScore, score, category, primEstimate
  // }>}
  function buildTeamRanking(ttts) {
    var list = ttts || (typeof ALL_TTTS !== 'undefined' ? ALL_TTTS : []);
    var results = [];

    list.forEach(function (ttt) {
      var real     = _safeReal(ttt);
      var forecast = _forecastReal(ttt);
      var score    = _computeScore(ttt);
      var cat      = _category(real, score);

      // Prim tahmini
      var prim = 0;
      try {
        if (typeof calcPrimForTTT === 'function') prim = calcPrimForTTT(ttt);
      } catch (e) { /* silent */ }

      results.push({
        ttt:              ttt,
        realization:      Math.round(real   * 10) / 10,
        forecast:         Math.round(forecast * 10) / 10,
        growthScore:      _growthScore(ttt),
        marketShareScore: _marketShareScore(ttt),
        score:            score,
        category:         cat,
        primEstimate:     Math.round(prim)
      });
    });

    // Score → rank sıralaması
    results.sort(function (a, b) { return b.score - a.score; });
    results.forEach(function (r, i) { r.rank = i + 1; });

    return results;
  }

  // ── getManagementCategories ───────────────────────────────
  // @param {Array} ranking  buildTeamRanking() çıktısı
  // @returns {{ stars, stable, watchlist, risk, risingStars,
  //             primLeaders, underperformers, hiddenOpportunities }}
  function getManagementCategories(ranking) {
    if (!ranking || !ranking.length) return {};

    var stars          = ranking.filter(function (r) { return r.category === 'STAR'; });
    var stable         = ranking.filter(function (r) { return r.category === 'STABLE'; });
    var watchlist      = ranking.filter(function (r) { return r.category === 'WATCHLIST'; });
    var risk           = ranking.filter(function (r) { return r.category === 'RISK'; });

    // Rising Stars: forecast > realization + 10 puan
    var risingStars = ranking.filter(function (r) {
      return r.forecast > r.realization + 10 && r.realization >= 60;
    });

    // Prim Leaders: en yüksek prim + real >= 91
    var primLeaders = ranking.slice()
      .filter(function (r) { return r.realization >= 91; })
      .sort(function (a, b) { return b.primEstimate - a.primEstimate })
      .slice(0, 5);

    // Underperformers: real < 70 OR (real < 91 AND forecast < 91)
    var underperformers = ranking.filter(function (r) {
      return r.realization < 70 || (r.realization < 91 && r.forecast < 91);
    });

    // Hidden Opportunities: zayıf real ama yüksek market share score
    var hiddenOpportunities = ranking.filter(function (r) {
      return r.realization < 91 && r.marketShareScore >= 60;
    });

    return {
      stars:               stars,
      stable:              stable,
      watchlist:           watchlist,
      risk:                risk,
      risingStars:         risingStars,
      primLeaders:         primLeaders,
      underperformers:     underperformers,
      hiddenOpportunities: hiddenOpportunities
    };
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildTeamRanking         = buildTeamRanking;
  window.getManagementCategories  = getManagementCategories;

  console.debug('[team-ranking-engine] Phase 4.0 yüklendi.');
})();
