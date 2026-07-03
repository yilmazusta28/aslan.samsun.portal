// ══════════════════════════════════════════════════════════════
//  js/core/health-check.js — Runtime Sağlık Kontrolü
//  Phase 2.3.5 TASK 3
//
//  Sorumluluk:
//    • Runtime bileşenlerinin yüklü ve hazır olduğunu doğrular
//    • Console-only çıktı — UI değişikliği yok
//    • Phase 3 Intelligence Layer öncesi durum raporu
//
//  Kontrol edilen bileşenler:
//    data.IMS, data.GENEL, ai.proxy, charts.mkChart,
//    runtime.patches, data.state
//
//  Bağımlılık: Tüm core/data/ai modüller yüklü olduktan sonra çalışmalı
//  Yükleme sırası: runtime-patches.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── checkRuntimeHealth ─────────────────────────────────────
  // Tüm kritik runtime bileşenlerini kontrol eder.
  // @returns {{ runtime: string, data: string, ai: string, charts: string }}
  function checkRuntimeHealth() {
    var report = {
      runtime: 'UNKNOWN',
      data:    'UNKNOWN',
      ai:      'UNKNOWN',
      charts:  'UNKNOWN'
    };

    var issues = [];

    // ── DATA CHECK ──────────────────────────────────────────
    var imsOk   = typeof IMS   !== 'undefined' && Array.isArray(IMS);
    var genelOk = typeof GENEL !== 'undefined' && Array.isArray(GENEL);

    if (!imsOk)   issues.push('IMS tanımsız veya dizi değil');
    if (!genelOk) issues.push('GENEL tanımsız veya dizi değil');

    report.data = (imsOk && genelOk) ? 'OK' : 'WARN';

    // ── AI CHECK ───────────────────────────────────────────
    var proxyOk    = typeof window.AI_PROXY_URL === 'string' &&
                     window.AI_PROXY_URL.startsWith('http');
    var fetchAIOk  = typeof fetchAI === 'function';

    if (!proxyOk)   issues.push('AI_PROXY_URL tanımsız veya geçersiz');
    if (!fetchAIOk) issues.push('fetchAI fonksiyonu bulunamadı');

    report.ai = (proxyOk && fetchAIOk) ? 'OK' : 'WARN';

    // ── CHARTS CHECK ───────────────────────────────────────
    var mkChartOk      = typeof mkChart      === 'function';
    var destroyChartOk = typeof destroyChart === 'function';
    var chartsObjOk    = typeof charts       !== 'undefined';

    if (!mkChartOk)      issues.push('mkChart fonksiyonu bulunamadı');
    if (!destroyChartOk) issues.push('destroyChart fonksiyonu bulunamadı');
    if (!chartsObjOk)    issues.push('charts registri bulunamadı');

    report.charts = (mkChartOk && destroyChartOk && chartsObjOk) ? 'OK' : 'WARN';

    // ── RUNTIME CHECK ──────────────────────────────────────
    var patchesOk    = typeof installRuntimePatches === 'function';
    var renderGuardOk = typeof _renderGuard          === 'function';
    var goPageOk     = typeof goPage                 === 'function';
    var dataStateOk  = typeof resetDataState         === 'function' &&
                       typeof isDataReady            === 'function';
    var asyncGuardOk = typeof _aiInflight            !== 'undefined';

    if (!patchesOk)     issues.push('installRuntimePatches bulunamadı');
    if (!renderGuardOk) issues.push('_renderGuard bulunamadı');
    if (!goPageOk)      issues.push('goPage bulunamadı');
    if (!dataStateOk)   issues.push('data-state fonksiyonları eksik');
    if (!asyncGuardOk)  issues.push('_aiInflight guard bulunamadı');

    report.runtime = (patchesOk && renderGuardOk && goPageOk && dataStateOk && asyncGuardOk)
      ? 'OK' : 'WARN';

    // ── CONSOLE OUTPUT ─────────────────────────────────────
    var allOk = report.runtime === 'OK' &&
                report.data    === 'OK' &&
                report.ai      === 'OK' &&
                report.charts  === 'OK';

    if (allOk) {
      console.info('[health-check] ✅ Runtime sağlık kontrolü TAMAM', report);
    } else {
      console.warn('[health-check] ⚠️ Runtime uyarıları var', report);
      issues.forEach(function(issue) {
        console.warn('[health-check]  →', issue);
      });
    }

    return report;
  }

  // ── EXPORTS ────────────────────────────────────────────────
  window.checkRuntimeHealth = checkRuntimeHealth;

  console.debug('[health-check] Phase 2.3.5 runtime health check modülü yüklendi.');

})();
