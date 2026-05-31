// ══════════════════════════════════════════════════════════════════════
//  js/ai/predictive/runrate-engine.js
//  Phase 3.1 — Predictive Forecast Engine
//
//  Sorumluluk: Günlük satış hızı (run rate) hesabı
//    • calculateRunRate(ttt) → { dailyRunRate, projectedMonthEnd, confidence }
//
//  Yöntem:
//    current_sales / elapsed_work_days = günlük hız
//    günlük hız × toplam_dönem_iş_günü = dönem sonu projeksiyonu
//
//  Bağımlılık:
//    js/data/data-state.js  (GENEL, IMS)
//    js/core/date-utils.js  (PERIODS, workDays, HOLIDAYS)
//    js/core/constants.js   (IMS_TL_MAP, URUN_ORDER)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, PERIODS, workDays, IMS_TL_MAP, URUN_ORDER */

(function () {
  'use strict';

  // ── _currentPeriod ────────────────────────────────────────
  // Bugünün tarihine göre aktif dönemi döndürür.
  // @returns {{ label, start, end }|null}
  function _currentPeriod() {
    var today = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    var periods = (typeof PERIODS !== 'undefined') ? PERIODS : [];
    for (var i = 0; i < periods.length; i++) {
      if (todayStr >= periods[i].start && todayStr <= periods[i].end) {
        return periods[i];
      }
    }
    // Dönem bulunamazsa en yakın gelecek dönemi döndür
    for (var j = 0; j < periods.length; j++) {
      if (todayStr < periods[j].start) return periods[j];
    }
    return periods[periods.length - 1] || null;
  }

  // ── _safeWorkDays ─────────────────────────────────────────
  // workDays() wrapper — hata durumunda takvim günü farkı döner.
  function _safeWorkDays(start, end) {
    try {
      if (typeof workDays === 'function') return workDays(start, end);
    } catch (e) { /* fall through */ }
    // Fallback: takvim farkı × 0.71 (hafta içi oranı)
    var ms = new Date(end) - new Date(start);
    return Math.max(1, Math.round(ms / 86400000 * 0.71));
  }

  // ── _confidence ───────────────────────────────────────────
  // Geçen süre + veri yeterliliğine göre güven skoru (0-100).
  function _confidence(elapsedDays, totalDays, hasWeeklyData) {
    if (totalDays === 0) return 0;
    var progress = elapsedDays / totalDays;
    var base = 0;
    if      (progress >= 0.75) base = 88;
    else if (progress >= 0.50) base = 75;
    else if (progress >= 0.25) base = 58;
    else if (progress >= 0.10) base = 40;
    else                        base = 20;
    if (!hasWeeklyData) base = Math.round(base * 0.7);
    return Math.min(95, Math.max(10, base));
  }

  // ── calculateRunRate ──────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   dailyRunRate:      number,   // günlük ortalama TL satış
  //   projectedMonthEnd: number,   // dönem sonu projeksiyon TL
  //   projectedRealization: number,// hedef realizasyon % tahmini
  //   elapsedDays:       number,
  //   remainingDays:     number,
  //   totalDays:         number,
  //   periodLabel:       string,
  //   confidence:        number,
  //   note:              string
  // }}
  function calculateRunRate(ttt) {
    var result = {
      dailyRunRate:          0,
      projectedMonthEnd:     0,
      projectedRealization:  0,
      elapsedDays:           0,
      remainingDays:         0,
      totalDays:             0,
      periodLabel:           '—',
      confidence:            0,
      note:                  'Veri yetersiz.'
    };

    try {
      // ── Aktif dönem ──────────────────────────────────────
      var period = _currentPeriod();
      if (!period) { result.note = 'Aktif dönem bulunamadı.'; return result; }

      var todayStr   = new Date().toISOString().slice(0, 10);
      var totalDays  = _safeWorkDays(period.start, period.end);
      var elapsedDays = _safeWorkDays(period.start,
        todayStr < period.start ? period.start :
        todayStr > period.end   ? period.end   : todayStr);
      var remainingDays = Math.max(0, totalDays - elapsedDays);

      result.periodLabel  = period.label;
      result.totalDays    = totalDays;
      result.elapsedDays  = elapsedDays;
      result.remainingDays = remainingDays;

      if (elapsedDays === 0) {
        result.note = 'Dönem henüz başlamadı.';
        result.confidence = 15;
        return result;
      }

      // ── Mevcut satış (GENEL TOPLAM) ──────────────────────
      var genelTotal = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

      var currentTL = genelTotal ? (genelTotal.satis_tl || 0) : 0;
      var hedefTL   = genelTotal ? (genelTotal.hedef_tl  || 0) : 0;

      // ── Haftalık IMS verisi var mı? ───────────────────────
      var imsRows = (typeof IMS !== 'undefined' ? IMS : [])
        .filter(function (r) { return r.ttt === ttt; });
      var hasWeeklyData = imsRows.length > 0;

      // ── Günlük run rate ───────────────────────────────────
      var dailyRate = elapsedDays > 0 ? currentTL / elapsedDays : 0;

      // ── Projeksiyon: mevcut + kalan günler × günlük hız ──
      var projected = currentTL + (dailyRate * remainingDays);

      // ── Realizasyon tahmini ──────────────────────────────
      var projReal = hedefTL > 0 ? (projected / hedefTL) * 100 : 0;

      result.dailyRunRate          = Math.round(dailyRate);
      result.projectedMonthEnd     = Math.round(projected);
      result.projectedRealization  = Math.round(projReal * 10) / 10;
      result.confidence            = _confidence(elapsedDays, totalDays, hasWeeklyData);

      result.note = 'Günlük run rate: ₺' + Math.round(dailyRate).toLocaleString('tr-TR') +
        ' | ' + elapsedDays + '/' + totalDays + ' iş günü geçti.';

    } catch (e) {
      console.warn('[runrate-engine] calculateRunRate hata:', e.message);
      result.note = 'Hesaplama hatası: ' + e.message;
    }

    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.calculateRunRate = calculateRunRate;
  // period helper — diğer modüller kullanabilir
  window._rrCurrentPeriod = _currentPeriod;

  console.debug('[runrate-engine] Phase 3.1 yüklendi.');

})();
