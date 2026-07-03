// ══════════════════════════════════════════════════════════════════════
//  js/ai/coach/performance-coach.js
//  Phase 3.4 — AI Sales Coach
//
//  Sorumluluk: Performans seviyesi sınıflandırması + koçluk skoru
//    • analyzePerformance(ttt) → { level, score, explanation, details }
//    • _coachingPriorityScore(ttt) → 0-100 öncelik skoru
//
//  Sınıflandırma:
//    EXCELLENT  ≥ 100%
//    GOOD       ≥  91%
//    AVERAGE    ≥  70%
//    AT RISK    <  70%
//
//  Öncelik ağırlıkları:
//    35% Realizasyon açığı
//    25% Forecast riski
//    20% Bölge fırsatı
//    10% Pazar payı riski
//    10% Ürün fırsatı
//
//  Bağımlılık:
//    js/data/data-state.js              (GENEL)
//    js/ai/predictive/runrate-engine.js (calculateRunRate)
//    js/ai/predictive/forecast-engine.js(generateForecast)
//    js/ai/intelligence/risk-engine.js  (detectRisks)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, calculateRunRate, generateForecast, detectRisks */

(function () {
  'use strict';

  var LEVELS = {
    EXCELLENT: { label: 'MÜKEMMEL', color: '#16A34A', icon: '🏆', minScore: 100 },
    GOOD:      { label: 'İYİ',      color: '#059669', icon: '✅', minScore:  91 },
    AVERAGE:   { label: 'ORTALAMA', color: '#D97706', icon: '🟡', minScore:  70 },
    AT_RISK:   { label: 'RİSKTE',   color: '#DC2626', icon: '🔴', minScore:   0 }
  };

  // ── Seviye belirle ────────────────────────────────────────
  function _classifyLevel(realPct, forecastReal) {
    var effective = Math.max(realPct, forecastReal * 0.5 + realPct * 0.5); // ağırlıklı ortalama
    if (effective >= 100) return 'EXCELLENT';
    if (effective >=  91) return 'GOOD';
    if (effective >=  70) return 'AVERAGE';
    return 'AT_RISK';
  }

  // ── _coachingPriorityScore ────────────────────────────────
  // 5 bileşenli öncelik skoru (0-100).
  // Skor YÜKSEK = koçluk müdahalesine daha çok ihtiyaç var.
  // @param {string} ttt
  // @returns {number}
  function _coachingPriorityScore(ttt) {
    try {
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (!gt) return 50;

      var realPct = gt.tl_pct || 0;

      // 1. Realizasyon açığı (35 puan)
      var realGap   = Math.max(0, 100 - realPct);
      var realScore = Math.min(35, realGap * 0.35);

      // 2. Forecast riski (25 puan)
      var fc          = (typeof generateForecast === 'function') ? generateForecast(ttt) : {};
      var forecastReal = fc.projectedReal || realPct;
      var fcGap       = Math.max(0, 91 - forecastReal);
      var fcScore     = Math.min(25, fcGap * 0.6);

      // 3. Bölge fırsatı (20 puan) — IMS veri var mı + kapsama zayıf mı?
      var imsRows   = (typeof IMS !== 'undefined' ? IMS : []).filter(function (r) { return r.ttt === ttt; });
      var terrScore = imsRows.length > 0 ? Math.min(20, (1 - Math.min(1, imsRows.length / 50)) * 20) : 10;

      // 4. Pazar payı riski (10 puan)
      var risks       = (typeof detectRisks === 'function') ? detectRisks(ttt) : [];
      var highRisks   = risks.filter(function (r) { return r.severity === 'HIGH'; }).length;
      var riskScore   = Math.min(10, highRisks * 4);

      // 5. Ürün fırsatı (10 puan) — düşük realizasyonlu ürün sayısı
      var urunRows  = (typeof GENEL !== 'undefined' ? GENEL : [])
        .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM' && (r.tl_pct || 0) < 80; });
      var prodScore = Math.min(10, urunRows.length * 3);

      return Math.round(realScore + fcScore + terrScore + riskScore + prodScore);

    } catch (e) {
      return 50;
    }
  }

  // ── analyzePerformance ────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   level:       string,   — 'EXCELLENT'|'GOOD'|'AVERAGE'|'AT_RISK'
  //   label:       string,   — Türkçe etiket
  //   icon:        string,
  //   color:       string,
  //   score:       number,   — 0-100 koçluk öncelik skoru
  //   realPct:     number,
  //   forecastReal:number,
  //   explanation: string,
  //   strengths:   string[],
  //   gaps:        string[],
  //   details:     object
  // }}
  function analyzePerformance(ttt) {
    var result = {
      level:        'AT_RISK',
      label:        'RİSKTE',
      icon:         '🔴',
      color:        '#DC2626',
      score:        50,
      realPct:      0,
      forecastReal: 0,
      explanation:  'Veri yetersiz.',
      strengths:    [],
      gaps:         [],
      details:      {}
    };

    try {
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (!gt) return result;

      var realPct   = gt.tl_pct    || 0;
      var hedefTL   = gt.hedef_tl  || 0;
      var satisTL   = gt.satis_tl  || 0;
      var kalanTL   = gt.kalan_tl  || 0;

      // Forecast
      var rr  = (typeof calculateRunRate === 'function') ? calculateRunRate(ttt) : {};
      var fc  = (typeof generateForecast === 'function') ? generateForecast(ttt) : {};
      var forecastReal = fc.projectedReal || realPct;

      var level    = _classifyLevel(realPct, forecastReal);
      var levelDef = LEVELS[level] || LEVELS['AT_RISK'];

      // Güçlü yönler
      var strengths = [];
      if (realPct >= 91) strengths.push('Prim eşiğini karşılıyor (%' + realPct.toFixed(1) + ')');
      if (forecastReal >= 100) strengths.push('Forecast %100\'ü aşıyor (%' + forecastReal.toFixed(1) + ')');
      if (fc.confidence >= 70) strengths.push('Tahmin güveni yüksek (%' + fc.confidence + ')');

      var urunRows = (typeof GENEL !== 'undefined' ? GENEL : [])
        .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
      var strongUruns = urunRows.filter(function (r) { return (r.tl_pct || 0) >= 100; });
      if (strongUruns.length) {
        strengths.push(strongUruns.map(function (r) { return r.urun; }).join(', ') + ' %100 üzerinde');
      }

      // Zayıf yönler / açıklar
      var gaps = [];
      if (realPct < 91) {
        gaps.push('%91 prim eşiğine ' + (91 - realPct).toFixed(1) + ' puan kaldı');
      }
      if (forecastReal < realPct) {
        gaps.push('Forecast trend aşağı yönlü (tahmini %' + forecastReal.toFixed(1) + ')');
      }
      var weakUruns = urunRows.filter(function (r) { return (r.tl_pct || 0) < 70; });
      if (weakUruns.length) {
        gaps.push(weakUruns.map(function (r) { return r.urun; }).join(', ') + ' kritik seviyede');
      }

      // Açıklama
      var explanation;
      if (level === 'EXCELLENT') {
        explanation = 'Hedefin %' + realPct.toFixed(1) + '\'ine ulaşıldı — mükemmel performans. Tahmin %' +
          forecastReal.toFixed(1) + ' ile devam ediyor.';
      } else if (level === 'GOOD') {
        explanation = 'Prim eşiği karşılandı (%' + realPct.toFixed(1) + '). ' +
          (forecastReal >= 100 ? 'Tam prime doğru gidiyor.' : 'Tam prim için ivme gerekiyor.');
      } else if (level === 'AVERAGE') {
        var rr2 = rr.remainingDays || 0;
        explanation = '%' + realPct.toFixed(1) + ' realizasyon — ortalama seviye. ' +
          (rr2 > 0 ? rr2 + ' iş günü kaldı, %91 için odaklanma şart.' : 'Dönem kapandı.');
      } else {
        explanation = 'Realizasyon %' + realPct.toFixed(1) + ' — prim riski var. ' +
          'Kalan ₺' + Math.abs(kalanTL).toLocaleString('tr-TR') + ' için günlük hız artırılmalı.';
      }

      var priorityScore = _coachingPriorityScore(ttt);

      result = {
        level:        level,
        label:        levelDef.label,
        icon:         levelDef.icon,
        color:        levelDef.color,
        score:        priorityScore,
        realPct:      Math.round(realPct * 10) / 10,
        forecastReal: Math.round(forecastReal * 10) / 10,
        explanation:  explanation,
        strengths:    strengths,
        gaps:         gaps,
        details: {
          hedefTL:      hedefTL,
          satisTL:      satisTL,
          kalanTL:      kalanTL,
          remainingDays: rr.remainingDays || 0,
          dailyRunRate:  rr.dailyRunRate  || 0,
          forecastConf:  fc.confidence    || 0
        }
      };

    } catch (e) {
      console.warn('[performance-coach] analyzePerformance hata:', e.message);
    }

    return result;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.analyzePerformance      = analyzePerformance;
  window._coachingPriorityScore  = _coachingPriorityScore;

  console.debug('[performance-coach] Phase 3.4 yüklendi.');

})();
