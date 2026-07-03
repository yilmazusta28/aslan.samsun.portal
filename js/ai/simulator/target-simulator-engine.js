// ══════════════════════════════════════════════════════════════════════
//  js/ai/simulator/target-simulator-engine.js
//  Phase 3.2 — Smart Target Simulator
//
//  Sorumluluk: Tek hedef noktası simülasyonu + olasılık hesabı
//    • simulateTarget(ttt, targetPercent) → hedef detay nesnesi
//    • calculateTargetProbability(ttt)    → { 91:%, 100:%, 110:%, 120:% }
//    • formatSimulatorForAI(results)      → AI prompt metni
//
//  Bağımlılık:
//    js/ai/predictive/runrate-engine.js  (calculateRunRate, _rrCurrentPeriod)
//    js/ai/predictive/forecast-engine.js (generateForecast)
//    js/data/data-state.js               (GENEL, IMS)
//    js/core/constants.js                (URUN_ORDER, URUN_AGIRLIK)
//    js/core/prim-calc.js                (getCarpan, calcPrimPuani)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, URUN_ORDER, URUN_AGIRLIK, IMS_TL_MAP,
          calculateRunRate, generateForecast, getCarpan, calcPrimPuani */

(function () {
  'use strict';

  // ── Yardımcılar ───────────────────────────────────────────

  function _getGenelTotal(ttt) {
    return (typeof GENEL !== 'undefined' ? GENEL : [])
      .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; }) || null;
  }

  function _getGenelRows(ttt) {
    return (typeof GENEL !== 'undefined' ? GENEL : [])
      .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
  }

  // Olasılık: run rate yeterliliği + döneme kalan süre + güven skorundan türetilir
  function _reachabilityProbability(requiredDaily, currentDaily, remainingDays, forecastReal, targetPct) {
    // Dönem bittiyse kesin sonuç
    if (remainingDays <= 0) {
      return forecastReal >= targetPct ? 99 : 1;
    }
    // Zaten üstündeyse
    if (forecastReal >= targetPct) return 97;

    if (currentDaily === 0) return 5;

    var ratio = requiredDaily / currentDaily;   // ne kadar ivme gerekiyor

    // Temel olasılık: run rate oranına göre
    var base;
    if      (ratio <= 1.00) base = 95;  // mevcut hız yeterli
    else if (ratio <= 1.05) base = 88;
    else if (ratio <= 1.10) base = 80;
    else if (ratio <= 1.15) base = 70;
    else if (ratio <= 1.25) base = 55;
    else if (ratio <= 1.40) base = 38;
    else if (ratio <= 1.60) base = 22;
    else if (ratio <= 2.00) base = 10;
    else                    base = 3;

    // Kalan gün bonusu/cezası: daha çok gün kaldıysa daha fazla şans
    var daysLeft = Math.min(remainingDays, 40);
    var daysBonus = (daysLeft / 40) * 8;  // max +8 puan

    return Math.min(98, Math.max(1, Math.round(base + daysBonus)));
  }

  // ── simulateTarget ────────────────────────────────────────
  // @param {string} ttt
  // @param {number} targetPercent  — 91 | 100 | 110 | 120 | herhangi
  // @returns {{
  //   target:              number,
  //   targetTL:            number,
  //   currentTL:           number,
  //   currentRealization:  number,
  //   salesGap:            number,
  //   requiredSales:       number,      — dönem sonuna kadar gereken ek TL
  //   requiredDailySales:  number,
  //   remainingDays:       number,
  //   achievable:          boolean,
  //   probability:         number,      — 0-100 %
  //   accelerationFactor:  number,      — kaç kat ivme gerekiyor
  //   primLabel:           string,
  //   note:                string
  // }}
  function simulateTarget(ttt, targetPercent) {
    var result = {
      target:             targetPercent,
      targetTL:           0,
      currentTL:          0,
      currentRealization: 0,
      salesGap:           0,
      requiredSales:      0,
      requiredDailySales: 0,
      remainingDays:      0,
      achievable:         false,
      probability:        0,
      accelerationFactor: null,
      primLabel:          '—',
      note:               'Veri yetersiz.'
    };

    try {
      var gt = _getGenelTotal(ttt);
      if (!gt) { result.note = 'GENEL veri bulunamadı.'; return result; }

      var currentTL  = gt.satis_tl  || 0;
      var hedefTL    = gt.hedef_tl  || 0;
      if (hedefTL === 0) { result.note = 'Hedef TL sıfır.'; return result; }

      var currentReal = (currentTL / hedefTL) * 100;
      var targetTL    = hedefTL * (targetPercent / 100);
      var salesGap    = Math.max(0, targetTL - currentTL);

      // Run rate
      var rr = (typeof calculateRunRate === 'function')
        ? calculateRunRate(ttt)
        : { dailyRunRate: 0, remainingDays: 0, projectedMonthEnd: 0 };

      var remainingDays    = rr.remainingDays   || 0;
      var dailyRunRate     = rr.dailyRunRate     || 0;
      var forecastReal     = rr.projectedMonthEnd > 0 && hedefTL > 0
        ? (rr.projectedMonthEnd / hedefTL) * 100 : currentReal;

      var requiredDaily    = remainingDays > 0
        ? Math.round(salesGap / remainingDays) : (salesGap > 0 ? Infinity : 0);

      var accelFactor = dailyRunRate > 0 && requiredDaily < Infinity
        ? Math.round((requiredDaily / dailyRunRate) * 100) / 100
        : null;

      var achievable = remainingDays === 0
        ? currentTL >= targetTL
        : (salesGap === 0 || (accelFactor !== null && accelFactor <= 2.0));

      var prob = _reachabilityProbability(
        requiredDaily, dailyRunRate, remainingDays, forecastReal, targetPercent
      );

      // Prim etiketi
      var primLabels = {
        120: 'Tam prim + bonus',
        110: 'Tam prim + üst dilim',
        100: 'Tam prim',
        91:  '1. prim eşiği',
        70:  'Kısmi prim'
      };
      var nearestPrim = [91, 100, 110, 120].reduce(function (prev, cur) {
        return Math.abs(cur - targetPercent) < Math.abs(prev - targetPercent) ? cur : prev;
      }, 91);
      var primLabel = primLabels[nearestPrim] || (targetPercent >= 91 ? 'Prim alınır' : 'Prim yok');

      // Açıklayıcı not
      var note;
      if (remainingDays <= 0) {
        note = 'Dönem kapandı. Sonuç: %' + currentReal.toFixed(1);
      } else if (salesGap === 0) {
        note = 'Zaten karşılandı (%' + currentReal.toFixed(1) + ').';
      } else if (!achievable) {
        note = 'Günlük ₺' + requiredDaily.toLocaleString('tr-TR') +
          ' gerekli — mevcut run rate ile ulaşmak çok zor (×' + (accelFactor || '?') + ').';
      } else {
        note = remainingDays + ' iş gününde günlük ₺' + requiredDaily.toLocaleString('tr-TR') +
          ' satışla (%×' + (accelFactor || '1') + ' ivme) ulaşılabilir.';
      }

      result.target             = targetPercent;
      result.targetTL           = Math.round(targetTL);
      result.currentTL          = Math.round(currentTL);
      result.currentRealization = Math.round(currentReal * 10) / 10;
      result.salesGap           = Math.round(salesGap);
      result.requiredSales      = Math.round(salesGap);
      result.requiredDailySales = requiredDaily === Infinity ? null : requiredDaily;
      result.remainingDays      = remainingDays;
      result.achievable         = achievable;
      result.probability        = prob;
      result.accelerationFactor = accelFactor;
      result.primLabel          = primLabel;
      result.note               = note;

    } catch (e) {
      console.warn('[target-simulator-engine] simulateTarget hata:', e.message);
      result.note = 'Hesaplama hatası: ' + e.message;
    }

    return result;
  }

  // ── calculateTargetProbability ────────────────────────────
  // @param {string} ttt
  // @param {number[]} [targets]  — varsayılan [91, 100, 110, 120]
  // @returns {{ 91: number, 100: number, 110: number, 120: number }}
  function calculateTargetProbability(ttt, targets) {
    var pts = targets || [91, 100, 110, 120];
    var result = {};
    pts.forEach(function (t) {
      var sim = simulateTarget(ttt, t);
      result[t] = sim.probability;
    });
    return result;
  }

  // ── formatSimulatorForAI ──────────────────────────────────
  // @param {object[]} sims   simulateTarget() sonuçları dizisi
  // @returns {string}
  function formatSimulatorForAI(sims) {
    if (!sims || !sims.length) return '';
    var lines = [];
    lines.push('');
    lines.push('=== HEDEF SİMÜLATÖR RAPORU (PHASE 3.2) ===');
    lines.push('');

    sims.forEach(function (s) {
      var icon  = s.probability >= 80 ? '🟢'
                : s.probability >= 50 ? '🟡' : '🔴';
      var daily = s.requiredDailySales
        ? '₺' + s.requiredDailySales.toLocaleString('tr-TR') + '/gün'
        : 'dönem bitti';
      var accel = s.accelerationFactor && s.accelerationFactor !== 1
        ? ' (run rate ×' + s.accelerationFactor + ')' : '';

      lines.push(icon + ' %' + s.target + ' [' + s.primLabel + '] — olasılık %' + s.probability);
      lines.push('  Gerekli günlük satış: ' + daily + accel);
      lines.push('  Satış açığı: ₺' + (s.salesGap || 0).toLocaleString('tr-TR'));
      lines.push('  Not: ' + s.note);
    });

    // En kolay ve en karlı hedef
    var sorted = sims.slice().sort(function (a, b) { return b.probability - a.probability; });
    if (sorted.length) {
      lines.push('');
      lines.push('En yüksek olasılıklı hedef : %' + sorted[0].target +
        ' (%' + sorted[0].probability + ' olasılık)');
    }
    var profitable = sims.slice().sort(function (a, b) { return b.target - a.target; })
      .find(function (s) { return s.achievable; });
    if (profitable) {
      lines.push('En karlı ulaşılabilir hedef: %' + profitable.target +
        ' [' + profitable.primLabel + ']');
    }

    lines.push('=== SİMÜLATÖR RAPORU SONU ===');
    return lines.join('\n');
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.simulateTarget             = simulateTarget;
  window.calculateTargetProbability = calculateTargetProbability;
  window.formatSimulatorForAI       = formatSimulatorForAI;

  console.debug('[target-simulator-engine] Phase 3.2 yüklendi.');

})();
