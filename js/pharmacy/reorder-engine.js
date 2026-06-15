// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/reorder-engine.js — PHASE 4.6
//  Reorder Intelligence Engine
//
//  Sorumluluk:
//    • analyzePharmacyHistory()   → tüm eczaneleri analiz et
//    • buildTop30Reorder()        → en yüksek skorlu 30 eczane
//    • buildReorderContext(ttt)   → AI context metni
//    • renderReorderCard(id,ttt)  → dashboard kartı
//
//  Hesaplanan metrikler:
//    momentum, consistency, campaignFlag, classification,
//    reorderProbability, forecastBoxes, score
//
//  Sınıflandırmalar:
//    GROWING | REGULAR_BUYER | CAMPAIGN_BUYER | AT_RISK | REACTIVATION | NEW
//
//  Global bağımlılıklar:
//    Veri : ECZANE_RAW, eczaneLoaded
//
//  Yükleme sırası: pharmacy-intelligence.js SONRASI, ai-context.js ÖNCESI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

/* global ECZANE_RAW, eczaneLoaded */

// ── 1. Global State ───────────────────────────────────────────────────
window.REORDER_INTELLIGENCE = {
  pharmacies:          [],
  top30:               [],
  regularBuyers:       [],
  growingAccounts:     [],
  campaignBuyers:      [],
  reactivationTargets: [],
  riskAccounts:        [],
  generatedAt:         null
};

// ── 2. Yardımcı: Ay sıralaması ────────────────────────────────────────
function _riMonthToNum(ayStr) {
  if (!ayStr) return 0;
  var p = ayStr.split('/');
  if (p.length < 2) return 0;
  return parseInt(p[1], 10) * 100 + parseInt(p[0], 10);
}

// ── 3. Yardımcı: Standart sapma ──────────────────────────────────────
function _riStdDev(arr) {
  if (!arr || arr.length < 2) return 0;
  var mean = arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
  var variance = arr.reduce(function(s, v) { return s + Math.pow(v - mean, 2); }, 0) / arr.length;
  return Math.sqrt(variance);
}

// ── 4. Momentum Skoru (0–100) ─────────────────────────────────────────
// Son 3 ayın trendi: artış=yüksek, düşüş=düşük, sabit=orta
function _calcMomentum(monthlySales) {
  if (!monthlySales || monthlySales.length < 2) return 50;

  var len   = monthlySales.length;
  var last3 = monthlySales.slice(Math.max(0, len - 3));

  if (last3.length < 2) return 50;

  var first = last3[0] || 0;
  var last  = last3[last3.length - 1] || 0;

  if (first === 0 && last === 0) return 0;
  if (first === 0) return 80; // sıfırdan başladı — yükselen

  var changePct = ((last - first) / first) * 100;

  // changePct → 0-100 normalize
  // +100% → 100, 0% → 60, -100% → 20
  var raw = 60 + changePct * 0.4;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── 5. Consistency Skoru (0–100) ─────────────────────────────────────
// Düşük std sapma → yüksek consistency
function _calcConsistency(monthlySales) {
  if (!monthlySales || monthlySales.length < 2) return 0;

  var nonZero = monthlySales.filter(function(v) { return v > 0; });
  if (nonZero.length < 2) return 0;

  var mean = nonZero.reduce(function(s, v) { return s + v; }, 0) / nonZero.length;
  if (mean === 0) return 0;

  var cv = _riStdDev(nonZero) / mean; // Coefficient of Variation

  // CV=0 → 100, CV=0.5 → 50, CV=1+ → 0
  var score = Math.round(Math.max(0, (1 - cv) * 100));

  // Aktiflik bonusu: ayların çoğu doluysa ek puan
  var activeRatio = nonZero.length / monthlySales.length;
  score = Math.round(score * (0.6 + 0.4 * activeRatio));

  return Math.max(0, Math.min(100, score));
}

// ── 6. Kampanya Tespiti ───────────────────────────────────────────────
// Son ay ortalamadan 3x fazlaysa kampanya işareti
function _detectCampaign(monthlySales) {
  if (!monthlySales || monthlySales.length < 3) return false;

  var len  = monthlySales.length;
  var last = monthlySales[len - 1] || 0;

  // Son ay hariç ortalama
  var prev = monthlySales.slice(0, len - 1).filter(function(v) { return v > 0; });
  if (!prev.length) return false;

  var avg = prev.reduce(function(s, v) { return s + v; }, 0) / prev.length;

  return avg > 0 && last >= avg * 3;
}

// ── 7. Sınıflandırma ─────────────────────────────────────────────────
function _classify(monthlySales, campaignFlag, momentum, consistency) {
  if (!monthlySales || !monthlySales.length) return 'NEW';

  var len       = monthlySales.length;
  var last      = monthlySales[len - 1] || 0;
  var prev      = len >= 2 ? (monthlySales[len - 2] || 0) : 0;
  var nonZero   = monthlySales.filter(function(v) { return v > 0; });

  if (campaignFlag) return 'CAMPAIGN_BUYER';

  // REACTIVATION: Önceden yüksek, son 2 ay sıfır
  if (len >= 3) {
    var last2Zero = last === 0 && prev === 0;
    var hadHistory = monthlySales.slice(0, len - 2).some(function(v) { return v >= 50; });
    if (last2Zero && hadHistory) return 'REACTIVATION';
  }

  // AT_RISK: Belirgin düşüş trendi, son ay çok düşük
  if (len >= 3) {
    var peak = Math.max.apply(null, monthlySales.slice(0, len - 1));
    if (peak > 0 && last < peak * 0.25 && momentum < 35) return 'AT_RISK';
  }

  // GROWING: Momentum yüksek ve son 3 ay sürekli artış
  if (momentum >= 70 && len >= 3) {
    var last3 = monthlySales.slice(Math.max(0, len - 3));
    var increasing = last3.every(function(v, i) {
      return i === 0 || v >= last3[i - 1] * 0.9; // %10 tolerans
    });
    if (increasing && last3[last3.length - 1] > last3[0]) return 'GROWING';
  }

  // REGULAR_BUYER: Yüksek consistency, düzenli alış
  if (consistency >= 60 && nonZero.length >= len * 0.7) return 'REGULAR_BUYER';

  // GROWING fallback
  if (momentum >= 65) return 'GROWING';

  return 'ACTIVE';
}

// ── 8. Reorder Probability (0–100) ───────────────────────────────────
function _calcReorderProbability(params) {
  var momentum          = params.momentum          || 0;
  var consistency       = params.consistency       || 0;
  var lastMonthBoxes    = params.lastMonthBoxes    || 0;
  var monthCount        = params.monthCount        || 0;
  var campaignFlag      = params.campaignFlag      || false;
  var classification    = params.classification    || 'ACTIVE';
  var avgBoxes          = params.avgBoxes          || 0;
  var daysSinceLastOrder= params.daysSinceLastOrder|| 999;

  var score = 0;

  // Temel: momentum katkısı (%30)
  score += momentum * 0.30;

  // Consistency katkısı (%25)
  score += consistency * 0.25;

  // Son ay aktifliği (%20)
  if (lastMonthBoxes > 0) {
    score += Math.min(20, (lastMonthBoxes / Math.max(avgBoxes, 1)) * 20);
  }

  // Geçmiş uzunluk bonusu (%10)
  score += Math.min(10, monthCount * 1.5);

  // Son sipariş tarihi (±15)
  if (daysSinceLastOrder <= 30) {
    score += 15; // çok yakın — büyük ihtimalle yakında sipariş
  } else if (daysSinceLastOrder <= 45) {
    score += 10;
  } else if (daysSinceLastOrder > 90) {
    score -= 20;
  }

  // Sınıflandırma düzeltmeleri
  if (campaignFlag)                     score -= 30; // kampanya sonrası uzun bekleme
  if (classification === 'AT_RISK')     score -= 25;
  if (classification === 'REACTIVATION')score -= 15; // potansiyel var ama hareketsiz
  if (classification === 'GROWING')     score += 10;
  if (classification === 'REGULAR_BUYER') score += 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── 9. Forecast Boxes (lineer trend) ─────────────────────────────────
function _calcForecastBoxes(monthlySales) {
  if (!monthlySales || !monthlySales.length) return 0;

  var len = monthlySales.length;

  if (len === 1) return monthlySales[0] || 0;

  // Basit lineer regresyon: y = a + b*x
  var n    = len;
  var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  monthlySales.forEach(function(v, i) {
    sumX  += i;
    sumY  += v;
    sumXY += i * v;
    sumX2 += i * i;
  });

  var denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return Math.round(sumY / n); // sabit serisi

  var b = (n * sumXY - sumX * sumY) / denom;
  var a = (sumY - b * sumX) / n;

  var forecast = Math.round(a + b * len);
  return Math.max(0, forecast);
}

// ── 10. Master Score (0–100) ──────────────────────────────────────────
function _calcMasterScore(reorderProbability, momentum, consistency, forecastBoxes, maxForecast) {
  var forecastNorm = maxForecast > 0 ? (forecastBoxes / maxForecast) * 100 : 0;

  var raw =
    reorderProbability * 0.40 +
    momentum           * 0.25 +
    consistency        * 0.20 +
    forecastNorm       * 0.15;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ── 11. Reason Text (İnsan Okunabilir) ───────────────────────────────
function _buildReason(classification, momentum, consistency, monthlySales) {
  var len = monthlySales ? monthlySales.length : 0;

  switch (classification) {
    case 'GROWING':
      return len + ' aydır düzenli büyüme';
    case 'REGULAR_BUYER':
      return 'Sabit düzenli alış, sipariş zamanı yakın';
    case 'CAMPAIGN_BUYER':
      return 'Büyük kampanya alışı — bekleme sürecinde';
    case 'AT_RISK':
      return 'Belirgin düşüş — müdahale gerekiyor';
    case 'REACTIVATION':
      return 'Geçmişte yüksek alış — yeniden kazanım fırsatı';
    default:
      if (momentum >= 70) return 'Artan momentum';
      if (consistency >= 70) return 'Tutarlı alış profili';
      return 'Aktif eczane';
  }
}

// ── 12. analyzePharmacyHistory() ─────────────────────────────────────
// ECZANE_RAW → her eczane için tam analiz objesi
function analyzePharmacyHistory(tttFilter) {
  // PHASE 5.2: pharmacyStore.normalized öncelikli, yoksa pharmacyActiveData, son çare ECZANE_RAW
  var _storeNorm = (window.pharmacyStore && window.pharmacyStore.normalized && window.pharmacyStore.normalized.length)
    ? window.pharmacyStore.normalized
    : null;
  var _base = _storeNorm
    || (window.pharmacyActiveData && window.pharmacyActiveData.length ? window.pharmacyActiveData : null)
    || (typeof ECZANE_RAW !== 'undefined' ? ECZANE_RAW : []);

  if (!_base || !Array.isArray(_base) || !_base.length) {
    console.warn('[ReorderEngine] Veri yok (pharmacyStore, pharmacyActiveData, ECZANE_RAW hepsi boş)');
    return [];
  }

  // normalize edilmiş kayıtları ECZANE_RAW formatına çevir (geriye uyumluluk)
  var _toRaw = function(n) {
    return {
      gln:   n.gln   || '',
      ad:    n.eczane || n.ad || '',
      brick: n.brick  || '',
      ttt:   n.temsilci || n.ttt || '',
      urun:  n.urun   || '',
      adet:  n.adet   || 0,
      tutar: n.tutar  || 0,
      ay:    n.ay     || (String(n.month).padStart(2,'0') + '/' + n.year)
    };
  };
  var rawBase = _storeNorm ? _base.map(_toRaw) : _base;

  var source = tttFilter
    ? rawBase.filter(function(r) { return (r.ttt||r.temsilci) === tttFilter; })
    : rawBase;

  if (!source.length) return [];

  // Eczane + ay bazında grupla
  var eczMap = {};

  source.forEach(function(r) {
    var key = r.gln || r.ad;
    if (!key) return;

    if (!eczMap[key]) {
      eczMap[key] = {
        eczane: r.ad || r.eczane || '',
        brick:  r.brick || '',
        ttt:    r.ttt  || '',
        gln:    r.gln  || '',
        aylar:  {}
      };
    }

    var e = eczMap[key];
    if (r.brick) e.brick = r.brick;
    if (r.ttt)   e.ttt   = r.ttt;

    if (r.ay) {
      var adet = parseInt(r.adet, 10) || 0;
      e.aylar[r.ay] = (e.aylar[r.ay] || 0) + adet;
    }
  });

  var results = [];

  Object.values(eczMap).forEach(function(e) {
    try {
      var ayKeys = Object.keys(e.aylar).sort(function(a, b) {
        return _riMonthToNum(a) - _riMonthToNum(b);
      });

      if (!ayKeys.length) return;

      var monthlySales   = ayKeys.map(function(k) { return e.aylar[k] || 0; });
      var totalBoxes     = monthlySales.reduce(function(s, v) { return s + v; }, 0);
      var monthCount     = ayKeys.length;
      var avgBoxes       = monthCount > 0 ? totalBoxes / monthCount : 0;
      var lastMonthBoxes = monthlySales[monthlySales.length - 1] || 0;

      // Son sipariş tarihi tahmini (son ayın ortası baz alınır)
      var lastAy = ayKeys[ayKeys.length - 1];
      var daysSinceLastOrder = 999;
      try {
        var p   = lastAy.split('/');
        var lm  = parseInt(p[0], 10) || 1;
        var ly  = parseInt(p[1], 10) || 2024;
        var lastDate = new Date(ly, lm - 1, 15);
        var today    = new Date();
        daysSinceLastOrder = Math.max(0, Math.round((today - lastDate) / (1000 * 60 * 60 * 24)));
      } catch (_e) { /* silent */ }

      var momentum     = _calcMomentum(monthlySales);
      var consistency  = _calcConsistency(monthlySales);
      var campaignFlag = _detectCampaign(monthlySales);
      var classification = _classify(monthlySales, campaignFlag, momentum, consistency);
      var forecastBoxes  = _calcForecastBoxes(monthlySales);

      var reorderProbability = _calcReorderProbability({
        momentum:           momentum,
        consistency:        consistency,
        lastMonthBoxes:     lastMonthBoxes,
        monthCount:         monthCount,
        campaignFlag:       campaignFlag,
        classification:     classification,
        avgBoxes:           avgBoxes,
        daysSinceLastOrder: daysSinceLastOrder
      });

      results.push({
        gln:               e.gln,
        eczane:            e.eczane,
        brick:             e.brick,
        ttt:               e.ttt,
        totalBoxes:        totalBoxes,
        monthCount:        monthCount,
        monthlySales:      monthlySales,
        aylar:             ayKeys,
        avgBoxes:          Math.round(avgBoxes * 10) / 10,
        lastMonthBoxes:    lastMonthBoxes,
        lastPurchaseDate:  lastAy,
        daysSinceLastOrder: daysSinceLastOrder,
        trend:             momentum >= 65 ? 'yükselen' : momentum <= 35 ? 'düşüş' : 'sabit',
        momentum:          momentum,
        consistency:       consistency,
        campaignFlag:      campaignFlag,
        classification:    classification,
        forecastBoxes:     forecastBoxes,
        reorderProbability: reorderProbability,
        score:             0 // master score sonradan doldurulur
      });
    } catch (_err) {
      // null-safe: tek eczane hata verse devam et
    }
  });

  // Master score normalizasyonu için max forecast
  var maxForecast = results.reduce(function(m, r) { return Math.max(m, r.forecastBoxes); }, 1);

  results.forEach(function(r) {
    r.score = _calcMasterScore(
      r.reorderProbability,
      r.momentum,
      r.consistency,
      r.forecastBoxes,
      maxForecast
    );
    r.reason = _buildReason(r.classification, r.momentum, r.consistency, r.monthlySales);
  });

  return results;
}

// ── 13. buildTop30Reorder(ttt) ───────────────────────────────────────
// Score'a göre sıralı Top 30 — CAMPAIGN_BUYER hariç tutulur (düşük olasılık)
function buildTop30Reorder(tttFilter) {
  var all = analyzePharmacyHistory(tttFilter);

  var candidates = all.filter(function(r) {
    return r.classification !== 'CAMPAIGN_BUYER' && r.totalBoxes > 0;
  });

  candidates.sort(function(a, b) { return b.score - a.score; });

  return candidates.slice(0, 30).map(function(r, i) {
    return {
      rank:               i + 1,
      gln:                r.gln,
      eczane:             r.eczane,
      brick:              r.brick,
      ttt:                r.ttt,
      score:              r.score,
      reorderProbability: r.reorderProbability,
      forecastBoxes:      r.forecastBoxes,
      classification:     r.classification,
      momentum:           r.trend,
      lastMonthBoxes:     r.lastMonthBoxes,
      avgBoxes:           r.avgBoxes,
      daysSinceLastOrder: r.daysSinceLastOrder,
      campaignFlag:       r.campaignFlag,
      reason:             r.reason
    };
  });
}

// ── 14. runReorderIntelligence(ttt) ──────────────────────────────────
// Tüm hesapları çalıştırır, REORDER_INTELLIGENCE'ı günceller
function runReorderIntelligence(tttFilter) {
  try {
    // PHASE 5.2: pharmacyStore veya pharmacyActiveData kontrolü
    var _hasData = (window.pharmacyStore && window.pharmacyStore.normalized && window.pharmacyStore.normalized.length > 0)
      || (window.pharmacyActiveData && window.pharmacyActiveData.length > 0)
      || (typeof ECZANE_RAW !== 'undefined' && Array.isArray(ECZANE_RAW) && ECZANE_RAW.length > 0 && (typeof eczaneLoaded !== 'undefined' && eczaneLoaded));
    if (!_hasData) {
      console.warn('[ReorderEngine] Veri henüz yüklenmedi');
      return false;
    }

    var all   = analyzePharmacyHistory(tttFilter);
    var top30 = buildTop30Reorder(tttFilter);

    window.REORDER_INTELLIGENCE = {
      pharmacies:          all,
      top30:               top30,
      regularBuyers:       all.filter(function(r) { return r.classification === 'REGULAR_BUYER'; }),
      growingAccounts:     all.filter(function(r) { return r.classification === 'GROWING'; }),
      campaignBuyers:      all.filter(function(r) { return r.classification === 'CAMPAIGN_BUYER'; }),
      reactivationTargets: all.filter(function(r) { return r.classification === 'REACTIVATION'; }),
      riskAccounts:        all.filter(function(r) { return r.classification === 'AT_RISK'; }),
      generatedAt:         new Date().toISOString(),
      tttFilter:           tttFilter || 'TÜMÜ'
    };

    console.log('[ReorderEngine] ✅ Phase 4.6 tamamlandı:',
      all.length,    'eczane |',
      top30.length,  'top30 |',
      window.REORDER_INTELLIGENCE.growingAccounts.length,     'growing |',
      window.REORDER_INTELLIGENCE.regularBuyers.length,       'regular |',
      window.REORDER_INTELLIGENCE.reactivationTargets.length, 'reactivation |',
      window.REORDER_INTELLIGENCE.riskAccounts.length,        'risk'
    );

    return true;
  } catch (err) {
    console.error('[ReorderEngine] Hata:', err);
    return false;
  }
}

// ── 15. buildReorderContext(ttt) ─────────────────────────────────────
// AI Sales Coach context metni
function buildReorderContext(tttFilter) {
  try {
    var ri = window.REORDER_INTELLIGENCE;

    // Veri yoksa veya farklı ttt ise yeniden üret
    if (!ri || !ri.top30 || !ri.top30.length || ri.tttFilter !== (tttFilter || 'TÜMÜ')) {
      runReorderIntelligence(tttFilter);
      ri = window.REORDER_INTELLIGENCE;
    }

    if (!ri || !ri.top30 || !ri.top30.length) {
      return '\n\n--- REORDER INTELLIGENCE ---\n(Veri yok veya yüklenmedi)';
    }

    var lines = [
      '',
      '--- REORDER INTELLIGENCE (Phase 4.6) ---',
      'Üretim: ' + (ri.generatedAt ? ri.generatedAt.slice(0, 10) : '—'),
      'Toplam eczane: ' + (ri.pharmacies ? ri.pharmacies.length : 0),
      'Growing: '     + ri.growingAccounts.length +
      ' | Regular: '  + ri.regularBuyers.length +
      ' | Reactivation: ' + ri.reactivationTargets.length +
      ' | Risk: '     + ri.riskAccounts.length,
      '',
      'TOP REORDER TARGETS'
    ];

    ri.top30.forEach(function(e) {
      lines.push(
        '#' + e.rank + ' ' + e.eczane +
        '\n  Skor: '         + e.score +
        ' | Sipariş %: '     + e.reorderProbability +
        ' | Tahmin: '        + e.forecastBoxes + ' kutu' +
        ' | Tip: '           + e.classification +
        '\n  Brick: '         + e.brick +
        ' | Son alış: '      + (e.lastPurchaseDate || '?') +
        ' | Ort: '           + e.avgBoxes + ' kutu/ay' +
        '\n  Neden: '         + e.reason
      );
    });

    var totalForecast = ri.top30.reduce(function(s, e) { return s + (e.forecastBoxes || 0); }, 0);
    lines.push('');
    lines.push('TOP 30 Toplam Potansiyel: ' + totalForecast + ' kutu');

    // Yeniden kazanım fırsatları
    if (ri.reactivationTargets && ri.reactivationTargets.length) {
      lines.push('');
      lines.push('🔄 YENİDEN KAZANIM FIRSATLARI:');
      ri.reactivationTargets.slice(0, 5).forEach(function(r) {
        lines.push('  ' + r.eczane + ' [' + r.brick + ']' +
          ' — Ort: ' + r.avgBoxes + ' kutu, ' + r.daysSinceLastOrder + ' gündür sipariş yok');
      });
    }

    // Risk eczaneler
    if (ri.riskAccounts && ri.riskAccounts.length) {
      lines.push('');
      lines.push('⚠ KAYIP RİSKİ OLAN ECZANELER:');
      ri.riskAccounts.slice(0, 5).forEach(function(r) {
        lines.push('  ' + r.eczane + ' [' + r.brick + ']' +
          ' — ' + r.reason);
      });
    }

    // ── Satış Şartları & Sipariş Önerisi (Phase 4.7 entegrasyonu) ──────
    try {
      if (typeof buildSalesConditionsContext === 'function') {
        lines.push('');
        lines.push(buildSalesConditionsContext(tttFilter));
      }
    } catch (_scErr) { /* sales-conditions.js yüklü değilse sessiz geç */ }

    return lines.join('\n');

  } catch (err) {
    console.warn('[ReorderEngine] buildReorderContext hata:', err.message);
    return '';
  }
}

// ── 16. renderReorderCard(containerId, ttt) ───────────────────────────
// Dashboard kartı: "Bu Hafta Siparişe En Yakın 30 Eczane"
function renderReorderCard(containerId, tttFilter) {
  var container = document.getElementById(containerId);
  if (!container) return;

  var ok = runReorderIntelligence(tttFilter);
  var ri = window.REORDER_INTELLIGENCE;

  if (!ok || !ri || !ri.top30 || !ri.top30.length) {
    container.innerHTML =
      '<div style="padding:16px;text-align:center;color:var(--dim)">' +
      '⏳ Veri yükleniyor veya eczane verisi mevcut değil.</div>';
    return;
  }

  var totalForecast = ri.top30.reduce(function(s, e) { return s + (e.forecastBoxes || 0); }, 0);
  var avgScore      = Math.round(ri.top30.reduce(function(s, e) { return s + e.score; }, 0) / ri.top30.length);

  // Sınıf renk + rozeti
  var _classBadge = function(cls) {
    var map = {
      GROWING:        { bg: '#DCFCE7', color: '#15803D', label: '↑ Büyüyen'   },
      REGULAR_BUYER:  { bg: '#EFF6FF', color: '#1D4ED8', label: '✓ Düzenli'   },
      CAMPAIGN_BUYER: { bg: '#FEF3C7', color: '#D97706', label: '⚡ Kampanya'  },
      AT_RISK:        { bg: '#FEE2E2', color: '#DC2626', label: '⚠ Risk'      },
      REACTIVATION:   { bg: '#F3E8FF', color: '#7C3AED', label: '🔄 Kazan'    },
      ACTIVE:         { bg: '#F1F5F9', color: '#475569', label: 'Aktif'        },
      NEW:            { bg: '#F1F5F9', color: '#475569', label: 'Yeni'         }
    };
    var c = map[cls] || map['ACTIVE'];
    return '<span style="font-size:9px;background:' + c.bg +
           ';color:' + c.color +
           ';border-radius:4px;padding:1px 5px;white-space:nowrap">' +
           c.label + '</span>';
  };

  var _scoreColor = function(s) {
    return s >= 75 ? '#521FD1' : s >= 50 ? '#0891B2' : '#64748B';
  };

  var _probBar = function(p) {
    var bg = p >= 75 ? '#16A34A' : p >= 50 ? '#D97706' : '#DC2626';
    return '<div style="display:flex;align-items:center;gap:4px;justify-content:center">' +
      '<div style="width:36px;height:5px;border-radius:3px;background:#E2E8F0;overflow:hidden">' +
        '<div style="height:100%;width:' + p + '%;background:' + bg + ';border-radius:3px"></div>' +
      '</div>' +
      '<span style="font-size:10px;font-weight:700">%' + p + '</span>' +
    '</div>';
  };

  var rows = ri.top30.map(function(e) {
    return '<tr>' +
      '<td style="font-weight:700;color:var(--c1);text-align:center">' + e.rank + '</td>' +
      '<td style="font-weight:600">' + e.eczane + '</td>' +
      '<td style="font-size:10px;color:var(--dim)">'  + e.brick + '</td>' +
      '<td style="text-align:center">' + _classBadge(e.classification) + '</td>' +
      '<td style="text-align:center;font-weight:800;font-size:13px;color:' +
          _scoreColor(e.score) + '">' + e.score + '</td>' +
      '<td style="text-align:center">' + _probBar(e.reorderProbability) + '</td>' +
      '<td style="text-align:center;font-weight:700;color:#0891B2">' + e.forecastBoxes + '</td>' +
      '<td style="font-size:10px;color:var(--dim)">' + (e.reason || '') + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML =
    '<div class="card">' +
      '<div class="card-hd">' +
        '<span class="card-badge">' + ri.top30.length + ' eczane</span>' +
        '<span class="card-badge" style="margin-left:8px;background:#EFF6FF;color:#1D4ED8">' +
          'Toplam tahmin: ' + totalForecast + ' kutu</span>' +
        '<span class="card-badge" style="margin-left:8px;background:#F0FDF4;color:#15803D">' +
          'Ort. skor: ' + avgScore + '</span>' +
      '</div>' +
      '<div class="card-body-0 scroll-x">' +
        '<table class="tbl" style="min-width:800px">' +
          '<thead><tr>' +
            '<th style="text-align:center">#</th>' +
            '<th>Eczane</th>' +
            '<th>Brick</th>' +
            '<th>Sınıf</th>' +
            '<th style="text-align:center">Skor</th>' +
            '<th style="text-align:center">Sipariş %</th>' +
            '<th style="text-align:center">Tahmin Kutu</th>' +
            '<th>Neden</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
}

// ── 17. AI Sales Coach Entegrasyonu ──────────────────────────────────
// buildAiSalesCoachContext() varsa reorder context'i otomatik ekle
// ai-context.js pattern'ine uygun try/catch wrapper
(function _patchCoachForReorder() {
  window._REORDER_INTELLIGENCE_READY = true;
})();

console.log('[ReorderEngine] ✅ Phase 4.6 yüklendi');
