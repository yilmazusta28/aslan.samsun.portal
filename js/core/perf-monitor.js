// ══════════════════════════════════════════════════════════════
//  js/core/perf-monitor.js — Performans İzleme
//  Phase 2.3.5 TASK 5
//
//  Sorumluluk:
//    • syncData, AI yanıt, render, sayfa geçişi sürelerini ölç
//    • performance.now() tabanlı hassas zamanlama
//    • Console-only çıktı — UI değişikliği yok
//    • Sıfır overhead: izleme passif, hiçbir fonksiyonu bloke etmez
//
//  Kullanım:
//    var t = perfStart('syncData');
//    // ... işlem ...
//    perfEnd(t, 'syncData');
//
//  Bağımlılık: Yok — bağımsız modül
//  Yükleme sırası: En erken yüklenebilir
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── Ölçüm Geçmişi ─────────────────────────────────────────
  // Her metrik için son N ölçümü tut (bellek kontrolü)
  var MAX_SAMPLES = 20;

  var _metrics = {
    syncData:       [],
    aiResponse:     [],
    render:         [],
    pageTransition: []
  };

  // ── perfStart ──────────────────────────────────────────────
  // Zamanlayıcı başlatır. Döndürdüğü token perfEnd'e geçilmeli.
  // @param {string} label  — ölçüm etiketi (konsol için)
  // @returns {{ label: string, t0: number }}
  function perfStart(label) {
    return { label: label || 'unknown', t0: performance.now() };
  }

  // ── perfEnd ────────────────────────────────────────────────
  // Zamanlayıcıyı bitirir, sonucu kaydeder ve konsola yazar.
  // @param {{ label: string, t0: number }} token  — perfStart çıktısı
  // @param {string} [category]  — 'syncData'|'aiResponse'|'render'|'pageTransition'
  // @returns {number}  — geçen süre (ms)
  function perfEnd(token, category) {
    if (!token || typeof token.t0 !== 'number') return 0;
    var elapsed = +(performance.now() - token.t0).toFixed(2);
    var cat     = category || token.label;

    // Geçmiş kayıt
    if (_metrics[cat]) {
      _metrics[cat].push(elapsed);
      if (_metrics[cat].length > MAX_SAMPLES) {
        _metrics[cat].shift();
      }
    }

    // Konsol çıktısı — WARNING rengi eşikleri
    var prefix = '[perf] ' + (token.label || cat);
    if (elapsed > 3000) {
      console.warn(prefix + ': ' + elapsed + 'ms ⚠️ YAVAŞ');
    } else if (elapsed > 1000) {
      console.info(prefix + ': ' + elapsed + 'ms');
    } else {
      console.debug(prefix + ': ' + elapsed + 'ms');
    }

    return elapsed;
  }

  // ── perfReport ─────────────────────────────────────────────
  // Tüm metriklerin özet istatistiklerini konsola yazar.
  // @returns {Object} — kategori bazlı istatistik objesi
  function perfReport() {
    var summary = {};

    Object.keys(_metrics).forEach(function(cat) {
      var samples = _metrics[cat];
      if (samples.length === 0) {
        summary[cat] = { count: 0 };
        return;
      }
      var sum  = samples.reduce(function(a, b) { return a + b; }, 0);
      var avg  = +(sum / samples.length).toFixed(2);
      var min  = +Math.min.apply(null, samples).toFixed(2);
      var max  = +Math.max.apply(null, samples).toFixed(2);
      var last = samples[samples.length - 1];
      summary[cat] = { count: samples.length, avg: avg, min: min, max: max, last: last };
    });

    console.info('[perf] ── Performans Raporu ──────────────────');
    Object.keys(summary).forEach(function(cat) {
      var s = summary[cat];
      if (s.count === 0) {
        console.debug('[perf]   ' + cat + ': ölçüm yok');
      } else {
        console.info('[perf]   ' + cat +
          ': son=' + s.last + 'ms | ort=' + s.avg + 'ms | min=' + s.min + 'ms | max=' + s.max + 'ms | n=' + s.count);
      }
    });
    console.info('[perf] ─────────────────────────────────────');

    return summary;
  }

  // ── perfClear ──────────────────────────────────────────────
  // Tüm ölçüm geçmişini sıfırlar.
  function perfClear() {
    Object.keys(_metrics).forEach(function(cat) { _metrics[cat] = []; });
    console.debug('[perf] Ölçüm geçmişi temizlendi.');
  }

  // ── EXPORTS ────────────────────────────────────────────────
  window.perfStart  = perfStart;
  window.perfEnd    = perfEnd;
  window.perfReport = perfReport;
  window.perfClear  = perfClear;

  console.debug('[perf-monitor] Phase 2.3.5 performans izleme modülü yüklendi.');

})();
