// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/intelligence-orchestrator.js
//  Phase 3.0 — Sales Intelligence Engine
//  FAZ 0 GÜNCELLEMESİ — AI Consolidation: pipeline artık AI Core'a taşındı.
//
//  Sorumluluk: Geriye dönük uyumlu intelligence raporu üretmek
//    • buildSalesIntelligence(ttt) → { insights, trends, risks,
//                                       opportunities, recommendations }
//    • formatIntelligenceForAI(intel) → string (AI prompt eklentisi)
//    • renderIntelligenceSummary(ttt)  → DOM (opsiyonel, basit kartlar)
//
//  FAZ 0 ÖNCESİ: buildSalesIntelligence() risk/trend/insight/opportunity/
//    recommendation motorlarını BURADA sırayla çağırıyordu (pipeline kodu
//    bu dosyadaydı).
//  FAZ 0 SONRASI: pipeline mantığı js/ai/core/ai-orchestrator.js'e taşındı.
//    buildSalesIntelligence() artık SADECE window.AICore.analyze(ttt)'i
//    çağırıp sonucu bu dosyanın geriye dönük uyumlu (eski) şekline map eder.
//    AICore yüklü değilse (örn. dosya bulunamadıysa) eski pipeline'a
//    otomatik olarak geri döner — hiçbir tüketici (ai-context.js,
//    formatIntelligenceForAI, renderIntelligenceSummary) bundan etkilenmez.
//
//  AI çağrısı: YOK (sadece output AI prompt'una eklenir)
//  UI: Sadece renderIntelligenceSummary() — mevcut UI değiştirilmez
//
//  Bağımlılık (yükleme sırasına göre):
//    insight-engine.js, trend-engine.js, risk-engine.js,
//    opportunity-engine.js, recommendation-engine.js
//    (opsiyonel, varsa kullanılır) js/ai/core/ai-core.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── _buildSalesIntelligenceLegacy ─────────────────────────────────
  // FAZ 0 öncesi pipeline — AICore bulunamazsa fallback olarak kullanılır.
  // Davranış FAZ 0 öncesiyle birebir aynıdır (hiçbir fonksiyonellik kaybı yok).
  function _buildSalesIntelligenceLegacy(ttt) {
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
      if (typeof generateInsights === 'function') {
        result.insights = generateInsights(ttt);
      }
      if (typeof analyzeTrends === 'function') {
        result.trends = analyzeTrends(ttt);
      }
      if (typeof detectRisks === 'function') {
        result.risks = detectRisks(ttt);
      }
      if (typeof findOpportunities === 'function') {
        result.opportunities = findOpportunities(ttt);
      }
      if (typeof generateRecommendations === 'function') {
        result.recommendations = generateRecommendations(
          ttt, result.risks, result.opportunities, result.insights
        );
      }
    } catch (e) {
      console.warn('[intelligence-orchestrator] legacy pipeline hata:', e.message);
    }

    return result;
  }

  // ── buildSalesIntelligence ────────────────────────────────
  // Geriye dönük uyumlu ana fonksiyon. İçeride AICore.analyze() kullanır.
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
    if (!ttt) {
      return {
        ttt: ttt,
        generatedAt: new Date().toISOString(),
        insights: [], trends: { trend: 'FLAT', confidence: 0, summary: '' },
        risks: [], opportunities: [], recommendations: []
      };
    }

    try {
      // AI Core yüklüyse merkezi pipeline'ı kullan (tek kaynak).
      if (window.AICore && typeof window.AICore.analyze === 'function') {
        var core = window.AICore.analyze(ttt);
        var result = {
          ttt:             ttt,
          generatedAt:     (core.metadata && core.metadata.generatedAt) || new Date().toISOString(),
          insights:        core.insights        || [],
          trends:          core.trends           || { trend: 'FLAT', confidence: 0, summary: '' },
          risks:           core.risks            || [],
          opportunities:   core.opportunities    || [],
          recommendations: core.recommendations  || []
        };

        console.debug('[intelligence-orchestrator] buildSalesIntelligence (AICore üzerinden) tamamlandı.',
          'TTT:', ttt,
          '| Insights:', result.insights.length,
          '| Risks:', result.risks.length,
          '| Opps:', result.opportunities.length,
          '| Recs:', result.recommendations.length
        );

        return result;
      }
    } catch (e) {
      console.warn('[intelligence-orchestrator] AICore çağrısı hata verdi, legacy pipeline kullanılıyor:', e.message);
    }

    // AICore yoksa veya hata verdiyse — eski davranış korunur.
    return _buildSalesIntelligenceLegacy(ttt);
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

  // AUDIT2 Küçük Bulgu 5 temizliği: eski `renderIntelligenceSummary` render
  // sarmalayıcısı hiçbir yerde çağrılmıyordu (statik grep ile doğrulandı) —
  // altındaki gerçek veri motoru (buildSalesIntelligence → AICore.analyze)
  // ai-context.js üzerinden çalışmaya devam ediyor, bu satır SADECE ölü
  // render kodunu kaldırıyor. Rollback: git geçmişinden eski fonksiyon
  // gövdesi geri alınabilir, hiçbir başka dosya buna bağımlı değildi.

  // ── EXPORTS ────────────────────────────────────────────────
  window.buildSalesIntelligence     = buildSalesIntelligence;
  window.formatIntelligenceForAI    = formatIntelligenceForAI;

  console.debug('[intelligence-orchestrator] Phase 3.0 yüklendi.');

})();
