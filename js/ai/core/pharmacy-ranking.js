// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/pharmacy-ranking.js
//  FAZ 8.1 — Tek Kanonik Sıralama (Single Source of Truth)
//
//  Sorumluluk: Dört ayrı buildTop30* fonksiyonunun (pharmacy-intelligence,
//  reorder-engine, reorder-classifier, pharmacy-data-manager) hepsinin
//  OKUYACAĞI TEK kanonik sıralama fonksiyonu.
//
//  DÖRT MOTORUN EN GÜÇLÜ BİLEŞENLERİ (ağırlıklandırılmış):
//    momentum     (%25): growthRate (ikinci yarı vs birinci yarı büyüme)
//    consistency  (%25): activeMonths / totalMonths oranı (düzenli alış)
//    opportunity  (%25): reorderProbability (sıradaki sipariş olasılığı)
//    urgency      (%25): daysToNextOrder'dan türetilen aciliyet skoru
//
//  Mevcut dört buildTop30* fonksiyonu SİLİNMEDİ — her biri artık
//  PharmacyRanking.rankPharmacies()'i çağırıp kendi eski şemasına
//  map'leyen ince bir wrapper'a dönüştü (geriye dönük API uyumluluğu —
//  hiçbir çağıran kod değişmedi).
//
//  Girdi: PharmacyAdapter (FAZ 6.0) ürettiği BİRLEŞİK PharmacyRecord +
//         PharmacyBehaviorEngine (FAZ 8.0 iskelet / FAZ 9.0 tam)
//
//  Public API:
//    rankPharmacies(tttFilter)  → RankedRecord[]  (canonicalScore'a göre azalan)
//    clearCache()
//
//  RankedRecord şeması (tüm buildTop30* wrapper'larının okuduğu ortak alanlar):
//    { gln, eczane, brick, representative, classification,
//      canonicalScore,     ← TEK kanonik sıralama skoru (0-100)
//      momentumScore,      ← büyüme bileşeni (0-100)
//      consistencyScore,   ← tutarlılık bileşeni (0-100)
//      opportunityScore,   ← reorder olasılığı bileşeni (0-100)
//      urgencyScore,       ← aciliyet bileşeni (0-100)
//      reorderProbability, avgMonthlyBoxes, totalBoxes,
//      activeMonths, growthRate, trendSlope,
//      forecastBoxes, forecastValue, score,
//      daysSinceLastOrder, avgOrderCycle, daysToNextOrder, expectedOrderDate,
//      consecutiveGrowthMonths, consecutiveDeclineMonths, consecutiveZeroMonths }
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._PHARMACY_RANKING_LOADED) {
    console.warn('[pharmacy-ranking] Zaten yüklü — atlandı');
    return;
  }
  window._PHARMACY_RANKING_LOADED = true;

  var _cache = {};

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  // ── _normMomentum — growthRate [-∞,+∞] → [0,100] ──────────────────
  // Büyüme 0 → 50 puan; her +20% → +10 puan (100 puan tavanı)
  function _normMomentum(growthRate) {
    var clamped = Math.max(-100, Math.min(100, growthRate || 0));
    return Math.round((clamped + 100) / 2);
  }

  // ── _normConsistency — aktif ay oranı [0,1] → [0,100] ─────────────
  function _normConsistency(activeMonths, totalMonths) {
    if (!totalMonths) return 0;
    return Math.round((activeMonths / totalMonths) * 100);
  }

  // ── _normOpportunity — reorderProbability [0,1] → [0,100] ─────────
  function _normOpportunity(reorderProbability) {
    return Math.round((reorderProbability || 0) * 100);
  }

  // ── _normUrgency — daysToNextOrder yakınlığı → [0,100] ────────────
  // Sipariş 0 gün uzakta → 100; 30 gün uzakta → 50; 60+ gün → 0
  function _normUrgency(daysToNextOrder) {
    var d = Math.max(0, daysToNextOrder != null ? daysToNextOrder : 60);
    return Math.round(Math.max(0, 100 - d * 100 / 60));
  }

  // ── rankPharmacies — ana fonksiyon ────────────────────────────────
  function rankPharmacies(tttFilter) {
    var cacheKey = tttFilter || '__all__';
    if (_cache[cacheKey]) return _cache[cacheKey];

    // PharmacyBehaviorEngine üzerinden profil al
    var profiles = _safe(function () {
      if (!window.PharmacyBehaviorEngine ||
          typeof window.PharmacyBehaviorEngine.buildBehaviorProfiles !== 'function') return null;
      return window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter);
    }, null);

    if (!profiles || !profiles.length) {
      // HOTFIX: ECZANE_RAW henüz yüklenmemiş olabilir (PharmacyDataManager async).
      // getCachedData() varsa senkron olarak çek ve tekrar dene.
      var _fallbackRows = _safe(function () {
        return window.PharmacyDataManager &&
               typeof window.PharmacyDataManager.getCachedData === 'function'
               ? window.PharmacyDataManager.getCachedData()
               : null;
      }, null);
      if (_fallbackRows && _fallbackRows.length) {
        if (typeof ECZANE_RAW !== 'undefined') {
          ECZANE_RAW   = _fallbackRows;
          eczaneLoaded = true;
        }
        profiles = _safe(function () {
          return window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter);
        }, null);
      }
      if (!profiles || !profiles.length) {
        console.warn('[pharmacy-ranking] PharmacyBehaviorEngine verisi yok — boş liste döndü');
        _cache[cacheKey] = [];
        return [];
      }
    }

    var ranked = profiles
      .filter(function (p) { return (p.totalBoxes || 0) > 0; })
      .map(function (p) {
        var totalMonths = (p.activeMonths || 0) + (p.inactiveMonths || 0);
        var mScore = _normMomentum(p.growthRate || 0);
        var cScore = _normConsistency(p.activeMonths || 0, totalMonths);
        var oScore = _normOpportunity(p.reorderProbability || 0);
        var uScore = _normUrgency(p.daysToNextOrder);
        var canonical = Math.round(mScore * 0.25 + cScore * 0.25 + oScore * 0.25 + uScore * 0.25);

        return {
          gln:                       p.gln,
          eczane:                    p.eczane,
          brick:                     p.brick,
          representative:            p.representative,
          classification:            p.classification,
          canonicalScore:            canonical,
          momentumScore:             mScore,
          consistencyScore:          cScore,
          opportunityScore:          oScore,
          urgencyScore:              uScore,
          reorderProbability:        p.reorderProbability,
          avgMonthlyBoxes:           p.avgMonthlyBoxes,
          totalBoxes:                p.totalBoxes,
          activeMonths:              p.activeMonths,
          inactiveMonths:            p.inactiveMonths,
          growthRate:                p.growthRate,
          trendSlope:                p.trendSlope,
          forecastBoxes:             p.forecastBoxes,
          forecastValue:             p.forecastValue,
          score:                     canonical, // eski 'score' alanıyla geriye dönük uyumluluk
          daysSinceLastOrder:        p.daysSinceLastOrder,
          avgOrderCycle:             p.avgOrderCycle,
          daysToNextOrder:           p.daysToNextOrder,
          expectedOrderDate:         p.expectedOrderDate,
          consecutiveGrowthMonths:   p.consecutiveGrowthMonths,
          consecutiveDeclineMonths:  p.consecutiveDeclineMonths,
          consecutiveZeroMonths:     p.consecutiveZeroMonths,
          historicalMaxBoxes:        p.historicalMaxBoxes,
          historicalMinBoxes:        p.historicalMinBoxes,
          productAffinityScore:      p.productAffinityScore,
          visitPriorityScore:        canonical, // eski alan adı geriye dönük uyumluluk
          nextOrderProducts:         p.nextOrderProducts || []
        };
      });

    ranked.sort(function (a, b) { return b.canonicalScore - a.canonicalScore; });

    _cache[cacheKey] = ranked;
    return ranked;
  }

  function clearCache() { _cache = {}; }

  window.PharmacyRanking = {
    rankPharmacies: rankPharmacies,
    clearCache:     clearCache,
    version:        '8.1'
  };

  console.debug('[pharmacy-ranking] FAZ 8.1 yüklendi — dört buildTop30* wrapper\'ın kanonik sıralama kaynağı.');

})();
