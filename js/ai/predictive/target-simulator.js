// ══════════════════════════════════════════════════════════════════════
//  js/ai/predictive/target-simulator.js
//  Phase 3.1 — Predictive Forecast Engine
//
//  Sorumluluk: Hedef senaryo simülasyonu
//    • simulateTargets(ttt) → senaryo[]
//
//  Senaryolar: %91, %100, %110, %120
//  Her senaryo için:
//    - ulaşılabilir mi?
//    - gereken günlük TL satış nedir?
//    - kalan süre yeterli mi?
//    - prim durumu ne olur?
//
//  Bağımlılık:
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//    js/data/data-state.js               (GENEL)
//    js/core/constants.js                (URUN_ORDER)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, URUN_ORDER, calculateRunRate */

(function () {
  'use strict';

  // ── Prim açıklaması ───────────────────────────────────────
  // Şirket primlerini kategorize eden yardımcı
  function _primLabel(realPct) {
    if (realPct >= 120) return 'Tam prim + bonus';
    if (realPct >= 110) return 'Tam prim + üst dilim';
    if (realPct >= 100) return 'Tam prim';
    if (realPct >=  91) return '1. prim eşiği';
    if (realPct >=  70) return 'Kısmi prim';
    return 'Prim yok';
  }

  // ── Zorluk seviyesi ───────────────────────────────────────
  function _difficulty(requiredDailyRate, currentDailyRate) {
    if (currentDailyRate === 0) return 'belirsiz';
    var ratio = requiredDailyRate / currentDailyRate;
    if (ratio <= 1.00) return 'kolay';       // mevcut hız zaten yeterli
    if (ratio <= 1.10) return 'makul';       // %10'a kadar artış gerekli
    if (ratio <= 1.25) return 'zorlu';       // %10-25 artış
    if (ratio <= 1.50) return 'çok zorlu';   // %25-50 artış
    return 'neredeyse imkânsız';             // >%50 artış
  }

  // ── simulateTargets ───────────────────────────────────────
  // @param {string} ttt
  // @param {number[]} [scenarios]  hedef yüzdeleri — varsayılan [91,100,110,120]
  // @returns {Array<{
  //   target:              number,  // hedef %
  //   targetTL:            number,  // hedef TL karşılığı
  //   requiredAdditional:  number,  // ek gereken TL (kalan sürede)
  //   requiredDailySales:  number,  // günlük gereken ek TL
  //   reachable:           boolean,
  //   difficulty:          string,
  //   primLabel:           string,
  //   accelerationNeeded:  number,  // mevcut run rate'e göre kaç kat artış
  //   note:                string
  // }>}
  function simulateTargets(ttt, scenarios) {
    var targets = scenarios || [91, 100, 110, 120];
    var results = [];

    try {
      // ── Temel veriler ─────────────────────────────────────
      var rr = (typeof calculateRunRate === 'function')
        ? calculateRunRate(ttt)
        : { projectedMonthEnd: 0, dailyRunRate: 0, remainingDays: 0, projectedRealization: 0 };

      var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      var currentTL     = genelTotal ? (genelTotal.satis_tl || 0) : 0;
      var hedefTL       = genelTotal ? (genelTotal.hedef_tl  || 0) : 0;
      var currentReal   = hedefTL > 0 ? (currentTL / hedefTL) * 100 : 0;
      var dailyRunRate  = rr.dailyRunRate   || 0;
      var remainingDays = rr.remainingDays  || 0;

      if (hedefTL === 0) {
        targets.forEach(function (t) {
          results.push({
            target: t, targetTL: 0, requiredAdditional: 0,
            requiredDailySales: 0, reachable: false,
            difficulty: 'belirsiz', primLabel: _primLabel(0),
            accelerationNeeded: 0, note: 'Hedef TL verisi bulunamadı.'
          });
        });
        return results;
      }

      targets.forEach(function (targetPct) {
        var targetTL           = hedefTL * (targetPct / 100);
        var requiredAdditional = Math.max(0, targetTL - currentTL);
        var requiredDaily      = remainingDays > 0
          ? Math.round(requiredAdditional / remainingDays)
          : (requiredAdditional > 0 ? Infinity : 0);

        // Ulaşılabilir: kalan günde gerekli günlük satış mevcut run rate'in 2×'inden az mı?
        var maxFeasibleDaily = dailyRunRate * 2.0;
        var reachable = remainingDays > 0 &&
          (requiredAdditional === 0 || requiredDaily <= maxFeasibleDaily);

        // Dönem zaten bittiyse
        if (remainingDays === 0) {
          reachable = currentTL >= targetTL;
        }

        var accelerationNeeded = dailyRunRate > 0
          ? Math.round((requiredDaily / dailyRunRate) * 100) / 100
          : null;

        var diff = _difficulty(requiredDaily, dailyRunRate);

        // Açıklayıcı not
        var note;
        if (currentReal >= targetPct) {
          note = 'Zaten karşılandı (%' + currentReal.toFixed(1) + ')';
        } else if (remainingDays === 0) {
          note = 'Dönem bitti — sonuç: %' + currentReal.toFixed(1);
        } else if (!reachable) {
          note = 'Günlük ₺' + requiredDaily.toLocaleString('tr-TR') +
            ' satış gerekli — mevcut run rate ₺' + dailyRunRate.toLocaleString('tr-TR') +
            ' ile ulaşılamaz.';
        } else {
          note = remainingDays + ' iş günüde günlük ₺' + requiredDaily.toLocaleString('tr-TR') +
            ' satışla (%' + targetPct + ') ulaşılabilir.';
        }

        results.push({
          target:             targetPct,
          targetTL:           Math.round(targetTL),
          requiredAdditional: Math.round(requiredAdditional),
          requiredDailySales: requiredDaily === Infinity ? null : requiredDaily,
          reachable:          reachable,
          difficulty:         diff,
          primLabel:          _primLabel(targetPct),
          accelerationNeeded: accelerationNeeded,
          note:               note
        });
      });

    } catch (e) {
      console.warn('[target-simulator] simulateTargets hata:', e.message);
    }

    return results;
  }

  // ── formatTargetsForAI ────────────────────────────────────
  // Senaryo sonuçlarını AI prompt metnine çevirir.
  // @param {Array} scenarios  simulateTargets() çıktısı
  // @returns {string}
  function formatTargetsForAI(scenarios) {
    if (!scenarios || !scenarios.length) return '';
    var lines = [];
    lines.push('');
    lines.push('HEDEF SENARYO SİMÜLASYONU:');
    scenarios.forEach(function (s) {
      var icon = s.reachable ? '✅' : '❌';
      var acc  = s.accelerationNeeded !== null
        ? ' (run rate × ' + s.accelerationNeeded + ')' : '';
      lines.push('  ' + icon + ' %' + s.target + ' [' + s.primLabel + ']: ' + s.note + acc);
    });
    return lines.join('\n');
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.simulateTargets   = simulateTargets;
  window.formatTargetsForAI = formatTargetsForAI;
  console.debug('[target-simulator] Phase 3.1 yüklendi.');

})();
