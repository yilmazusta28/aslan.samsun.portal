// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/intelligence-orchestrator.js
//  Phase 3.0 — Sales Intelligence Engine
//
//  Sorumluluk: Tüm intelligence motorlarını koordine et
//    • buildSalesIntelligence(ttt) → { insights, trends, risks,
//                                       opportunities, recommendations }
//    • formatIntelligenceForAI(intel) → string (AI prompt eklentisi)
//    • renderIntelligenceSummary(ttt)  → DOM (opsiyonel, basit kartlar)
//
//  Pipeline: insights → trends → risks → opportunities → recommendations
//  AI çağrısı: YOK (sadece output AI prompt'una eklenir)
//  UI: Sadece renderIntelligenceSummary() — mevcut UI değiştirilmez
//
//  Bağımlılık (yükleme sırasına göre):
//    insight-engine.js, trend-engine.js, risk-engine.js,
//    opportunity-engine.js, recommendation-engine.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── buildSalesIntelligence ────────────────────────────────
  // Ana pipeline fonksiyonu.
  // @param {string} ttt
  // @returns {{
  //   ttt: string,
  //   generatedAt: string,
  //   insights: Array,
  //   trends: Object,
  //   risks: Array,
  //   opportunities: Array,
  //   recommendations: Array
  // }}
  function buildSalesIntelligence(ttt) {
    var result = {
      ttt: ttt,
      generatedAt: new Date().toISOString(),
      insights:        [],
      trends:          { trend: 'FLAT', confidence: 0, summary: '' },
      risks:           [],
      opportunities:   [],
      recommendations: []
    };

    if (!ttt) return result;

    try {
      // 1. Insights
      if (typeof generateInsights === 'function') {
        result.insights = generateInsights(ttt);
      }

      // 2. Trends
      if (typeof analyzeTrends === 'function') {
        result.trends = analyzeTrends(ttt);
      }

      // 3. Risks
      if (typeof detectRisks === 'function') {
        result.risks = detectRisks(ttt);
      }

      // 4. Opportunities
      if (typeof findOpportunities === 'function') {
        result.opportunities = findOpportunities(ttt);
      }

      // 5. Recommendations (risk + opportunity + insight aware)
      if (typeof generateRecommendations === 'function') {
        result.recommendations = generateRecommendations(
          ttt,
          result.risks,
          result.opportunities,
          result.insights
        );
      }

      console.debug('[intelligence-orchestrator] buildSalesIntelligence tamamlandı.',
        'TTT:', ttt,
        '| Insights:', result.insights.length,
        '| Risks:', result.risks.length,
        '| Opps:', result.opportunities.length,
        '| Recs:', result.recommendations.length
      );

    } catch (e) {
      console.warn('[intelligence-orchestrator] buildSalesIntelligence hata:', e.message);
    }

    return result;
  }

  // ── formatIntelligenceForAI ───────────────────────────────
  // Intelligence raporunu AI prompt'una eklenecek metin bloğuna çevirir.
  // buildTTTContext() sonuna EKLENİR — mevcut context silinmez.
  // @param {{ insights, trends, risks, opportunities, recommendations }} intel
  // @returns {string}
  function formatIntelligenceForAI(intel) {
    if (!intel) return '';

    var lines = [];
    lines.push('');
    lines.push('=== SATIŞ İNTELLİGENCE RAPORU (OTOMATİK ANALİZ) ===');

    // ── Trend ─────────────────────────────────────────────
    if (intel.trends && intel.trends.trend) {
      var t = intel.trends;
      var trendIcon = t.trend === 'UP' ? '📈' : t.trend === 'DOWN' ? '📉' : '➡️';
      lines.push('');
      lines.push('TREND: ' + trendIcon + ' ' + t.trend + ' (güven: %' + t.confidence + ')');
      lines.push(t.summary);
      if (t.acceleration) lines.push('⚡ İvme artışı tespit edildi.');
      if (t.reversal)     lines.push('🔄 Trend dönüşü tespit edildi.');
    }

    // ── Insights ──────────────────────────────────────────
    if (intel.insights && intel.insights.length) {
      lines.push('');
      lines.push('OTOMATİK İNSIGHTLAR:');
      intel.insights.forEach(function(ins) {
        var icon = ins.level === 'positive' ? '✅' : ins.level === 'negative' ? '⚠️' : 'ℹ️';
        lines.push('  ' + icon + ' ' + ins.text);
      });
    }

    // ── Risks ─────────────────────────────────────────────
    if (intel.risks && intel.risks.length) {
      lines.push('');
      lines.push('TESPİT EDİLEN RİSKLER:');
      intel.risks.forEach(function(r) {
        var icon = r.severity === 'HIGH' ? '🔴' : r.severity === 'MEDIUM' ? '🟡' : '🟢';
        lines.push('  ' + icon + ' [' + r.severity + '] ' + r.title + ': ' + r.detail);
      });
    }

    // ── Opportunities ─────────────────────────────────────
    if (intel.opportunities && intel.opportunities.length) {
      lines.push('');
      lines.push('TESPİT EDİLEN FIRSATLAR:');
      intel.opportunities.forEach(function(o) {
        lines.push('  🎯 [#' + o.priority + '] ' + o.title + ': ' + o.reason);
      });
    }

    // ── Recommendations ───────────────────────────────────
    if (intel.recommendations && intel.recommendations.length) {
      lines.push('');
      lines.push('ÖNERİLEN AKSİYONLAR:');
      intel.recommendations.forEach(function(rec) {
        var urgencyTag = rec.urgency === 'NOW' ? '[BUGÜN]' :
                         rec.urgency === 'THIS_WEEK' ? '[BU HAFTA]' : '[BU DÖNEM]';
        lines.push('  ' + urgencyTag + ' #' + rec.priority + ': ' + rec.action);
        if (rec.detail) lines.push('    → ' + rec.detail);
      });
    }

    lines.push('');
    lines.push('NOT: Yukarıdaki analiz otomatik olarak üretilmiştir. Sayısal verilerle çelişki varsa veri setini esas al.');
    lines.push('=== RAPOR SONU ===');

    return lines.join('\n');
  }

  // ── renderIntelligenceSummary ─────────────────────────────
  // Opsiyonel basit UI — Top Risk / Top Opportunity / Trend Score kartları.
  // Mevcut sayfalara eklenmez; sadece çağrıldığında belirtilen container'a yazar.
  // @param {string} ttt
  // @param {string} [containerId]  — varsayılan: 'intelligenceSummaryContainer'
  function renderIntelligenceSummary(ttt, containerId) {
    var container = document.getElementById(containerId || 'intelligenceSummaryContainer');
    if (!container) return; // Container yoksa sessizce çık — UI bozulmaz

    var intel = buildSalesIntelligence(ttt);

    var topRisk = intel.risks && intel.risks[0];
    var topOpp  = intel.opportunities && intel.opportunities[0];
    var trend   = intel.trends;
    var topRec  = intel.recommendations && intel.recommendations[0];

    var severityColor = function(s) {
      return s === 'HIGH' ? 'var(--bad, #DC2626)' : s === 'MEDIUM' ? '#D97706' : '#16A34A';
    };
    var trendColor = function(t) {
      return t === 'UP' ? '#16A34A' : t === 'DOWN' ? '#DC2626' : '#6B7280';
    };

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:10px 0">';

    // Trend kartı
    html += '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:12px">' +
      '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:1px">Trend</div>' +
      '<div style="font-size:20px;font-weight:700;color:' + trendColor(trend.trend) + ';margin:4px 0">' +
        (trend.trend === 'UP' ? '📈' : trend.trend === 'DOWN' ? '📉' : '➡️') + ' ' + trend.trend +
      '</div>' +
      '<div style="font-size:11px;color:var(--dim,#6b7280)">' + (trend.summary || '—') + '</div>' +
      '<div style="font-size:10px;margin-top:4px;color:var(--dim,#6b7280)">Güven: %' + trend.confidence + '</div>' +
    '</div>';

    // Top Risk kartı
    if (topRisk) {
      html += '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:1px">En Yüksek Risk</div>' +
        '<div style="font-size:13px;font-weight:600;color:' + severityColor(topRisk.severity) + ';margin:4px 0">' + topRisk.title + '</div>' +
        '<div style="font-size:11px;color:var(--dim,#6b7280);line-height:1.4">' + topRisk.detail.slice(0, 80) + (topRisk.detail.length > 80 ? '…' : '') + '</div>' +
      '</div>';
    }

    // Top Opportunity kartı
    if (topOpp) {
      html += '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:1px">En İyi Fırsat</div>' +
        '<div style="font-size:13px;font-weight:600;color:#4F008C;margin:4px 0">' + topOpp.title + '</div>' +
        '<div style="font-size:11px;color:var(--dim,#6b7280);line-height:1.4">' + topOpp.reason + '</div>' +
      '</div>';
    }

    // Top Recommendation kartı
    if (topRec) {
      html += '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:1px">Öncelikli Aksiyon</div>' +
        '<div style="font-size:11px;font-weight:600;color:var(--fg,#111);margin:4px 0">' +
          '<span style="background:#4F008C;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;margin-right:4px">' +
          (topRec.urgency === 'NOW' ? 'BUGÜN' : topRec.urgency === 'THIS_WEEK' ? 'BU HAFTA' : 'BU DÖNEM') + '</span>' +
          topRec.action +
        '</div>' +
        '<div style="font-size:11px;color:var(--dim,#6b7280);line-height:1.4">' + (topRec.detail || '').slice(0, 80) + (topRec.detail && topRec.detail.length > 80 ? '…' : '') + '</div>' +
      '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // ── EXPORTS ────────────────────────────────────────────────
  window.buildSalesIntelligence     = buildSalesIntelligence;
  window.formatIntelligenceForAI    = formatIntelligenceForAI;
  window.renderIntelligenceSummary  = renderIntelligenceSummary;

  console.debug('[intelligence-orchestrator] Phase 3.0 yüklendi.');

})();
