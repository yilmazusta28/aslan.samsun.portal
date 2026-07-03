// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/launch-readiness-engine.js
//  FAZ 6.4.5 — Lansman Hazırlık Modülü (İskelet)
//  FAZ 8.0 — Kırık referans düzeltmesi: dosya yoktu, oluşturuldu
//
//  Sorumluluk: FAMTREC gibi IMS satışı henüz olmayan ("lansman öncesi")
//  pazarlar için rakip şartlarını ve hazırlık özetini üretir.
//  decision-engine.js'in LAUNCH_PREP problemType'ı tarafından tüketilir
//  (opsiyonel — yoksa o dal atlanır).
//
//  Public API:
//    listOnLansmanPazarlar()            → string[] (pazar/grup adı listesi)
//    getLaunchReadinessSummary(pazar)   → LaunchReadinessSummary
//
//  LaunchReadinessSummary:
//    { pazar, competitorCount, strongestCompetitor, avgCompetitorTier,
//      ourReadinessScore, recommendation }
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._LAUNCH_READINESS_ENGINE_LOADED) {
    console.warn('[launch-readiness-engine] Zaten yüklü — atlandı');
    return;
  }
  window._LAUNCH_READINESS_ENGINE_LOADED = true;

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  // ── listOnLansmanPazarlar — IMS'de satışı sıfır olan pazarları bulur ─
  function listOnLansmanPazarlar() {
    return _safe(function () {
      if (!window.IMSAdapter || typeof window.IMSAdapter.normalizeIMS !== 'function') return [];
      var records = window.IMSAdapter.normalizeIMS() || [];
      // Toplam IMS sıfır olan gruplar "lansman öncesi" kabul edilir
      var pazarTotals = {};
      records.forEach(function (r) {
        var g = r.product || '';
        pazarTotals[g] = (pazarTotals[g] || 0) + (r.total || 0);
      });
      return Object.keys(pazarTotals).filter(function (p) { return pazarTotals[p] === 0; });
    }, []);
  }

  // ── getLaunchReadinessSummary — pazar başına hazırlık özeti ──────────
  function getLaunchReadinessSummary(pazar) {
    return _safe(function () {
      var competitors = [];
      if (window.CompetitiveAdapter && typeof window.CompetitiveAdapter.normalizeCompetitive === 'function') {
        var compData = window.CompetitiveAdapter.normalizeCompetitive();
        var actions  = (compData && compData.competitorActions) || [];
        competitors  = actions.filter(function (a) { return a.ilacGrubu === pazar && !a.isOwn; });
      }

      var strongest = competitors.reduce(function (best, a) {
        var tier = (a.standart && a.standart[0]) || {};
        return (!best || (tier.min || 0) > (best.min || 0)) ? { firma: a.firma, min: tier.min || 0 } : best;
      }, null);

      return {
        pazar:               pazar,
        competitorCount:     competitors.length,
        strongestCompetitor: strongest ? strongest.firma : null,
        avgCompetitorTier:   null,
        ourReadinessScore:   competitors.length === 0 ? 100 : Math.max(0, 80 - competitors.length * 5),
        recommendation:      competitors.length > 3
          ? 'Rakip yoğun pazar — giriş için güçlü kampanya gerekli'
          : 'Pazar hazırlık aşamasında — fırsat mevcut'
      };
    }, {
      pazar: pazar, competitorCount: 0, strongestCompetitor: null,
      avgCompetitorTier: null, ourReadinessScore: 50, recommendation: 'Veri yetersiz'
    });
  }

  window.LaunchReadinessEngine = {
    listOnLansmanPazarlar:     listOnLansmanPazarlar,
    getLaunchReadinessSummary: getLaunchReadinessSummary,
    version: '8.0-skeleton'
  };

  console.debug('[launch-readiness-engine] FAZ 8.0 iskelet yüklendi.');

})();
