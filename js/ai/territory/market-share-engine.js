// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/market-share-engine.js
//  FAZ 6.3.5 — Market Share Engine (İskelet)
//  FAZ 8.0 — Kırık referans düzeltmesi: dosya yoktu, oluşturuldu
//
//  Sorumluluk: IMS verisinden brick/temsilci bazında pazar payı hesaplar.
//  competitive-impact-engine.js tarafından tüketilir (opsiyonel — yoksa
//  boş döner).
//
//  Public API:
//    analyzeMarketShare(ttt, brick) → MarketShareResult[]
//    shareTrend(ttt, brick)        → 'up'|'down'|'stable'
//    shareChangePct(ttt, brick)    → number
//
//  MarketShareResult:
//    { brick, ilacGrubu, ourShare, competitorShare, trend, changePct }
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._MARKET_SHARE_ENGINE_LOADED) {
    console.warn('[market-share-engine] Zaten yüklü — atlandı');
    return;
  }
  window._MARKET_SHARE_ENGINE_LOADED = true;

  var _cache = {};

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
  }

  // ── _getImsRecords — normalize IMS'i IMSAdapter üzerinden okur ────────
  function _getImsRecords(ttt) {
    return _safe(function () {
      if (!window.IMSAdapter || typeof window.IMSAdapter.normalizeIMS !== 'function') return [];
      return window.IMSAdapter.normalizeIMS(ttt) || [];
    }, []);
  }

  // ── analyzeMarketShare — brick bazında pazar payı ─────────────────────
  function analyzeMarketShare(ttt, brickFilter) {
    var cacheKey = (ttt || '__all__') + '|' + (brickFilter || '__all__');
    if (_cache[cacheKey]) return _cache[cacheKey];

    var records = _getImsRecords(ttt);
    if (!records.length) {
      _cache[cacheKey] = [];
      return [];
    }

    // brick × ürünGrubu bazlı toplam hesabı
    var brickMap = {};
    records.forEach(function (r) {
      if (brickFilter && r.brick !== brickFilter) return;
      var key = (r.brick || '') + '|' + (r.product || '');
      if (!brickMap[key]) {
        brickMap[key] = { brick: r.brick, ilacGrubu: r.product, ourTotal: 0, compTotal: 0, weeks: [] };
      }
      var entry = brickMap[key];
      // IMS kaydında kendi satışı total, rakip verisi ayrı yoksa total'ı baz alır
      entry.ourTotal += (r.total || 0);
    });

    var results = Object.keys(brickMap).map(function (k) {
      var e = brickMap[k];
      var total = e.ourTotal + e.compTotal;
      var ourShare   = total > 0 ? Math.round(e.ourTotal / total * 100) : 0;
      var compShare  = 100 - ourShare;
      return {
        brick:           e.brick,
        ilacGrubu:       e.ilacGrubu,
        ourShare:        ourShare,
        competitorShare: compShare,
        trend:           'stable',
        changePct:       0
      };
    });

    _cache[cacheKey] = results;
    return results;
  }

  // ── shareTrend / shareChangePct — competitive-impact-engine şeması ────
  function shareTrend(ttt, brick) {
    var results = analyzeMarketShare(ttt, brick);
    if (!results.length) return 'stable';
    return results[0].trend;
  }

  function shareChangePct(ttt, brick) {
    var results = analyzeMarketShare(ttt, brick);
    if (!results.length) return 0;
    return results[0].changePct;
  }

  function clearCache() { _cache = {}; }

  window.MarketShareEngine = {
    analyzeMarketShare: analyzeMarketShare,
    shareTrend:         shareTrend,
    shareChangePct:     shareChangePct,
    clearCache:         clearCache,
    version: '8.0-skeleton'
  };

  console.debug('[market-share-engine] FAZ 8.0 iskelet yüklendi.');

})();
