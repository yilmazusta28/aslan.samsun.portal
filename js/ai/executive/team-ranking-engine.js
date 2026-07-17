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
  // Son haftaların trendine göre büyüme puanı (0-100)
  // BUG DÜZELTMESİ: eski kod r.hafta / r.own_tl alanlarını okuyordu ama
  // IMS satırlarında bu alanlar hiç yok (bkz. js/data/csv-parser.js
  // parseIMSCSV → alanlar: h1..h9, toplam, toplam_ppi, is_mkt). Bu yüzden
  // wMap hep boş kalıyor, wVals.length her zaman 0 oluyor ve fonksiyon
  // sessizce herkese aynı nötr "50" puanını veriyordu — ekrandaki
  // "Büyüme" sütununun herkeste aynı görünmesinin kök nedeni buydu.
  // Düzeltme: kendi ürünlerine ait (is_mkt:false) haftalık h1..h9 KUTU
  // kolonları toplanarak gerçek haftalık trend hesaplanıyor. (Not: IMS
  // satırlarında gerçek bir TL alanı yoktur, sadece kutu hacmi vardır —
  // bkz. docs/AI_MIMARI_STABILIZASYON_RAPORU.md. Hesaplama zaten baştan
  // beri birim-tutarlıydı çünkü sadece IMS'in kendi kutu kolonlarını
  // birbiriyle kıyaslıyor; bu sadece bir yorum/etiket düzeltmesidir.)
  function _growthScore(ttt) {
    var imsRows = (IMS || []).filter(function (r) { return r.ttt === ttt && !r.is_mkt; });
    if (!imsRows.length) return 50; // veri yoksa nötr

    var weekKeys = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'];
    var weekSums = weekKeys.map(function (k) {
      return imsRows.reduce(function (s, r) { return s + (r[k] || 0); }, 0);
    });

    // En son dolu (>0) haftayı bul, ondan öncesini kullan
    var lastFilled = 0;
    for (var i = weekSums.length - 1; i >= 0; i--) {
      if (weekSums[i] > 0) { lastFilled = i + 1; break; }
    }
    if (lastFilled < 2) return 50; // en az 2 hafta veri yoksa nötr

    var wVals = weekSums.slice(0, lastFilled);
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
  // BUG DÜZELTMESİ: eski kod ownTot (is_mkt:false satırların "toplam"ı)
  // ile mktTot (is_mkt:true satırların "toplam"ı) değerlerini FARKLI
  // ürün/molekülleri karıştırarak topluyordu (kutu adedi + TL karışık,
  // farklı moleküllerin pazar büyüklükleri çok farklı ölçeklerde). Bu,
  // her temsilci için PPI'yi aynı büyük moleküle doğru sıkıştırıp
  // "Pazar Payı" sütununun herkeste birbirine çok yakın/aynı görünmesine
  // yol açıyordu. Doğru yöntem — manager-panel-engine.js'de zaten
  // kullanılan yöntemle aynı — IMS_TABLO'nun her satırında HAZIR gelen
  // "TOPLAM PPI%" (toplam_ppi) kolonunu (kendi ürünleri, is_mkt:false)
  // ortalamaktır; bu alan zaten doğru brick/ürün bazlı pazar payı %'sini
  // içeriyor, ham TL/kutu toplamlarından yeniden hesaplamaya gerek yok.
  function _marketShareScore(ttt) {
    var imsRows = (IMS || []).filter(function (r) {
      return r.ttt === ttt && !r.is_mkt && r.toplam_ppi != null && !isNaN(r.toplam_ppi);
    });
    if (!imsRows.length) return 50;

    var avgPpi = imsRows.reduce(function (s, r) { return s + (r.toplam_ppi || 0); }, 0) / imsRows.length;
    // Map 0–50% pazar payı → 0–100 skor
    return Math.round(Math.min(100, Math.max(0, avgPpi * 2)));
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
