// ══════════════════════════════════════════════════════════════════════
//  js/ai/simulator/prim-simulator.js
//  Phase 3.2 — Smart Target Simulator
//
//  Sorumluluk: Farklı realizasyon senaryolarında prim hesabı
//    • simulatePrim(ttt, [scenarios]) → prim senaryo dizisi
//    • bestPrimScenario(ttt)          → en verimli senaryo
//    • formatPrimForAI(primList)      → AI prompt metni
//
//  Prim formülü (prim-calc.js'den):
//    tlRealPrim  = getCarpan(realPct) × BAZ_TL_REAL (55.000 ₺)
//    portfoyPrim = realPct>=91 && primPuani>=91 → 0.20 × BAZ_TL_REAL × carpan
//    migiPrim    = getMiGiKatsayi(mi, gi) × BAZ_MIGI (14.000 ₺)
//
//  Bağımlılık:
//    js/core/prim-calc.js   (getCarpan, getMiGiKatsayi, CARPAN_TABLE, URUN_AGIRLIK)
//    js/data/data-state.js  (GENEL, MIGI_TL_RAW)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, MIGI_TL_RAW, URUN_AGIRLIK, getCarpan, getMiGiKatsayi, calcPrimPuani */

(function () {
  'use strict';

  var BAZ_TL_REAL = 55000;
  var BAZ_MIGI    = 14000;

  // ── MI/GI ortalama bu TTT için ────────────────────────────
  // BUG DÜZELTMESİ: r.ttt → r.person, r.gi → r.bi (bkz. prim-calc.js'deki
  // aynı düzeltme notu — parseMiGiToplamCSV'nin gerçek şeması).
  // 2. DÜZELTME: MIGI_TL_RAW bir kişi için birden fazla ayın satırını
  // içerebilir — sadece EN GÜNCEL döneme ait satırlar kullanılıyor
  // (bkz. prim-calc.js'deki detaylı açıklama).
  var _migiDonemNum = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
  function _getMiGiAvg(ttt) {
    var allRows = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : [])
      .filter(function (r) { return r.person === ttt; });
    var latest = allRows.reduce(function (max, r) { return Math.max(max, _migiDonemNum(r.donem)); }, 0);
    var rows = allRows.filter(function (r) { return _migiDonemNum(r.donem) === latest; });
    if (!rows.length) return { mi: 100, gi: 100 };
    var miSum = rows.reduce(function (s, r) { return s + (r.mi || 100); }, 0);
    var giSum = rows.reduce(function (s, r) { return s + (r.bi || 100); }, 0);
    return {
      mi: Math.round(miSum / rows.length),
      gi: Math.round(giSum / rows.length)
    };
  }

  // ── Prim puanı için ürün realizasyonlarını ölçekle ────────
  // Genel TL realizasyonu = targetReal ise ürün realizasyonlarını
  // orantılı olarak ölçekleyerek prim puanını hesapla.
  function _scaledPrimPuani(ttt, targetReal) {
    var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
      .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    if (!genelTotal) return targetReal; // yaklaşık

    var currentReal = genelTotal.tl_pct || 0;
    var scaleFactor = currentReal > 0 ? targetReal / currentReal : 1;

    var urunRows    = (typeof GENEL !== 'undefined' ? GENEL : [])
      .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM' && r.urun !== 'DESTEVIT'; });

    var agirliklar  = (typeof URUN_AGIRLIK !== 'undefined') ? URUN_AGIRLIK : {};
    var total = 0;

    urunRows.forEach(function (r) {
      var urunReal   = Math.min((r.tl_pct || 0) * scaleFactor, 130);
      if (urunReal < 70) return;
      var agirlik    = (r.urun_agirlik > 0) ? r.urun_agirlik : (agirliklar[r.urun] || 0);
      total         += urunReal * agirlik;
    });

    return total;
  }

  // ── Tek senaryo prim hesabı ───────────────────────────────
  // @param {string} ttt
  // @param {number} targetReal  — hedef realizasyon % (91–130)
  // @returns {number} tahmini prim TL
  function _calcPrimForReal(ttt, targetReal) {
    if (targetReal < 91) return 0;

    var carpan      = (typeof getCarpan === 'function') ? getCarpan(targetReal) : 1;
    var migi        = _getMiGiAvg(ttt);
    var migiKatsayi = (typeof getMiGiKatsayi === 'function')
      ? getMiGiKatsayi(migi.mi, migi.gi) : 0;

    var primPuani   = _scaledPrimPuani(ttt, targetReal);

    var tlRealPrim  = carpan * BAZ_TL_REAL;
    var portfoyPrim = (targetReal >= 91 && primPuani >= 91)
      ? 0.20 * BAZ_TL_REAL * carpan : 0;
    var migiPrim    = migiKatsayi * BAZ_MIGI;

    return Math.round(tlRealPrim + portfoyPrim + migiPrim);
  }

  // ── simulatePrim ──────────────────────────────────────────
  // @param {string} ttt
  // @param {number[]} [scenarios]  — varsayılan [70,80,91,95,100,105,110,120]
  // @returns {Array<{
  //   realization: number,
  //   prim:        number,
  //   carpan:      number,
  //   primPuani:   number,
  //   hasMigi:     boolean,
  //   label:       string,
  //   highlight:   boolean   — şu anki real'e en yakın senaryo
  // }>}
  function simulatePrim(ttt, scenarios) {
    var pts = scenarios || [70, 80, 91, 95, 100, 105, 110, 120];
    var results = [];

    // Mevcut gerçekleşme
    var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
      .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    var currentReal = genelTotal ? (genelTotal.tl_pct || 0) : 0;

    pts.forEach(function (real) {
      var prim    = _calcPrimForReal(ttt, real);
      var carpan  = real >= 91 && typeof getCarpan === 'function' ? getCarpan(real) : 0;
      var puani   = real >= 91 ? _scaledPrimPuani(ttt, real) : 0;
      var migi    = _getMiGiAvg(ttt);
      var hasMigi = (typeof getMiGiKatsayi === 'function')
        ? getMiGiKatsayi(migi.mi, migi.gi) > 0 : false;

      var label   = real >= 120 ? 'Maks. Bonus'
        : real >= 110 ? 'Üst Dilim'
        : real === 100 ? 'Tam Prim'
        : real >= 91  ? '1.Eşik'
        : real >= 70  ? 'Kısmi'
        : 'Yok';

      // Gerçeğe en yakın senaryoyu işaretle
      var highlight = Math.abs(real - currentReal) === pts.reduce(function (min, p) {
        return Math.min(min, Math.abs(p - currentReal));
      }, Infinity);

      results.push({
        realization: real,
        prim:        prim,
        carpan:      Math.round(carpan * 100) / 100,
        primPuani:   Math.round(puani * 10) / 10,
        hasMigi:     hasMigi,
        label:       label,
        highlight:   highlight
      });
    });

    return results;
  }

  // ── bestPrimScenario ──────────────────────────────────────
  // En karlı VE ulaşılabilir senaryoyu döndürür.
  // @param {string} ttt
  // @returns {{ realization, prim, label, gap, requiredDailyExtra }}
  function bestPrimScenario(ttt) {
    var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
      .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    if (!gt) return null;

    var currentReal = gt.tl_pct || 0;
    var hedefTL     = gt.hedef_tl || 0;
    var currentTL   = gt.satis_tl || 0;

    // Run rate
    var rr = (typeof calculateRunRate === 'function')
      ? calculateRunRate(ttt) : { remainingDays: 0, dailyRunRate: 0 };

    var remaining   = rr.remainingDays  || 0;
    var dailyRate   = rr.dailyRunRate   || 0;

    // En yüksek ulaşılabilir senaryo (max ×1.5 run rate artışı)
    var candidates = [91, 100, 110, 120];
    var best = null;

    for (var i = candidates.length - 1; i >= 0; i--) {
      var t     = candidates[i];
      var tTL   = hedefTL * (t / 100);
      var gap   = Math.max(0, tTL - currentTL);
      var daily = remaining > 0 ? gap / remaining : (gap > 0 ? Infinity : 0);

      if (daily <= dailyRate * 1.5 || gap === 0) {
        best = {
          realization:         t,
          prim:                _calcPrimForReal(ttt, t),
          label:               t >= 110 ? 'Tam Prim + Üst Dilim' : t >= 100 ? 'Tam Prim' : '1. Prim Eşiği',
          gap:                 Math.round(gap),
          requiredDailyExtra:  Math.round(Math.max(0, daily - dailyRate))
        };
        break;
      }
    }

    return best;
  }

  // ── formatPrimForAI ───────────────────────────────────────
  // @param {Array}  primList  simulatePrim() çıktısı
  // @param {object} [best]    bestPrimScenario() çıktısı
  // @returns {string}
  function formatPrimForAI(primList, best) {
    if (!primList || !primList.length) return '';
    var lines = [];
    lines.push('');
    lines.push('PRİM SENARYO ANALİZİ:');

    primList.filter(function (s) { return s.realization >= 91; }).forEach(function (s) {
      var mark  = s.highlight ? ' ◀ mevcut' : '';
      var prim  = s.prim > 0 ? '₺' + s.prim.toLocaleString('tr-TR') : '₺0';
      lines.push('  ' + s.realization + '% [' + s.label + ']: ' + prim + mark);
    });

    if (best) {
      lines.push('');
      lines.push('En karlı ulaşılabilir hedef: %' + best.realization +
        ' → ₺' + best.prim.toLocaleString('tr-TR') + ' [' + best.label + ']');
      if (best.requiredDailyExtra > 0) {
        lines.push('Günlük ek satış ihtiyacı: +₺' + best.requiredDailyExtra.toLocaleString('tr-TR'));
      }
    }

    return lines.join('\n');
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.simulatePrim      = simulatePrim;
  window.bestPrimScenario  = bestPrimScenario;
  window.formatPrimForAI   = formatPrimForAI;

  console.debug('[prim-simulator] Phase 3.2 yüklendi.');

})();
