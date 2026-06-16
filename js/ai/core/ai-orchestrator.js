// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ai-orchestrator.js
//  FAZ 0 — AI Consolidation · AI Core Mimarisi
//
//  Sorumluluk: Tüm analiz motorlarını TEK NOKTADAN, sabit bir sırayla
//  çalıştırmak.
//
//    • run(context) → { risks, trends, insights, opportunities,
//                        recommendations, coach }
//
//  Sıralama (gerçek veri bağımlılığına göre):
//    risk-engine        → detectRisks(ttt)
//    trend-engine       → analyzeTrends(ttt)
//    insight-engine     → generateInsights(ttt)
//    opportunity-engine → findOpportunities(ttt)        [recommendation girdisi]
//    recommendation-engine → generateRecommendations(ttt, risks, opportunities, insights)
//    coach-engine       → buildSalesCoach(ttt)
//
//  Not: Master Prompt'taki "risk → trend → insight → recommendation → coach"
//  sıralaması korunmuştur; opportunity-engine, recommendation-engine'in
//  zorunlu girdisi olduğu için insight'tan SONRA, recommendation'dan ÖNCE
//  araya eklenmiştir (mevcut generateRecommendations() imzası değişmedi).
//
//  Performans: Aynı context (ttt + veri seti boyutu) için kısa süreli
//  cache kullanılır — gereksiz yeniden hesap yapılmaz.
//
//  Kurallar:
//    • Hiçbir motor burada yeniden yazılmadı — sadece sırayla çağrılır.
//    • DOM erişimi YOK.
//    • Bir motor eksikse (dosya yüklenmemişse) sessizce atlanır, hata
//      diğer motorları etkilemez.
//
//  Bağımlılık (yükleme sırasına göre):
//    insight-engine.js, trend-engine.js, risk-engine.js,
//    opportunity-engine.js, recommendation-engine.js, coach-engine.js
//  Yükleme sırası: yukarıdaki motorlar SONRASI, ai-core.js ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._AI_ORCHESTRATOR_LOADED) {
    console.warn('[ai-orchestrator] Zaten yüklü — atlandı');
    return;
  }
  window._AI_ORCHESTRATOR_LOADED = true;

  // ── Basit cache — aynı context için tekrar hesap yapılmasını önler ──
  var _cache = {};         // key → { result, ts, sig }
  var CACHE_TTL_MS = 60 * 1000; // 60 sn — veri senkron sıklığına göre yeterli

  // ── _dataSignature — veri seti değişmiş mi anlamak için ucuz imza ───
  function _dataSignature(context) {
    var d = (context && context.data) || {};
    var len = function (arr) { return (arr && arr.length) || 0; };
    return [len(d.ims), len(d.genel), len(d.migi), len(d.eczane)].join(':');
  }

  function _cacheKey(context) {
    return (context && context.ttt) || '__NO_TTT__';
  }

  function _emptyResult() {
    return {
      risks:           [],
      trends:          { trend: 'FLAT', confidence: 0, summary: '' },
      insights:        [],
      opportunities:   [],
      recommendations: [],
      coach:           null
    };
  }

  // ── run — orchestrator ana fonksiyonu ───────────────────────────────
  // @param {Object} context — ai-context-builder.buildContext() çıktısı
  //                            (en az { ttt } yeterlidir)
  // @returns {{ risks, trends, insights, opportunities, recommendations, coach }}
  function run(context) {
    context = context || {};
    var ttt = context.ttt;
    if (!ttt) return _emptyResult();

    // ── Cache kontrolü ─────────────────────────────────────────────
    var key = _cacheKey(context);
    var sig = _dataSignature(context);
    var cached = _cache[key];
    if (cached && cached.sig === sig && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      return cached.result;
    }

    var result = _emptyResult();

    try {
      // 1) RISK ───────────────────────────────────────────────────
      if (typeof detectRisks === 'function') {
        result.risks = detectRisks(ttt) || [];
      }

      // 2) TREND ──────────────────────────────────────────────────
      if (typeof analyzeTrends === 'function') {
        result.trends = analyzeTrends(ttt) || result.trends;
      }

      // 3) INSIGHT ────────────────────────────────────────────────
      if (typeof generateInsights === 'function') {
        result.insights = generateInsights(ttt) || [];
      }

      // 4) OPPORTUNITY (recommendation'ın girdisi) ───────────────
      if (typeof findOpportunities === 'function') {
        result.opportunities = findOpportunities(ttt) || [];
      }

      // 5) RECOMMENDATION ─────────────────────────────────────────
      if (typeof generateRecommendations === 'function') {
        result.recommendations = generateRecommendations(
          ttt, result.risks, result.opportunities, result.insights
        ) || [];
      }

      // 6) COACH ──────────────────────────────────────────────────
      if (typeof buildSalesCoach === 'function') {
        result.coach = buildSalesCoach(ttt) || null;
      }

      console.debug('[ai-orchestrator] run() tamamlandı.',
        'TTT:', ttt,
        '| Risks:', result.risks.length,
        '| Insights:', result.insights.length,
        '| Opps:', result.opportunities.length,
        '| Recs:', result.recommendations.length,
        '| Coach:', !!result.coach
      );

    } catch (e) {
      console.warn('[ai-orchestrator] run() hata (sessiz, kısmi sonuç döner):', e.message);
    }

    _cache[key] = { result: result, ts: Date.now(), sig: sig };
    return result;
  }

  // ── clearCache — veri senkronu sonrası manuel temizleme için ───────
  function clearCache() {
    _cache = {};
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.AIOrchestrator = {
    run:        run,
    clearCache: clearCache
  };

  console.debug('[ai-orchestrator] FAZ 0 yüklendi.');

})();
