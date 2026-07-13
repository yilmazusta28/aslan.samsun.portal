// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/team-risk-engine.js
//  Phase 4.0 + 4.1 — Executive Dashboard AI
//
//  Sorumluluk: Ekip genelinde risk tespiti ve sınıflandırması
//    • analyzeTeamRisk([ttts]) → [{ttt, risk, reasons[], score}]
//    • getTeamRiskSummary(list) → { high[], medium[], low[], totalHigh }
//
//  Risk Kriterleri:
//    HIGH   → forecast < 91%  OR  realization < 70%
//    MEDIUM → forecast < 95%  OR  realization < 85%  OR  HIGH risk sayısı >= 2
//    LOW    → diğerleri
//
//  Bağımlılık:
//    js/core/constants.js                (ALL_TTTS)
//    js/data/data-state.js               (GENEL)
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//    js/ai/intelligence/risk-engine.js   (detectRisks)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, ALL_TTTS, MIGI_TL_RAW, calculateRunRate, detectRisks */

(function () {
  'use strict';

  function _safeReal(ttt) {
    var gt = (GENEL || []).find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    return gt ? (gt.tl_pct || 0) : 0;
  }

  function _safeForecast(ttt) {
    try {
      if (typeof calculateRunRate === 'function') {
        var rr = calculateRunRate(ttt);
        if (rr && rr.projectedRealization > 0) return rr.projectedRealization;
      }
    } catch (e) { /* silent */ }
    return _safeReal(ttt);
  }

  // ── analyzeTeamRisk ───────────────────────────────────────
  // @param {string[]} [ttts]
  // @returns {Array<{
  //   ttt, risk:'HIGH'|'MEDIUM'|'LOW',
  //   reasons: string[],
  //   realization, forecast, riskScore
  // }>}
  function analyzeTeamRisk(ttts) {
    var list = ttts || (typeof ALL_TTTS !== 'undefined' ? ALL_TTTS : []);
    var results = [];

    list.forEach(function (ttt) {
      var real     = _safeReal(ttt);
      var forecast = _safeForecast(ttt);
      var reasons  = [];
      var riskScore = 0;

      // Realizasyon riskleri
      if (real < 70) {
        reasons.push('Realizasyon kritik: %' + real.toFixed(1));
        riskScore += 40;
      } else if (real < 85) {
        reasons.push('Realizasyon zayıf: %' + real.toFixed(1));
        riskScore += 20;
      }

      // Forecast riskleri
      if (forecast < 91) {
        reasons.push('Forecast %91 altında: %' + forecast.toFixed(1));
        riskScore += 35;
      } else if (forecast < 95) {
        reasons.push('Forecast %95 altında: %' + forecast.toFixed(1));
        riskScore += 15;
      }

      // Ürün bazlı riskler
      var urunRows = (GENEL || []).filter(function (r) {
        return r.ttt === ttt && r.urun !== 'GENEL TOPLAM';
      });
      var criticalUruns = urunRows.filter(function (r) { return (r.tl_pct || 0) < 70; });
      if (criticalUruns.length >= 2) {
        reasons.push(criticalUruns.length + ' ürün hedefin çok altında');
        riskScore += 15;
      }

      // MI/GI riski
      // BUG DÜZELTMESİ: r.ttt → r.person, r.gi → r.bi + sadece EN GÜNCEL
      // döneme ait satırlar kullanılıyor (bkz. prim-calc.js düzeltme notu).
      var _migiDonemNum = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
      var migiRowsAll = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : [])
        .filter(function (r) { return r.person === ttt; });
      var migiLatest = migiRowsAll.reduce(function (max, r) { return Math.max(max, _migiDonemNum(r.donem)); }, 0);
      var migiRows = migiRowsAll.filter(function (r) { return _migiDonemNum(r.donem) === migiLatest; });
      if (migiRows.length) {
        var miAvg = migiRows.reduce(function (s, r) { return s + (r.mi || 100); }, 0) / migiRows.length;
        var giAvg = migiRows.reduce(function (s, r) { return s + (r.bi || 100); }, 0) / migiRows.length;
        if (miAvg < 85 || giAvg < 85) {
          reasons.push('MI/GI düşük: MI=' + Math.round(miAvg) + ' GI=' + Math.round(giAvg));
          riskScore += 10;
        }
      }

      // intelligence risk-engine varsa ek riskler
      try {
        if (typeof detectRisks === 'function') {
          var detected = detectRisks(ttt) || [];
          var highCnt  = detected.filter(function (r) { return r.severity === 'HIGH'; }).length;
          if (highCnt >= 2) {
            reasons.push('Intelligence motorunda ' + highCnt + ' yüksek risk');
            riskScore += 10;
          }
        }
      } catch (e) { /* silent */ }

      // Sınıflandır
      var riskLevel;
      if (riskScore >= 40 || real < 70 || forecast < 91) {
        riskLevel = 'HIGH';
      } else if (riskScore >= 20 || real < 85 || forecast < 95) {
        riskLevel = 'MEDIUM';
      } else {
        riskLevel = 'LOW';
      }

      results.push({
        ttt:          ttt,
        risk:         riskLevel,
        reasons:      reasons,
        realization:  Math.round(real * 10) / 10,
        forecast:     Math.round(forecast * 10) / 10,
        riskScore:    riskScore
      });
    });

    // En riskli önce
    results.sort(function (a, b) { return b.riskScore - a.riskScore; });
    return results;
  }

  // ── getTeamRiskSummary ────────────────────────────────────
  // @param {Array} riskList  analyzeTeamRisk() çıktısı
  // @returns {{ high, medium, low, totalHigh, teamRiskLevel }}
  function getTeamRiskSummary(riskList) {
    if (!riskList || !riskList.length) return {};
    var high   = riskList.filter(function (r) { return r.risk === 'HIGH'; });
    var medium = riskList.filter(function (r) { return r.risk === 'MEDIUM'; });
    var low    = riskList.filter(function (r) { return r.risk === 'LOW'; });

    var teamRiskLevel = high.length >= 3 ? 'HIGH'
      : high.length >= 1 || medium.length >= 4 ? 'MEDIUM'
      : 'LOW';

    return {
      high:          high,
      medium:        medium,
      low:           low,
      totalHigh:     high.length,
      totalMedium:   medium.length,
      teamRiskLevel: teamRiskLevel
    };
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.analyzeTeamRisk     = analyzeTeamRisk;
  window.getTeamRiskSummary  = getTeamRiskSummary;

  console.debug('[team-risk-engine] Phase 4.0 yüklendi.');
})();
