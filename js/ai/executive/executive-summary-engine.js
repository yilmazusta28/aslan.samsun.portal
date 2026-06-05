// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/executive-summary-engine.js
//  Phase 4.0 + 4.1 — Executive Dashboard AI
//
//  Sorumluluk: Yönetici özet raporu + yönetim görüşleri
//    • generateExecutiveSummary(ranking, risks, forecast) → özet nesne
//    • generateManagementInsights(summary)                → string[]
//
//  Bağımlılık:
//    js/ai/executive/team-ranking-engine.js  (buildTeamRanking)
//    js/ai/executive/team-risk-engine.js     (analyzeTeamRisk)
//    js/ai/executive/team-forecast-engine.js (buildTeamForecast)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global buildTeamRanking, analyzeTeamRisk, buildTeamForecast,
          getManagementCategories, getTeamRiskSummary */

(function () {
  'use strict';

  // ── generateExecutiveSummary ──────────────────────────────
  // @param {Array}  [ranking]   buildTeamRanking() — opsiyonel, hesaplanır
  // @param {Array}  [risks]     analyzeTeamRisk()  — opsiyonel
  // @param {object} [forecast]  buildTeamForecast() — opsiyonel
  // @returns {{
  //   topPerformer, bottomPerformer,
  //   biggestRisk, biggestOpportunity,
  //   teamForecast, teamPrim, teamRiskLevel,
  //   top5, bottom5, forecastWinners, forecastLosers,
  //   highRisk, primLeaders, categories
  // }}
  function generateExecutiveSummary(ranking, risks, forecast) {
    var r   = ranking  || (typeof buildTeamRanking  === 'function' ? buildTeamRanking()  : []);
    var ri  = risks    || (typeof analyzeTeamRisk   === 'function' ? analyzeTeamRisk()   : []);
    var fc  = forecast || (typeof buildTeamForecast === 'function' ? buildTeamForecast() : {});
    var cats = typeof getManagementCategories === 'function' ? getManagementCategories(r)  : {};
    var riskSummary = typeof getTeamRiskSummary === 'function' ? getTeamRiskSummary(ri) : {};

    if (!r.length) return { topPerformer: '—', bottomPerformer: '—' };

    var sorted = r.slice().sort(function (a, b) { return b.realization - a.realization; });

    // Forecast sıraları
    var fcSorted = r.slice().sort(function (a, b) { return b.forecast - a.forecast; });

    return {
      topPerformer:      sorted[0]   ? sorted[0].ttt   : '—',
      bottomPerformer:   sorted[sorted.length - 1] ? sorted[sorted.length - 1].ttt : '—',
      biggestRisk:       ri[0]       ? ri[0].ttt        : '—',
      biggestOpportunity: (cats.hiddenOpportunities && cats.hiddenOpportunities[0])
                          ? cats.hiddenOpportunities[0].ttt : (fcSorted[0] ? fcSorted[0].ttt : '—'),

      // Ekip metrikleri
      teamForecast:   fc.teamForecast  || 0,
      teamPrim:       fc.projectedPrim || 0,
      teamRiskLevel:  riskSummary.teamRiskLevel || 'LOW',
      repsAbove91:    fc.repsAbove91   || 0,
      repsBelow91:    fc.repsBelow91   || 0,
      totalReps:      r.length,

      // Listeler
      top5:            sorted.slice(0, 5),
      bottom5:         sorted.slice(-5).reverse(),
      forecastWinners: fcSorted.slice(0, 5),
      forecastLosers:  fcSorted.slice(-5).reverse(),
      highRisk:        riskSummary.high || [],
      primLeaders:     cats.primLeaders  || [],

      // Kategoriler
      categories: cats,
      riskSummary: riskSummary
    };
  }

  // ── generateManagementInsights ────────────────────────────
  // @param {object} summary  generateExecutiveSummary() çıktısı
  // @returns {string[]}  — yönetici için somut, sayısal içgörüler
  function generateManagementInsights(summary) {
    if (!summary) return [];
    var insights = [];

    // Ekip genel durumu
    if (summary.teamForecast >= 100) {
      insights.push('🏆 Ekip forecast %100 üzerinde (' + summary.teamForecast.toFixed(1) + '%) — mükemmel gidiş.');
    } else if (summary.teamForecast >= 91) {
      insights.push('✅ Ekip forecast %91 eşiğini karşılıyor (' + summary.teamForecast.toFixed(1) + '%).');
    } else {
      insights.push('🔴 Ekip forecast %91 altında (' + summary.teamForecast.toFixed(1) + '%) — acil müdahale gerekli.');
    }

    // Risk sayısı
    if (summary.repsBelow91 > 0) {
      insights.push(summary.repsBelow91 + ' temsilci %91 eşiğinin altında forecast gösteriyor.');
    }

    // En iyi performans
    if (summary.top5 && summary.top5[0]) {
      var top = summary.top5[0];
      insights.push('Lider: ' + top.ttt + ' — %' + top.realization + ' realizasyon, forecast %' + top.forecast + '.');
    }

    // En düşük performans
    if (summary.bottom5 && summary.bottom5[0]) {
      var bot = summary.bottom5[0];
      insights.push('Dikkat: ' + bot.ttt + ' — %' + bot.realization + ' realizasyon, forecast %' + bot.forecast + '.');
    }

    // Yüksek riskler
    if (summary.highRisk && summary.highRisk.length) {
      insights.push('🔴 ' + summary.highRisk.length + ' temsilci yüksek risk: ' +
        summary.highRisk.slice(0, 3).map(function (r) { return r.ttt.split(' ')[0]; }).join(', ') + '.');
    }

    // Rising stars
    if (summary.categories && summary.categories.risingStars && summary.categories.risingStars.length) {
      insights.push('🚀 Yükselen yıldızlar: ' +
        summary.categories.risingStars.slice(0, 3).map(function (r) { return r.ttt.split(' ')[0]; }).join(', ') + '.');
    }

    // Prim tahmini
    if (summary.teamPrim > 0) {
      insights.push('Ekip toplam tahmini prim: ₺' + summary.teamPrim.toLocaleString('tr-TR') + '.');
    }

    // Forecast winners / losers
    if (summary.forecastWinners && summary.forecastWinners[0] && summary.forecastWinners[0].forecast >= 100) {
      insights.push('Forecast lideri: ' + summary.forecastWinners[0].ttt.split(' ')[0] +
        ' — dönem sonu %' + summary.forecastWinners[0].forecast + ' öngörüsü.');
    }

    return insights;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.generateExecutiveSummary  = generateExecutiveSummary;
  window.generateManagementInsights = generateManagementInsights;

  console.debug('[executive-summary-engine] Phase 4.0 yüklendi.');
})();
