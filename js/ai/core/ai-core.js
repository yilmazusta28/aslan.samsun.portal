// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/ai-core.js
//  FAZ 0 — AI Consolidation · AI Core Mimarisi
//
//  Sorumluluk: TÜM AI karar mekanizmasının MERKEZİ GİRİŞ NOKTASI.
//    • analyze(context) → standart sonuç modeli
//
//  Akış:
//    analyze(context)
//      → context tamamlanmamışsa AIContextBuilder.buildContext() ile tamamla
//      → AIOrchestrator.run(context) çalıştır
//      → sonucu STANDART SONUÇ MODELİ'ne map'le ve döndür
//
//  Bu dosyadan SONRA, eski tüketiciler (intelligence-orchestrator.js gibi)
//  kendi pipeline mantıklarını burada tekrar etmez — AICore.analyze()'ı
//  çağırıp kendi geriye-dönük-uyumlu formatlarına map ederler.
//
//  Kurallar:
//    • Mevcut tüm fonksiyonellik korunur (bkz. intelligence-orchestrator.js,
//      ai-context.js — değişmedi, sadece AICore'u içsel olarak kullanıyor).
//    • DOM erişimi YOK.
//    • UI hiçbir şekilde bu dosyaya yazmaz / bu dosyadan doğrudan okumaz —
//      UI katmanları yalnızca TÜKETİCİ (consumer)'dır.
//
//  Bağımlılık: js/ai/core/ai-context-builder.js, js/ai/core/ai-orchestrator.js
//  Yükleme sırası: ai-context-builder.js, ai-orchestrator.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._AI_CORE_LOADED) {
    console.warn('[ai-core] Zaten yüklü — atlandı');
    return;
  }
  window._AI_CORE_LOADED = true;

  var AI_CORE_VERSION = '0.1.0-faz0';

  // ── _emptyStandardResult ─────────────────────────────────────────
  function _emptyStandardResult() {
    return {
      risks:           [],
      trends:          { trend: 'FLAT', confidence: 0, summary: '' },
      insights:        [],
      recommendations: [],
      opportunities:   [],
      coach:           null,
      metadata: {
        generatedAt: new Date().toISOString(),
        version:     AI_CORE_VERSION
      }
    };
  }

  // ── analyze — merkezi giriş noktası ─────────────────────────────
  // @param {Object|string} [context] — ya tam context nesnesi
  //        (ai-context-builder çıktısı) ya da kısayol olarak sadece
  //        ttt string'i, ya da { ttt, brick, product, filters, ... }
  // @returns {{
  //   risks, trends, insights, recommendations, opportunities, coach,
  //   metadata: { generatedAt, version }
  // }}
  function analyze(context) {
    try {
      // Kısayol: analyze('AHMET YILMAZ') gibi doğrudan ttt geçilmişse
      if (typeof context === 'string') {
        context = { ttt: context };
      }

      // Context tamamlanmamışsa (ttt dışında data/period/filters yoksa)
      // ai-context-builder ile tamamla.
      var needsBuild = !context || !context.data || !context.period;
      var fullContext = context;
      if (needsBuild) {
        if (window.AIContextBuilder && typeof window.AIContextBuilder.buildContext === 'function') {
          fullContext = window.AIContextBuilder.buildContext(context || {});
        } else {
          fullContext = context || {};
        }
      }

      if (!fullContext || !fullContext.ttt) {
        var empty = _emptyStandardResult();
        console.warn('[ai-core] analyze() — geçerli ttt bulunamadı, boş sonuç döndürülüyor.');
        return empty;
      }

      var pipeline = (window.AIOrchestrator && typeof window.AIOrchestrator.run === 'function')
        ? window.AIOrchestrator.run(fullContext)
        : null;

      if (!pipeline) {
        console.warn('[ai-core] analyze() — AIOrchestrator bulunamadı, boş sonuç döndürülüyor.');
        return _emptyStandardResult();
      }

      return {
        risks:           pipeline.risks           || [],
        trends:          pipeline.trends           || { trend: 'FLAT', confidence: 0, summary: '' },
        insights:        pipeline.insights         || [],
        recommendations: pipeline.recommendations  || [],
        opportunities:   pipeline.opportunities     || [],
        coach:           pipeline.coach             || null,
        metadata: {
          generatedAt: new Date().toISOString(),
          version:     AI_CORE_VERSION,
          ttt:         fullContext.ttt
        }
      };

    } catch (e) {
      console.warn('[ai-core] analyze() hata (sessiz, boş sonuç döner):', e.message);
      return _emptyStandardResult();
    }
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.AICore = {
    analyze: analyze,
    version: AI_CORE_VERSION
  };

  console.debug('[ai-core] FAZ 0 yüklendi. Versiyon:', AI_CORE_VERSION);

})();
