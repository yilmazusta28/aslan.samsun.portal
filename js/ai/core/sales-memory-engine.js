// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/sales-memory-engine.js
//  FAZ 9.1 — Sales Memory Engine
//
//  Sorumluluk: Eczanenin SATIN ALMA HAFIZASINI öğrenir.
//  NOT: sales-conditions.js (firma promosyon şartları) ile KARIŞTIRILMAMALI.
//
//  Girdi: PharmacyAdapter.normalizePharmacy() ürettiği PharmacyRecord
//         + PharmacyBehaviorEngine (FAZ 9.0) profil alanları
//         + competitive-adapter (rakip etkisi)
//
//  Bu motorun çıktısı DOĞRUDAN FAZ 9.4 Digital Twin Builder tarafından
//  tüketilecek. ai-context-builder.js'e ayrı alan olarak EKLENMİYOR
//  (Digital Twin tek giriş noktası — çoğullaşmayı önler).
//
//  Public API:
//    getSalesMemory(eczane, tttFilter?) → SalesMemory | null
//
//  SalesMemory şeması:
//    { eczane, avgMonthlyConsumption, avgMonthlyConsumptionAdjusted,
//      orderCycleDays, campaignBehavior, zamBehavior, seasonality,
//      repInfluence, competitorInfluence, lastUpdated }
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._SALES_MEMORY_ENGINE_LOADED) {
    console.warn('[sales-memory-engine] Zaten yüklü — atlandı');
    return;
  }
  window._SALES_MEMORY_ENGINE_LOADED = true;

  var _cache = {};

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  // ── _avgConsumptionAdjusted — boş-ay-düzeltmeli ortalama ────────────
  // Boş aylar (sıfır) ÇIKARILARAK hesaplanır (FAZ 10.0 metodolojisi).
  // campaign spike ayları da çıkarılır.
  function _avgConsumptionAdjusted(vals) {
    if (!vals || !vals.length) return 0;
    var nonZero = vals.filter(function (v) { return v > 0; });
    if (!nonZero.length) return 0;
    var mean = nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length;
    // Spike ay filtresi: ortalamanın 2.5 katından büyükse campaign spike
    var filtered = nonZero.filter(function (v) { return v <= mean * 2.5; });
    if (!filtered.length) filtered = nonZero;
    return Math.round(filtered.reduce(function (s, v) { return s + v; }, 0) / filtered.length * 10) / 10;
  }

  // ── _orderCycle — aktif aylardan ortalama sipariş aralığı ────────────
  function _orderCycle(sortedMonths, vals) {
    if (!sortedMonths || sortedMonths.length < 2) return null;
    // PharmacyBehaviorEngine varsa onun hesabını kullan
    return null; // Digital Twin'de PharmacyBehaviorEngine'den okunacak
  }

  // ── _competitorInfluence — competitive-adapter çapraz kontrolü ───────
  function _competitorInfluence(eczane) {
    return _safe(function () {
      if (!window.CompetitiveAdapter || typeof window.CompetitiveAdapter.normalizeCompetitive !== 'function') return null;
      var data = window.CompetitiveAdapter.normalizeCompetitive();
      if (!data || !data.competitorActions || !data.competitorActions.length) return null;
      // Eczane brick'ini bul
      var rec = null;
      if (window.PharmacyAdapter && typeof window.PharmacyAdapter.normalizePharmacy === 'function') {
        var records = window.PharmacyAdapter.normalizePharmacy();
        rec = records.find(function (r) { return r.eczane === eczane; });
      }
      var activeCompetitors = data.competitorActions.filter(function (a) { return !a.isOwn && a.kampanya; });
      return {
        hasActiveCompetitorCampaign: activeCompetitors.length > 0,
        competitorCount: activeCompetitors.length,
        note: activeCompetitors.length > 0
          ? activeCompetitors.length + ' rakip aktif kampanyada' : 'Rakip kampanya yok'
      };
    }, null);
  }

  // ── getSalesMemory — ana fonksiyon ────────────────────────────────────
  function getSalesMemory(eczane, tttFilter) {
    if (!eczane) return null;
    var cacheKey = eczane + '|' + (tttFilter || '');
    if (_cache[cacheKey]) return _cache[cacheKey];

    if (!window.PharmacyAdapter || typeof window.PharmacyAdapter.normalizePharmacy !== 'function') return null;

    var records = window.PharmacyAdapter.normalizePharmacy(tttFilter);
    var rec = records.find(function (r) { return r.eczane === eczane || r.gln === eczane; });
    if (!rec) return null;

    var vals = window.PharmacyAdapter.monthValuesArray(rec.months, rec.sortedMonths);
    var nonZero = vals.filter(function (v) { return v > 0; });
    var avgRaw  = nonZero.length > 0 ? nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length : 0;
    var avgAdj  = _avgConsumptionAdjusted(vals);

    // PharmacyBehaviorEngine'den ek veriler
    var behaviorProfile = null;
    if (window.PharmacyBehaviorEngine && typeof window.PharmacyBehaviorEngine.buildBehaviorProfiles === 'function') {
      var profiles = window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter);
      behaviorProfile = profiles.find(function (p) { return p.eczane === eczane || p.gln === eczane; });
    }

    // fieldObservations'tan zam davranışı (FAZ 7.0)
    var zamBehavior = _safe(function () {
      if (!window.SahaGozlemStore || typeof window.SahaGozlemStore.getByEczane !== 'function') return null;
      var obs = window.SahaGozlemStore.getByEczane(eczane);
      var zamObs = (obs || []).filter(function (o) { return o.kategori === 'FIYAT'; });
      return zamObs.length > 0 ? { observationCount: zamObs.length, notes: zamObs.map(function (o) { return o.not; }) } : null;
    }, null);

    var memory = {
      eczane:                      eczane,
      gln:                         rec.gln,
      avgMonthlyConsumption:       Math.round(avgRaw * 10) / 10,
      avgMonthlyConsumptionAdjusted: avgAdj,
      orderCycleDays:              behaviorProfile ? behaviorProfile.avgOrderCycle : null,
      campaignBehavior:            behaviorProfile ? behaviorProfile.behaviorType : null,
      zamBehavior:                 zamBehavior,
      seasonality:                 behaviorProfile ? {
        isSeasonalCandidate: (rec.sortedMonths || []).length >= 12,
        type: behaviorProfile.behaviorType === 'MEVSIMSEL' ? 'confirmed' : 'unknown'
      } : null,
      repInfluence:                null, // FAZ 9.2 CoverageSelection'dan — şimdilik null
      competitorInfluence:         _competitorInfluence(eczane),
      lastUpdated:                 new Date().toISOString()
    };

    _cache[cacheKey] = memory;
    return memory;
  }

  function clearCache() { _cache = {}; }

  window.SalesMemoryEngine = {
    getSalesMemory: getSalesMemory,
    clearCache:     clearCache,
    version:        '9.1'
  };

  console.debug('[sales-memory-engine] FAZ 9.1 yüklendi.');

})();
