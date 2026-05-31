// ══════════════════════════════════════════════════════════════════════
//  js/ai/coach/goal-coach.js
//  Phase 3.4 — AI Sales Coach
//
//  Sorumluluk: Hedefe ulaşma yol haritası + adım planı
//    • generateGoalPlan(ttt) → { dailyReq, weeklyReq, gap, steps[], milestones[] }
//
//  Yanıtladığı soru:
//    "Bugün ne kadar satmalıyım?"
//    "Haftaya kadar ne kadar kazanabilirim?"
//    "Hangi ürüne odaklanmalıyım?"
//
//  Bağımlılık:
//    js/data/data-state.js               (GENEL, KUTU)
//    js/core/constants.js                (URUN_ORDER, IMS_TL_MAP, URUN_AGIRLIK)
//    js/core/prim-calc.js                (getCarpan)
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//    js/ai/simulator/target-simulator-engine.js (simulateTarget)
//    js/ai/simulator/prim-simulator.js   (bestPrimScenario)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, KUTU, URUN_ORDER, IMS_TL_MAP, URUN_AGIRLIK,
          calculateRunRate, simulateTarget, bestPrimScenario, getCarpan */

(function () {
  'use strict';

  // ── generateGoalPlan ──────────────────────────────────────
  // @param {string} ttt
  // @param {number} [primaryTarget]  — simüle edilecek ana hedef (varsayılan: en düşük ulaşılabilir)
  // @returns {{
  //   primaryTarget:  number,
  //   dailyReq:       number,
  //   weeklyReq:      number,
  //   gap:            number,
  //   remainingDays:  number,
  //   steps:          Array<{order, step, detail, urgency}>,
  //   milestones:     Array<{days, label, targetTL, note}>,
  //   productFocus:   Array<{product, reason, dailyExtra}>,
  //   primRoadmap:    object|null
  // }}
  function generateGoalPlan(ttt, primaryTarget) {
    var result = {
      primaryTarget: primaryTarget || 91,
      dailyReq:      0,
      weeklyReq:     0,
      gap:           0,
      remainingDays: 0,
      steps:         [],
      milestones:    [],
      productFocus:  [],
      primRoadmap:   null
    };

    try {
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (!gt) return result;

      var currentTL  = gt.satis_tl || 0;
      var hedefTL    = gt.hedef_tl || 0;
      var currentReal = hedefTL > 0 ? (currentTL / hedefTL) * 100 : 0;
      if (hedefTL === 0) return result;

      // Run rate
      var rr = (typeof calculateRunRate === 'function') ? calculateRunRate(ttt) : {};
      // BUG-3 FIX: rr.remainingDays is from the ACTIVE calendar period (today's date).
      // If GENEL data is from a CLOSED period (elapsedDays === 0 means data predates active
      // period, or elapsedDays === totalDays means period ended), dailyReq would be computed
      // as (prior-period gap) / (active-period remaining days) → wildly inflated.
      // Guard: only use remainingDays when elapsedDays > 0 (period is genuinely in progress).
      var remaining   = (rr.remainingDays > 0 && (rr.elapsedDays || 0) > 0) ? rr.remainingDays : 0;
      var dailyRate   = rr.dailyRunRate  || 0;

      // En uygun hedefi belirle (verilmemişse en düşük ulaşılabilir)
      var target = primaryTarget;
      if (!target) {
        var candidates = [91, 100, 110, 120];
        for (var i = 0; i < candidates.length; i++) {
          var sim = (typeof simulateTarget === 'function')
            ? simulateTarget(ttt, candidates[i]) : { achievable: false };
          if (sim.achievable) { target = candidates[i]; break; }
        }
        target = target || 91;
      }
      result.primaryTarget = target;

      var targetTL  = hedefTL * (target / 100);
      var gap       = Math.max(0, targetTL - currentTL);
      var dailyReq  = remaining > 0 ? Math.round(gap / remaining) : 0;
      var weeklyReq = dailyReq * 5;

      result.gap           = Math.round(gap);
      result.dailyReq      = dailyReq;
      result.weeklyReq     = weeklyReq;
      result.remainingDays = remaining;

      // ── Adım adım plan ────────────────────────────────────
      var steps = [];
      var order = 1;

      // Adım 1: Günlük minimum hedef
      if (dailyReq > 0 && dailyReq > dailyRate) {
        var extra = dailyReq - dailyRate;
        steps.push({
          order:   order++,
          step:    'Günlük satışı artır',
          detail:  'Mevcut günlük hız ₺' + dailyRate.toLocaleString('tr-TR') +
            ' → ₺' + dailyReq.toLocaleString('tr-TR') + ' hedeflenmeli (₺' +
            extra.toLocaleString('tr-TR') + ' ek gerekiyor).',
          urgency: 'BUGÜN'
        });
      } else if (gap === 0) {
        steps.push({
          order:   order++,
          step:    'Hedef karşılandı — tempoyu koru',
          detail:  '%' + currentReal.toFixed(1) + ' realizasyonla %' + target + ' hedefe ulaşıldı.',
          urgency: 'BU DÖNEM'
        });
      }

      // Adım 2: Ürün odak noktaları
      var urunRows = (typeof GENEL !== 'undefined' ? GENEL : [])
        .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
      var agirliklar = (typeof URUN_AGIRLIK !== 'undefined') ? URUN_AGIRLIK : {};
      var tlMap      = (typeof IMS_TL_MAP   !== 'undefined') ? IMS_TL_MAP   : {};

      // En düşük realizasyonlu ve en yüksek ağırlıklı ürünler
      var productFocus = urunRows
        .filter(function (r) { return (r.tl_pct || 0) < 95; })
        .map(function (r) {
          var ag     = (r.urun_agirlik > 0) ? r.urun_agirlik : (agirliklar[r.urun] || 0);
          var uGap   = Math.max(0, (r.hedef_tl || 0) - (r.satis_tl || 0));
          var daily  = remaining > 0 ? Math.round(uGap / remaining) : 0;
          var price  = tlMap[r.urun] || 100;
          var boxDay = daily > 0 ? Math.round(daily / price) : 0;
          return {
            product:   r.urun,
            realPct:   Math.round((r.tl_pct || 0) * 10) / 10,
            urunGap:   Math.round(uGap),
            weight:    ag,
            dailyExtra: daily,
            boxPerDay: boxDay,
            reason:    r.urun + ' %' + (r.tl_pct || 0).toFixed(1) + ' realizasyonda — hedefi aşmak için günlük ' + boxDay + ' kutu ek satış gerekiyor.'
          };
        })
        .sort(function (a, b) { return (b.weight * (100 - b.realPct)) - (a.weight * (100 - a.realPct)); })
        .slice(0, 3);

      result.productFocus = productFocus;

      productFocus.forEach(function (p) {
        steps.push({
          order:   order++,
          step:    p.product + ' satışını artır (+' + p.boxPerDay + ' kutu/gün)',
          detail:  p.reason,
          urgency: p.realPct < 70 ? 'BUGÜN' : 'BU HAFTA'
        });
      });

      // Adım 3: Prim yol haritası
      var best = (typeof bestPrimScenario === 'function') ? bestPrimScenario(ttt) : null;
      result.primRoadmap = best;
      if (best && best.realization >= target) {
        steps.push({
          order:   order++,
          step:    '₺' + best.prim.toLocaleString('tr-TR') + ' prim için %' + best.realization + ' hedefle',
          detail:  best.requiredDailyExtra > 0
            ? 'Günlük ₺' + best.requiredDailyExtra.toLocaleString('tr-TR') + ' ek satışla [' + best.label + '] garanti.'
            : 'Mevcut hız yeterli — tempo koru.',
          urgency: 'BU HAFTA'
        });
      }

      // ── Dönüm noktaları ───────────────────────────────────
      var milestones = [];
      var checkpoints = [
        { days: Math.round(remaining * 0.25), label: '¼ Dönem' },
        { days: Math.round(remaining * 0.50), label: '½ Dönem' },
        { days: Math.round(remaining * 0.75), label: '¾ Dönem' },
        { days: remaining,                     label: 'Dönem Sonu' }
      ];

      checkpoints.forEach(function (cp) {
        if (cp.days <= 0) return;
        var expectedTL  = currentTL + dailyReq * cp.days;
        var expectedReal = hedefTL > 0 ? (expectedTL / hedefTL) * 100 : 0;
        milestones.push({
          days:     cp.days,
          label:    cp.label,
          targetTL: Math.round(expectedTL),
          realPct:  Math.round(expectedReal * 10) / 10,
          note:     cp.label + ': ₺' + Math.round(expectedTL).toLocaleString('tr-TR') +
            ' (%' + Math.round(expectedReal * 10) / 10 + ')'
        });
      });

      result.steps      = steps;
      result.milestones = milestones;

    } catch (e) {
      console.warn('[goal-coach] generateGoalPlan hata:', e.message);
    }

    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.generateGoalPlan = generateGoalPlan;
  console.debug('[goal-coach] Phase 3.4 yüklendi.');

})();
