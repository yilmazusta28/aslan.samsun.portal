// ══════════════════════════════════════════════════════════════════════
//  js/ai/executive/executive-engine.js
//  Phase 4.0 + 4.1 — Executive Dashboard AI
//
//  Sorumluluk: Tüm executive modülleri birleştiren orkestratör
//    • buildExecutiveDashboard()   → tam dashboard nesnesi
//    • buildExecutiveReport()      → AI prompt metni (string)
//    • renderExecutiveDashboard([containerId]) → opsiyonel kartlar
//
//  Bağımlılık:
//    team-ranking-engine.js, team-risk-engine.js,
//    team-forecast-engine.js, executive-summary-engine.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global buildTeamRanking, getManagementCategories,
          analyzeTeamRisk, getTeamRiskSummary,
          buildTeamForecast, generateExecutiveSummary,
          generateManagementInsights, ALL_TTTS */

(function () {
  'use strict';

  // ── buildExecutiveDashboard ───────────────────────────────
  // @param {string[]} [ttts]  — varsayılan ALL_TTTS
  // @returns {{ ranking, forecast, risks, summary, insights, generatedAt }}
  function buildExecutiveDashboard(ttts) {
    var report = {
      generatedAt: new Date().toISOString(),
      ranking:     [],
      forecast:    {},
      risks:       [],
      summary:     {},
      insights:    []
    };

    try {
      var list = ttts || (typeof ALL_TTTS !== 'undefined' ? ALL_TTTS : []);

      report.ranking  = typeof buildTeamRanking  === 'function' ? buildTeamRanking(list)  : [];
      report.risks    = typeof analyzeTeamRisk   === 'function' ? analyzeTeamRisk(list)   : [];
      report.forecast = typeof buildTeamForecast === 'function' ? buildTeamForecast(list) : {};
      report.summary  = typeof generateExecutiveSummary === 'function'
        ? generateExecutiveSummary(report.ranking, report.risks, report.forecast) : {};
      report.insights = typeof generateManagementInsights === 'function'
        ? generateManagementInsights(report.summary) : [];

      console.debug('[executive-engine] buildExecutiveDashboard OK.',
        'Reps:', list.length,
        '| Team forecast: %' + (report.forecast.teamForecast || 0),
        '| High risk:', (report.summary.highRisk || []).length);

    } catch (e) {
      console.warn('[executive-engine] buildExecutiveDashboard hata:', e.message);
    }

    return report;
  }

  // ── buildExecutiveReport ──────────────────────────────────
  // AI prompt metnine eklenecek yönetici raporu.
  // @param {object} [dashboard]  buildExecutiveDashboard() — opsiyonel
  // @returns {string}
  function buildExecutiveReport(dashboard) {
    var d = dashboard || buildExecutiveDashboard();
    var lines = [];

    lines.push('');
    lines.push('=== YÖNETİCİ RAPORU (PHASE 4.0 EXECUTIVE DASHBOARD) ===');
    lines.push('');

    // Ekip genel
    var fc = d.forecast || {};
    lines.push('EKİP DURUM ÖZETİ:');
    lines.push('  Ekip forecast : %' + (fc.teamForecast || 0).toFixed(1));
    lines.push('  Ekip hedef TL : ₺' + (fc.teamHedef || 0).toLocaleString('tr-TR'));
    lines.push('  Ekip satış TL : ₺' + (fc.teamSatis || 0).toLocaleString('tr-TR'));
    lines.push('  Tahmini prim  : ₺' + (fc.projectedPrim || 0).toLocaleString('tr-TR'));
    lines.push('  %91 üstü      : ' + (fc.repsAbove91 || 0) + ' temsilci');
    lines.push('  %91 altı      : ' + (fc.repsBelow91 || 0) + ' temsilci');

    // Özet
    var s = d.summary || {};
    if (s.topPerformer && s.topPerformer !== '—') {
      lines.push('  En iyi        : ' + s.topPerformer);
    }
    if (s.biggestRisk && s.biggestRisk !== '—') {
      lines.push('  En büyük risk : ' + s.biggestRisk);
    }

    // Yönetim görüşleri
    if (d.insights && d.insights.length) {
      lines.push('');
      lines.push('YÖNETİM GÖRÜŞLERİ:');
      d.insights.forEach(function (i) { lines.push('  • ' + i); });
    }

    // Top 5
    if (s.top5 && s.top5.length) {
      lines.push('');
      lines.push('SIRALAMADA İLK 5:');
      s.top5.forEach(function (r) {
        lines.push('  #' + r.rank + ' ' + r.ttt + ' — %' + r.realization +
          ' real | forecast %' + r.forecast + ' | [' + r.category + ']');
      });
    }

    // Yüksek risk
    if (s.highRisk && s.highRisk.length) {
      lines.push('');
      lines.push('YÜKSEK RİSK TEMSİLCİLER (' + s.highRisk.length + '):');
      s.highRisk.forEach(function (r) {
        lines.push('  🔴 ' + r.ttt + ' — %' + r.realization +
          ' | Nedenler: ' + r.reasons.slice(0, 2).join('; '));
      });
    }

    // Forecast winners / losers
    if (s.forecastWinners && s.forecastWinners.length) {
      lines.push('');
      lines.push('FORECAST LİDERLERİ:');
      s.forecastWinners.slice(0, 3).forEach(function (r) {
        lines.push('  ✅ ' + r.ttt + ' → %' + r.forecast + ' forecast');
      });
    }

    if (s.forecastLosers && s.forecastLosers.length) {
      lines.push('');
      lines.push('FORECAST GERİDE KALANLAR:');
      s.forecastLosers.slice(0, 3).forEach(function (r) {
        lines.push('  ⚠️ ' + r.ttt + ' → %' + r.forecast + ' forecast');
      });
    }

    lines.push('');
    lines.push('=== YÖNETİCİ RAPORU SONU ===');
    return lines.join('\n');
  }

  // ── renderExecutiveDashboard ──────────────────────────────
  // Opsiyonel kartlar — container yoksa sessizce çıkar.
  // @param {string} [containerId]  — varsayılan 'executiveDashboardContainer'
  function renderExecutiveDashboard(containerId) {
    var container = document.getElementById(containerId || 'executiveDashboardContainer');
    if (!container) return;

    var d = buildExecutiveDashboard();
    var fc = d.forecast || {};
    var s  = d.summary  || {};

    // Veri yok kontrolü — ranking boşsa hiçbir şey yazma, hata mesajı göster
    if (!d.ranking || d.ranking.length === 0) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim,#6b7280);font-size:12px">' +
        '<div style="font-size:28px;margin-bottom:8px">📊</div>' +
        'Ekip verisi yüklenmemiş. Ana sayfadan CSV dosyalarını yükleyin.' +
        '</div>';
      return;
    }

    function _card(label, value, color, sub) {
      return '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:10px;padding:12px 14px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;' +
        'letter-spacing:.8px;margin-bottom:4px">' + label + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + color + ';line-height:1.2">' + value + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--dim,#6b7280);margin-top:3px">' + sub + '</div>' : '') +
        '</div>';
    }

    var fcColor = (fc.teamForecast || 0) >= 100 ? '#16A34A'
      : (fc.teamForecast || 0) >= 91 ? '#D97706' : '#DC2626';
    var riskColor = s.teamRiskLevel === 'HIGH' ? '#DC2626'
      : s.teamRiskLevel === 'MEDIUM' ? '#D97706' : '#16A34A';

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;padding:8px 0">';

    html += _card('Ekip Forecast',
      '%' + (fc.teamForecast || 0).toFixed(1),
      fcColor,
      (fc.repsAbove91 || 0) + ' rep ≥ %91 · ' + (fc.repsBelow91 || 0) + ' rep < %91'
    );

    html += _card('Lider Temsilci',
      s.topPerformer ? s.topPerformer.split(' ')[0] : '—',
      '#16A34A',
      s.top5 && s.top5[0] ? '%' + s.top5[0].realization + ' real · forecast %' + s.top5[0].forecast : ''
    );

    html += _card('En Büyük Risk',
      s.biggestRisk ? s.biggestRisk.split(' ')[0] : '—',
      '#DC2626',
      s.highRisk && s.highRisk[0] ? s.highRisk[0].reasons[0] || '' : 'Risk yok'
    );

    html += _card('Tahmini Ekip Primi',
      fc.projectedPrim ? '₺' + Math.round(fc.projectedPrim).toLocaleString('tr-TR') : '—',
      '#4F008C',
      'Toplam ' + (d.ranking ? d.ranking.length : 0) + ' temsilci'
    );

    html += _card('Ekip Risk Seviyesi',
      s.teamRiskLevel || '—',
      riskColor,
      (s.highRisk ? s.highRisk.length : 0) + ' yüksek · ' +
      ((s.riskSummary && s.riskSummary.totalMedium) || 0) + ' orta risk'
    );

    html += '</div>';

    // Top 5 tablo
    if (s.top5 && s.top5.length) {
      html += '<div style="margin-top:8px;background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:8px;overflow:hidden">' +
        '<div style="padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.8px;' +
        'color:var(--dim,#6b7280);border-bottom:1px solid var(--brd,#e5e7eb)">İlk 5 Sıralama</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
        '<thead><tr style="background:#F9FAFB">' +
        '<th style="padding:6px 10px;text-align:left;font-weight:600;color:var(--dim)">#</th>' +
        '<th style="padding:6px 10px;text-align:left;font-weight:600;color:var(--dim)">Temsilci</th>' +
        '<th style="padding:6px 10px;text-align:center;font-weight:600;color:var(--dim)">Real</th>' +
        '<th style="padding:6px 10px;text-align:center;font-weight:600;color:var(--dim)">Forecast</th>' +
        '<th style="padding:6px 10px;text-align:center;font-weight:600;color:var(--dim)">Kategori</th>' +
        '</tr></thead><tbody>';

      s.top5.forEach(function (r) {
        var catColor = r.category === 'STAR' ? '#16A34A'
          : r.category === 'STABLE' ? '#059669'
          : r.category === 'WATCHLIST' ? '#D97706' : '#DC2626';
        html += '<tr style="border-top:1px solid var(--brd,#f3f4f6)">' +
          '<td style="padding:6px 10px;font-weight:700;color:var(--c1)">' + r.rank + '</td>' +
          '<td style="padding:6px 10px;font-weight:600">' + r.ttt.split(' ')[0] + '</td>' +
          '<td style="padding:6px 10px;text-align:center">%' + r.realization + '</td>' +
          '<td style="padding:6px 10px;text-align:center">%' + r.forecast + '</td>' +
          '<td style="padding:6px 10px;text-align:center">' +
          '<span style="background:' + catColor + '22;color:' + catColor + ';border-radius:3px;' +
          'padding:1px 5px;font-size:9px;font-weight:700">' + r.category + '</span></td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
    }

    // Management insights
    if (d.insights && d.insights.length) {
      html += '<div style="margin-top:6px;background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:8px;padding:10px 12px">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;' +
        'color:var(--dim,#6b7280);margin-bottom:6px">Yönetim Görüşleri</div>';
      d.insights.forEach(function (i) {
        html += '<div style="font-size:11px;padding:2px 0;line-height:1.5">• ' + i + '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildExecutiveDashboard  = buildExecutiveDashboard;
  window.buildExecutiveReport     = buildExecutiveReport;
  window.renderExecutiveDashboard = renderExecutiveDashboard;

  console.debug('[executive-engine] Phase 4.0 yüklendi.');
})();
