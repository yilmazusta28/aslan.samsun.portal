// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/workload-engine.js
//  Phase 3.3 — Territory Optimization Engine
//
//  Sorumluluk: Temsilci iş yükünü ve bölge yoğunluğunu analiz et
//    • analyzeWorkload(ttt) → { workload, focusAreas, riskAreas, ... }
//
//  Hesaplanan Metrikler:
//    - Toplam brick sayısı
//    - Aktif eczane sayısı
//    - Açık fırsat sayısı
//    - Risk bölge sayısı
//    - Ziyaret yoğunluğu skoru
//    - Dönem yükü: kalan süre / toplam fırsat
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: brick-ranking-engine.js, coverage-engine.js,
//               data-state.js, date-utils.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMS, GENEL, MIGI_BRICK_TL_RAW, ECZANE_RAW, eczaneLoaded */
/* global rankBricks, analyzeCoverage */
/* global PERIODS, workDays */

(function () {
  'use strict';

  // ── analyzeWorkload ────────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   workload: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',
  //   totalBricks: number,
  //   activePharmacies: number,
  //   focusAreas: number,     — yüksek öncelikli brick
  //   riskAreas: number,      — RESCUE + çok düşük realizasyon
  //   openOpportunities: number,
  //   weeklyVisitCapacity: number,  — kalan gün / ~4 brick/gün
  //   visitDebt: number,            — focusAreas - weeklyVisitCapacity
  //   periodPhase: 'EARLY'|'MID'|'LATE',
  //   insights: string[]
  // }}
  function analyzeWorkload(ttt) {
    var DEFAULT = {
      workload: 'MEDIUM', totalBricks: 0, activePharmacies: 0,
      focusAreas: 0, riskAreas: 0, openOpportunities: 0,
      weeklyVisitCapacity: 0, visitDebt: 0,
      periodPhase: 'MID', insights: []
    };
    if (!ttt) return DEFAULT;

    try {
      var ranked   = typeof rankBricks      === 'function' ? rankBricks(ttt)      : [];
      var coverage = typeof analyzeCoverage === 'function' ? analyzeCoverage(ttt) : [];

      // ── Brick sayıları ────────────────────────────────────
      var totalBricks  = ranked.length;
      var rescueBricks = ranked.filter(function(r){ return r.classification === 'RESCUE'; }).length;
      var oppBricks    = ranked.filter(function(r){ return r.classification === 'OPPORTUNITY'; }).length;
      var focusAreas   = rescueBricks + oppBricks;
      var undercovBricks = coverage.filter(function(c){
        return c.status === 'UNDER_COVERED' || c.status === 'UNTOUCHED';
      }).length;

      // Risk: RESCUE + ciddi realizasyon açığı
      var genelTotal = (GENEL || []).find(function(r){
        return r.ttt === ttt && r.urun === 'GENEL TOPLAM';
      });
      var realPct = genelTotal ? (genelTotal.tl_pct || 0) : 0;
      var riskAreas = rescueBricks + (realPct < 70 ? Math.max(1, Math.floor(totalBricks * 0.3)) : 0);
      riskAreas = Math.min(riskAreas, totalBricks);

      // ── Aktif eczane ──────────────────────────────────────
      var activePharmacies = 0;
      if (eczaneLoaded && ECZANE_RAW) {
        var eczSet = new Set();
        (ECZANE_RAW || []).filter(function(r){ return r.ttt === ttt; }).forEach(function(r){
          eczSet.add(r.gln || r.ad);
        });
        activePharmacies = eczSet.size;
      }

      // ── Dönem iş günü kapasitesi ──────────────────────────
      var now = new Date();
      var pad = function(n){ return String(n).padStart(2,'0'); };
      var todayStr = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
      var curPer   = (typeof PERIODS !== 'undefined' ? PERIODS : [])
                       .find(function(p){ return todayStr >= p.start && todayStr <= p.end; });

      var remDays  = curPer && typeof workDays === 'function' ? workDays(todayStr, curPer.end) : 0;
      var totDays  = curPer && typeof workDays === 'function' ? workDays(curPer.start, curPer.end) : 1;
      var passed   = Math.max(1, totDays - remDays);
      var phasePct = totDays > 0 ? passed / totDays : 0.5;
      var periodPhase = phasePct < 0.25 ? 'EARLY' : phasePct > 0.75 ? 'LATE' : 'MID';

      // Kapasite: 4 brick/gün × kalan iş günü
      var weeklyVisitCapacity = remDays * 4;
      var visitDebt = Math.max(0, focusAreas + undercovBricks - weeklyVisitCapacity);

      // Fırsat sayısı
      var openOpportunities = oppBricks + undercovBricks;

      // ── İş yükü sınıfı ───────────────────────────────────
      var workload;
      var demandRatio = weeklyVisitCapacity > 0 ? (focusAreas + undercovBricks) / weeklyVisitCapacity : 1;
      if (rescueBricks >= 3 || demandRatio > 1.5 || realPct < 65) {
        workload = 'CRITICAL';
      } else if (rescueBricks >= 1 || demandRatio > 1.0 || realPct < 80) {
        workload = 'HIGH';
      } else if (demandRatio > 0.6 || realPct < 91) {
        workload = 'MEDIUM';
      } else {
        workload = 'LOW';
      }

      // ── İçgörüler ────────────────────────────────────────
      var insights = [];
      if (rescueBricks)      insights.push(rescueBricks + ' RESCUE brick acil ziyaret bekliyor.');
      if (undercovBricks)    insights.push(undercovBricks + ' brick\'te kapsama zayıf — eczane ziyareti eksik.');
      if (visitDebt > 0)     insights.push('Ziyaret açığı: ' + visitDebt + ' brick kalan sürede kapsanamayabilir.');
      if (periodPhase === 'LATE' && realPct < 91) {
        insights.push('Dönem sonuna yakın ve realizasyon %91 altında — hız artırılmalı.');
      }
      if (activePharmacies > 0) {
        insights.push(activePharmacies + ' aktif eczane portföyde.');
      }
      if (!insights.length) insights.push('Yönetilebilir iş yükü — rutin ziyaret planı yeterli.');

      return {
        workload:            workload,
        totalBricks:         totalBricks,
        activePharmacies:    activePharmacies,
        focusAreas:          focusAreas,
        riskAreas:           riskAreas,
        openOpportunities:   openOpportunities,
        weeklyVisitCapacity: weeklyVisitCapacity,
        visitDebt:           visitDebt,
        periodPhase:         periodPhase,
        insights:            insights
      };

    } catch (e) {
      console.warn('[workload-engine] analyzeWorkload hata:', e.message);
      return DEFAULT;
    }
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.analyzeWorkload = analyzeWorkload;
  console.debug('[workload-engine] Phase 3.3 yüklendi.');

})();
