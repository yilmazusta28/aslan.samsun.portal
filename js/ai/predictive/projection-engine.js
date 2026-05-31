// ══════════════════════════════════════════════════════════════════════
//  js/ai/predictive/projection-engine.js
//  Phase 3.1 — Predictive Forecast Engine
//
//  Sorumluluk: Tahmin + Senaryo + Risk → birleşik projeksiyon raporu
//    • buildProjectionReport(ttt)   → tam projeksiyon nesnesi
//    • formatProjectionForAI(report) → AI prompt metni (string)
//    • renderForecastSummary(ttt, [containerId]) → basit dashboard kartları
//
//  Pipeline:
//    calculateRunRate(ttt)
//    → generateForecast(ttt)
//    → simulateTargets(ttt)
//    → detectRisks(ttt)   [Phase 3.0 risk-engine]
//    → buildProjectionReport
//
//  AI entegrasyonu:
//    buildTTTContext() → formatProjectionForAI() eklenir (ai-context.js Phase 3.1 bloğu)
//
//  Bağımlılık (yükleme sırasına göre):
//    runrate-engine.js, forecast-engine.js, target-simulator.js,
//    risk-engine.js (Phase 3.0),
//    js/data/data-state.js, js/core/constants.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, calculateRunRate, generateForecast, simulateTargets,
          detectRisks, formatTargetsForAI */

(function () {
  'use strict';

  // ── Güven seviyesi etiketi ────────────────────────────────
  function _confLabel(score) {
    if (score >= 80) return 'Yüksek';
    if (score >= 55) return 'Orta';
    if (score >= 35) return 'Düşük';
    return 'Çok Düşük';
  }

  // ── Risk seviyesi → özet ──────────────────────────────────
  function _riskSummary(risks) {
    if (!risks || !risks.length) return 'DÜŞÜK';
    var hasHigh   = risks.some(function (r) { return r.severity === 'HIGH'; });
    var hasMedium = risks.some(function (r) { return r.severity === 'MEDIUM'; });
    if (hasHigh)   return 'YÜKSEK';
    if (hasMedium) return 'ORTA';
    return 'DÜŞÜK';
  }

  // ── buildProjectionReport ─────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   ttt:                  string,
  //   generatedAt:          string,
  //   periodLabel:          string,
  //   currentTL:            number,
  //   hedefTL:              number,
  //   currentReal:          number,
  //   monthEndForecast:     number,   // projectedTL
  //   monthEndBox:          number,   // projectedBox
  //   targetProjection:     number,   // projectedReal %
  //   riskLevel:            'DÜŞÜK'|'ORTA'|'YÜKSEK',
  //   confidence:           number,
  //   confidenceLabel:      string,
  //   scenarios:            Array,
  //   productForecasts:     Array,
  //   risks:                Array,
  //   insights:             string[],
  //   runRate:              object,
  //   forecast:             object
  // }}
  function buildProjectionReport(ttt) {
    var report = {
      ttt:              ttt,
      generatedAt:      new Date().toISOString(),
      periodLabel:      '—',
      currentTL:        0,
      hedefTL:          0,
      currentReal:      0,
      monthEndForecast: 0,
      monthEndBox:      0,
      targetProjection: 0,
      riskLevel:        'DÜŞÜK',
      confidence:       0,
      confidenceLabel:  'Çok Düşük',
      scenarios:        [],
      productForecasts: [],
      risks:            [],
      insights:         [],
      runRate:          {},
      forecast:         {}
    };

    if (!ttt) return report;

    try {
      // ── 1. Run Rate ───────────────────────────────────────
      var rr = (typeof calculateRunRate === 'function')
        ? calculateRunRate(ttt) : {};
      report.runRate      = rr;
      report.periodLabel  = rr.periodLabel || '—';

      // ── 2. Forecast ───────────────────────────────────────
      var fc = (typeof generateForecast === 'function')
        ? generateForecast(ttt) : {};
      report.forecast          = fc;
      report.currentTL         = fc.currentTL         || 0;
      report.hedefTL           = fc.hedefTL           || 0;
      report.monthEndForecast  = fc.projectedTL       || 0;
      report.monthEndBox       = fc.projectedBox      || 0;
      report.targetProjection  = fc.projectedReal     || 0;
      report.confidence        = fc.confidence        || 0;
      report.confidenceLabel   = _confLabel(report.confidence);
      report.productForecasts  = fc.productForecasts  || [];
      report.insights          = fc.insights          || [];

      // ── 3. Current realization ────────────────────────────
      report.currentReal = report.hedefTL > 0
        ? Math.round((report.currentTL / report.hedefTL) * 1000) / 10
        : 0;

      // ── 4. Target scenarios ───────────────────────────────
      report.scenarios = (typeof simulateTargets === 'function')
        ? simulateTargets(ttt) : [];

      // ── 5. Risks ──────────────────────────────────────────
      report.risks     = (typeof detectRisks === 'function')
        ? detectRisks(ttt) : [];
      report.riskLevel = _riskSummary(report.risks);

      // ── 6. Ek action insights ─────────────────────────────
      // %91 senaryo ulaşılamaz ise kritik uyarı ekle
      var s91 = report.scenarios.find(function (s) { return s.target === 91; });
      if (s91 && !s91.reachable && report.insights.indexOf('🔴 %91 prim eşiği mevcut hızla karşılanamıyor.') === -1) {
        report.insights.unshift('🔴 %91 prim eşiği mevcut hızla karşılanamıyor.');
      }

      console.debug('[projection-engine] buildProjectionReport OK.',
        'TTT:', ttt,
        '| Tahmini Real: %' + report.targetProjection,
        '| Risk:', report.riskLevel,
        '| Güven:', report.confidenceLabel
      );

    } catch (e) {
      console.warn('[projection-engine] buildProjectionReport hata:', e.message);
    }

    return report;
  }

  // ── formatProjectionForAI ─────────────────────────────────
  // Projeksiyon raporunu AI context metnine eklenecek bloğa çevirir.
  // @param {object} report  buildProjectionReport() çıktısı
  // @returns {string}
  function formatProjectionForAI(report) {
    if (!report) return '';

    var fTL = function (v) {
      return '₺' + Math.round(v).toLocaleString('tr-TR');
    };
    var fPct = function (v) { return '%' + v.toFixed(1); };

    var lines = [];
    lines.push('');
    lines.push('=== TAHMİNİ PROJEKSIYON RAPORU (PHASE 3.1) ===');
    lines.push('');
    lines.push('Dönem: ' + report.periodLabel);
    lines.push('Mevcut realizasyon : ' + fPct(report.currentReal) +
      ' (' + fTL(report.currentTL) + ' / ' + fTL(report.hedefTL) + ' hedef)');
    lines.push('Dönem sonu tahmini : ' + fPct(report.targetProjection) +
      ' (' + fTL(report.monthEndForecast) + ')');
    lines.push('Tahmini kutu satış : ' + Math.round(report.monthEndBox).toLocaleString('tr-TR') + ' kutu');
    lines.push('Günlük run rate    : ' + fTL(report.runRate.dailyRunRate || 0) + ' / iş günü');
    lines.push('Risk seviyesi      : ' + report.riskLevel);
    lines.push('Tahmin güveni      : ' + report.confidenceLabel + ' (%' + report.confidence + ')');

    // ── Metodoloji ────────────────────────────────────────
    if (report.forecast && report.forecast.methodology) {
      lines.push('Metodoloji         : ' + report.forecast.methodology);
    }

    // ── Akıllı insight'lar ────────────────────────────────
    if (report.insights && report.insights.length) {
      lines.push('');
      lines.push('TAHMİN GÖRÜŞÜ:');
      report.insights.forEach(function (ins) { lines.push('  ' + ins); });
    }

    // ── Ürün bazlı tahminler ──────────────────────────────
    if (report.productForecasts && report.productForecasts.length) {
      lines.push('');
      lines.push('ÜRÜN BAZLI TAHMİN:');
      report.productForecasts.forEach(function (pf) {
        var icon = pf.projectedReal >= 100 ? '✅' : pf.projectedReal >= 91 ? '🟡' : '⚠️';
        lines.push('  ' + icon + ' ' + pf.urun + ': tahmini %' + pf.projectedReal +
          ' (' + fTL(pf.projectedTL) + ')');
      });
    }

    // ── Hedef senaryoları ─────────────────────────────────
    if (report.scenarios && report.scenarios.length) {
      lines.push('');
      lines.push((typeof formatTargetsForAI === 'function')
        ? formatTargetsForAI(report.scenarios).trim()
        : 'Senaryo verisi mevcut.');
    }

    lines.push('');
    lines.push('NOT: Projeksiyon istatistiksel model çıktısıdır; veriyle çelişkili ise ham sayıyı esas al.');
    lines.push('=== PROJEKSİYON RAPORU SONU ===');

    return lines.join('\n');
  }

  // ── renderForecastSummary ─────────────────────────────────
  // Opsiyonel, hafif dashboard kartları (4 kart).
  // Mevcut sayfalara dokunmaz — sadece container varsa çalışır.
  // @param {string} ttt
  // @param {string} [containerId]
  function renderForecastSummary(ttt, containerId) {
    var container = document.getElementById(containerId || 'forecastSummaryContainer');
    if (!container) return; // Container yoksa sessizce çık

    var report = buildProjectionReport(ttt);

    var fTL = function (v) {
      return '₺' + Math.round(v).toLocaleString('tr-TR');
    };

    var realColor = report.targetProjection >= 100 ? '#16A34A'
      : report.targetProjection >= 91  ? '#D97706'
      : '#DC2626';

    var riskColor = report.riskLevel === 'YÜKSEK' ? '#DC2626'
      : report.riskLevel === 'ORTA' ? '#D97706' : '#16A34A';

    var confColor = report.confidence >= 70 ? '#16A34A'
      : report.confidence >= 45 ? '#D97706' : '#6B7280';

    // %91 senaryo ulaşılabilirlik
    var s91       = report.scenarios.find(function (s) { return s.target === 91; });
    var s91Icon   = s91 && s91.reachable ? '✅' : '❌';
    var s91Note   = s91 ? s91.note : '—';

    function _card(label, value, color, sub) {
      return '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:10px;padding:12px 14px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;' +
        'letter-spacing:.8px;margin-bottom:4px">' + label + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + color + ';line-height:1.2">' + value + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--dim,#6b7280);margin-top:3px;line-height:1.4">' + sub + '</div>' : '') +
        '</div>';
    }

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;padding:8px 0">';

    // Kart 1 — Tahmini Realizasyon
    html += _card('Tahmini Realizasyon',
      '%' + report.targetProjection,
      realColor,
      'Dönem sonu: ' + fTL(report.monthEndForecast) + ' | ' + report.periodLabel
    );

    // Kart 2 — %91 Senaryo
    html += _card('%91 Prim Eşiği',
      s91Icon + (s91 && s91.reachable ? ' Ulaşılabilir' : ' Zor'),
      s91 && s91.reachable ? '#16A34A' : '#DC2626',
      s91Note.length > 70 ? s91Note.slice(0, 70) + '…' : s91Note
    );

    // Kart 3 — Risk Seviyesi
    html += _card('Risk Seviyesi',
      report.riskLevel,
      riskColor,
      report.risks.length + ' risk tespit edildi'
    );

    // Kart 4 — Tahmin Güveni
    html += _card('Tahmin Güveni',
      '%' + report.confidence + ' — ' + report.confidenceLabel,
      confColor,
      report.forecast.methodology || ''
    );

    html += '</div>';

    // En önemli insight varsa altına ekle
    if (report.insights && report.insights.length) {
      html += '<div style="margin-top:6px;padding:10px 12px;background:var(--card,#fff);' +
        'border:1px solid var(--brd,#e5e7eb);border-radius:8px;font-size:11px;line-height:1.6">' +
        report.insights.join('<br>') +
        '</div>';
    }

    container.innerHTML = html;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildProjectionReport  = buildProjectionReport;
  window.formatProjectionForAI  = formatProjectionForAI;
  window.renderForecastSummary  = renderForecastSummary;

  console.debug('[projection-engine] Phase 3.1 yüklendi.');

})();
