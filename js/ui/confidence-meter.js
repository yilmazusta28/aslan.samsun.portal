// ══════════════════════════════════════════════════════════════════════
//  js/ui/confidence-meter.js
//  FAZ 11.0 — AI Confidence Meter (UI Standardizasyonu)
//
//  Sorumluluk:
//    Var olan confidence değerlerini (decision-engine, forecast-engine,
//    reorder-classifier, Digital Twin confidenceScore) TUTARLI bir UI
//    bileşenine bağlar. Yeni confidence HESABI yoktur — sadece sunum.
//
//  Public API:
//    renderConfidenceMeter(score) → HTML string (inline progress-bar + badge)
//
//  Kullanım:
//    el.innerHTML += window.ConfidenceMeter.renderConfidenceMeter(85);
//    // veya bare global:
//    el.innerHTML += renderConfidenceMeter(85);
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._CONFIDENCE_METER_LOADED) {
    console.warn('[confidence-meter] Zaten yüklü — atlandı');
    return;
  }
  window._CONFIDENCE_METER_LOADED = true;

  // score: 0-100 integer/float
  // Returns a compact inline HTML string: progress bar + badge
  function renderConfidenceMeter(score) {
    var s   = Math.max(0, Math.min(100, Math.round(score || 0)));
    var clr = s >= 70 ? '#16A34A' : s >= 40 ? '#D97706' : '#DC2626';
    return (
      '<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle">' +
        '<span style="display:inline-block;width:36px;height:5px;border-radius:3px;' +
               'background:rgba(0,0,0,.1);overflow:hidden;vertical-align:middle">' +
          '<span style="display:block;height:100%;width:' + s + '%;' +
                 'background:' + clr + ';border-radius:3px"></span>' +
        '</span>' +
        '<span style="display:inline-block;min-width:32px;font-size:10px;font-weight:800;' +
               'color:#fff;background:' + clr + ';border-radius:4px;padding:1px 5px;' +
               'text-align:center;white-space:nowrap">%' + s + '</span>' +
      '</span>'
    );
  }

  window.ConfidenceMeter = {
    renderConfidenceMeter: renderConfidenceMeter,
    version: '11.0'
  };

  // Bare global for inline template literals
  window.renderConfidenceMeter = renderConfidenceMeter;

  console.debug('[confidence-meter] FAZ 11.0 yüklendi.');

})();
