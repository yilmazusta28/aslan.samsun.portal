// ══════════════════════════════════════════════════════════════════════
//  js/ai/coach/daily-plan-engine.js
//  Phase 3.4 — AI Sales Coach
//
//  Sorumluluk: Günlük + haftalık + dönem sonu koçluk planı
//    • generateDailyPlan(ttt) → { morning[], midday[], afternoon[],
//                                  thisWeek[], endOfPeriod[], urgencyMap }
//
//  Sabah / Öğle / Öğleden Sonra bloğu somut aksiyon içerir:
//    Sabah    → yapısal aksiyonlar (en yüksek etkili brickler / ürünler)
//    Öğle     → veri/tahmin gözden geçirme + fırsat tespiti
//    Öğleden  → takip aksiyonları (eczane follow-up, dokümantasyon)
//
//  Bağımlılık:
//    js/ai/territory/territory-engine.js   (buildTerritoryStrategy)
//    js/ai/territory/visit-planner.js      (buildVisitPlan)
//    js/ai/simulator/scenario-builder.js   (analyzeProductImpact, analyzeBrickImpact)
//    js/ai/simulator/target-simulator-engine.js (simulateTarget)
//    js/ai/predictive/runrate-engine.js    (calculateRunRate)
//    js/data/data-state.js                 (GENEL)
//    js/core/date-utils.js                 (PERIODS)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, PERIODS,
          buildTerritoryStrategy, buildVisitPlan,
          analyzeProductImpact, analyzeBrickImpact,
          simulateTarget, calculateRunRate */

(function () {
  'use strict';

  var DAY_TR = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];

  // ── _todayLabel ───────────────────────────────────────────
  function _todayLabel() {
    var d = new Date();
    return DAY_TR[d.getDay()] + ', ' +
      d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }

  // ── _urgencyIcon ──────────────────────────────────────────
  function _urgencyIcon(urgency) {
    return urgency === 'URGENT'    ? '🔴' :
           urgency === 'IMPORTANT' ? '🟡' : '🟢';
  }

  // ── generateDailyPlan ─────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   date:        string,
  //   morning:     Array<{action, detail, urgency, category}>,
  //   midday:      Array<{action, detail, urgency, category}>,
  //   afternoon:   Array<{action, detail, urgency, category}>,
  //   thisWeek:    Array<{action, detail, urgency, category}>,
  //   endOfPeriod: Array<{action, detail, urgency, category}>,
  //   summary:     string
  // }}
  function generateDailyPlan(ttt) {
    var result = {
      date:        _todayLabel(),
      morning:     [],
      midday:      [],
      afternoon:   [],
      thisWeek:    [],
      endOfPeriod: [],
      summary:     ''
    };

    try {
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      var realPct   = gt ? (gt.tl_pct || 0) : 0;
      var hedefTL   = gt ? (gt.hedef_tl || 0) : 0;

      var rr        = (typeof calculateRunRate === 'function') ? calculateRunRate(ttt) : {};
      var remaining = rr.remainingDays || 0;
      var dailyRate = rr.dailyRunRate  || 0;

      // ── Bugünkü ziyaret planı ─────────────────────────────
      var visitPlan = (typeof buildVisitPlan === 'function') ? buildVisitPlan(ttt) : {};
      var todayDow  = new Date().getDay(); // 0=Sun
      var dowKey    = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][todayDow];
      var todayBricks = (visitPlan[dowKey] || []).slice(0, 4);

      // ── Territory analizi ─────────────────────────────────
      var terr   = (typeof buildTerritoryStrategy === 'function') ? buildTerritoryStrategy(ttt) : {};
      var rescue = terr.rescueBricks && terr.rescueBricks.length ? terr.rescueBricks[0] : null;
      var opp    = terr.opportunities && terr.opportunities.length ? terr.opportunities[0] : null;
      var topB   = terr.topBricks    && terr.topBricks.length     ? terr.topBricks[0]     : null;

      // ── Ürün & brick etki analizleri ─────────────────────
      var prodImpact  = (typeof analyzeProductImpact === 'function')
        ? analyzeProductImpact(ttt, 10) : [];
      var brickImpact = (typeof analyzeBrickImpact === 'function')
        ? analyzeBrickImpact(ttt) : [];

      var topProd  = prodImpact[0]  || null;
      var topBrick = brickImpact[0] || null;

      // ── %91 simülasyonu ───────────────────────────────────
      var s91 = (typeof simulateTarget === 'function') ? simulateTarget(ttt, 91) : null;

      // ══════════════════════════════════════════════════════
      //  SABAH BLOĞU — Yüksek enerjili sahaya çıkış
      // ══════════════════════════════════════════════════════

      // RESCUE brick varsa → 1. öncelik
      if (rescue) {
        result.morning.push({
          action:   '🆘 ' + rescue.brick + ' brickini ziyaret et (RESCUE)',
          detail:   rescue.reason + ' — Uzun süre ziyaret edilmemiş, ivedi müdahale gerekiyor.',
          urgency:  'URGENT',
          category: 'ZİYARET'
        });
      }

      // Planlı günlük brickler
      if (todayBricks.length) {
        todayBricks.forEach(function (b) {
          var urg = b.classification === 'RESCUE' ? 'URGENT' : 'IMPORTANT';
          result.morning.push({
            action:   b.brick + ' brickine gir',
            detail:   '[' + b.classification + '] ' + (b.reason || 'Günün planında.'),
            urgency:  urg,
            category: 'ZİYARET'
          });
        });
      } else if (topB) {
        result.morning.push({
          action:   topB.brick + ' brickini ziyaret et',
          detail:   'Bugün özellikle planlanmış ziyaret yok — öncelikli brick ile başla.',
          urgency:  'IMPORTANT',
          category: 'ZİYARET'
        });
      }

      // En yüksek etkili ürün sabah mesajı
      if (topProd) {
        result.morning.push({
          action:   topProd.product + ' odaklı eczane girişi yap',
          detail:   topProd.product + ' her ziyarette öncelikli mesaj olsun. ' +
            'Toplam açığın %' + topProd.tlGapContrib + '\'ini oluşturuyor.',
          urgency:  topProd.currentReal < 70 ? 'URGENT' : 'IMPORTANT',
          category: 'ÜRÜN'
        });
      }

      // ══════════════════════════════════════════════════════
      //  ÖĞLE BLOĞU — Veri, gözden geçirme, fırsat tespiti
      // ══════════════════════════════════════════════════════

      // Günlük hedef takibi
      if (s91 && !s91.achievable && remaining > 0) {
        result.midday.push({
          action:   'Sabah satışlarını gözden geçir — günlük hedef ₺' + (s91.requiredDailySales || 0).toLocaleString('tr-TR'),
          detail:   '%91 prim eşiği için günlük ₺' + (s91.requiredDailySales || 0).toLocaleString('tr-TR') +
            ' satış gerekiyor. Sabah ne kadar kapatıldı?',
          urgency:  'URGENT',
          category: 'TAKİP'
        });
      } else {
        result.midday.push({
          action:   'Sabah satış performansını gözden geçir',
          detail:   'Günlük run rate ₺' + dailyRate.toLocaleString('tr-TR') + '. Tempoyu koruyup korumadığını kontrol et.',
          urgency:  'IMPORTANT',
          category: 'TAKİP'
        });
      }

      // Fırsat brick öğlen tetikleyicisi
      if (opp) {
        result.midday.push({
          action:   opp.brick + ' fırsat brickini değerlendir',
          detail:   opp.reason + ' — Öğleden sonra programa ekle.',
          urgency:  'IMPORTANT',
          category: 'FIRSAT'
        });
      }

      // En yüksek kaldıraçlı brick öğle notu
      if (topBrick && topBrick.impactScore >= 50) {
        result.midday.push({
          action:   topBrick.brick + ' için öğleden sonra ziyaret planla',
          detail:   'Etki skoru ' + topBrick.impactScore + '/100 — pazar payı %' + topBrick.ourShare +
            ', potansiyel ₺' + (topBrick.potentialTL || 0).toLocaleString('tr-TR') + '.',
          urgency:  'IMPORTANT',
          category: 'ZİYARET'
        });
      }

      // ══════════════════════════════════════════════════════
      //  ÖĞLEDEN SONRA BLOĞU — Takip + eczane + kapanış
      // ══════════════════════════════════════════════════════

      result.afternoon.push({
        action:   'Kilit eczanelere takip ziyareti yap',
        detail:   'Sabah sipariş verilen veya görüşülen eczaneleri takip et. Stok ve sipariş durumunu kontrol et.',
        urgency:  'IMPORTANT',
        category: 'TAKİP'
      });

      // İkinci ürün odağı
      if (prodImpact.length >= 2) {
        var p2 = prodImpact[1];
        result.afternoon.push({
          action:   p2.product + ' için öğleden sonra ek reçete fırsatı',
          detail:   p2.product + ' %' + p2.currentReal + ' realizasyonda. Öğleden sonra girilen eczanelerde bu ürünü öne çıkar.',
          urgency:  'IMPORTANT',
          category: 'ÜRÜN'
        });
      }

      // Günlük kapanış notu
      result.afternoon.push({
        action:   'Günü kapat: yarın için ziyaret listesi hazırla',
        detail:   'Bugünkü satış rakamını not et. Yarın için öncelikli brickleri belirle.',
        urgency:  'MONITOR',
        category: 'PLANLAMA'
      });

      // ══════════════════════════════════════════════════════
      //  BU HAFTA BLOĞU
      // ══════════════════════════════════════════════════════

      // Haftalık ziyaret planı
      if (visitPlan.weekly && visitPlan.weekly.length) {
        visitPlan.weekly.slice(0, 4).forEach(function (w) {
          result.thisWeek.push({
            action:   '#' + w.priority + ' ' + w.brick + ' — bu hafta ziyaret et',
            detail:   '[' + w.classification + '] ' + w.reason,
            urgency:  w.classification === 'RESCUE' ? 'URGENT' : 'IMPORTANT',
            category: 'ZİYARET'
          });
        });
      }

      // Haftalık ürün odağı
      prodImpact.slice(0, 2).forEach(function (p) {
        result.thisWeek.push({
          action:   p.product + ' satışını bu hafta artır (' + p.boxPerDay + ' kutu/gün ek)',
          detail:   p.reason,
          urgency:  p.currentReal < 70 ? 'URGENT' : 'IMPORTANT',
          category: 'ÜRÜN'
        });
      });

      // ══════════════════════════════════════════════════════
      //  DÖNEM SONU BLOĞU
      // ══════════════════════════════════════════════════════

      if (remaining > 0) {
        result.endOfPeriod.push({
          action:   '%91 prim eşiğini garanti altına al',
          detail:   remaining + ' iş günü kaldı. ' +
            (s91 && s91.requiredDailySales ? 'Günlük ₺' + s91.requiredDailySales.toLocaleString('tr-TR') + ' ile ulaşılabilir.' : ''),
          urgency:  realPct < 80 ? 'URGENT' : 'IMPORTANT',
          category: 'HEDEF'
        });

        // Dönem sonu için brick kapsamı
        if (terr.strategy && terr.strategy.length) {
          terr.strategy.slice(0, 2).forEach(function (s) {
            result.endOfPeriod.push({
              action:   s.action,
              detail:   s.detail,
              urgency:  s.urgency === 'BUGÜN' ? 'URGENT' : 'IMPORTANT',
              category: 'BÖLGE'
            });
          });
        }
      }

      // ── Özet ─────────────────────────────────────────────
      var topActions = result.morning.filter(function (a) { return a.urgency === 'URGENT'; });
      result.summary = topActions.length
        ? 'Bugün ' + topActions.length + ' acil aksiyon var. ' +
          topActions.map(function (a) { return a.action; }).slice(0, 2).join(' / ')
        : 'Düzenli ziyaret günü. Tempoyu koru ve kilit eczaneleri ziyaret et.';

    } catch (e) {
      console.warn('[daily-plan-engine] generateDailyPlan hata:', e.message);
    }

    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.generateDailyPlan = generateDailyPlan;
  console.debug('[daily-plan-engine] Phase 3.4 yüklendi.');

})();
