// ══════════════════════════════════════════════════════════════════════
//  js/ui/explainable-ai.js
//  FAZ 11.1 — Explainable AI "Neden?" Butonu
//
//  Sorumluluk:
//    decisionBasis (decision-engine.js FAZ 10.1) ve neden (route-optimizer
//    FAZ 10.3 5-kademe açıklaması) alanlarını insan-okur Türkçe cümlelere
//    çevirir. Ham JSON GÖSTERİLMEZ.
//
//  Public API:
//    renderNedenButton(decisionBasis, neden?)
//      → <details> HTML string (Neden? özeti + açılır Türkçe panel)
//    buildDecisionBasisText(decisionBasis, neden?)
//      → string[] — her eleman bir Türkçe açıklama cümlesi
//
//  Kullanım:
//    el.innerHTML += window.ExplainableAI.renderNedenButton(d.decisionBasis);
//
//  Tasarım notu:
//    Panel <details>/<summary> native HTML öğesiyle açılır/kapanır.
//    Ek JavaScript / modal gereksinimi yoktur. Ana ekranda KISA özet
//    (sadece summary metni) görünür; tıklanınca tam panel açılır.
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._EXPLAINABLE_AI_LOADED) {
    console.warn('[explainable-ai] Zaten yüklü — atlandı');
    return;
  }
  window._EXPLAINABLE_AI_LOADED = true;

  // decisionBasis + optional neden string → Turkish sentence array
  function buildDecisionBasisText(decisionBasis, neden) {
    var lines = [];
    var db = decisionBasis || {};

    // Ziyaret nedeni (FAZ 10.3 tier açıklaması)
    if (neden) {
      lines.push('📍 Ziyaret nedeni: ' + neden);
    }

    // En iyi fırsat bölgesi
    if (db.opportunityTop && db.opportunityTop.brick) {
      var s8 = db.opportunityTop.score8 != null
        ? ' (fırsat skoru: ' + Math.round(db.opportunityTop.score8) + ')'
        : '';
      lines.push('🎯 En yüksek fırsat bölgesi: ' + db.opportunityTop.brick + s8 + '.');
    }

    // Geçmiş öğrenme sinyali
    // BUG DÜZELTMESİ: learningSignal zaten 0-100 ölçeğinde geliyor
    // (LearningHub.getLearningContext().successRate → outcome-tracker.js'in
    // successRate hesabı 0-100 üretir, bkz. o dosyadaki refreshContextCache).
    // Burada ×100 yapmak örn. gerçek %73.4'ü ekranda "%7340" olarak
    // gösteriyordu — kullanıcıya doğrudan görünen "Neden?" panelinde.
    if (db.learningSignal != null) {
      var ls = Math.round(db.learningSignal);
      lines.push('📚 Geçmiş öğrenme başarısı: %' + ls + ' (benzer durumlarda sonuç alınan oran).');
    }

    // Kayıtlı outcome sinyali (AYNI DÜZELTME — zaten 0-100 ölçeğinde)
    if (db.outcomeSignal != null) {
      var os = Math.round(db.outcomeSignal);
      lines.push('📊 Kayıtlı sonuç başarısı: %' + os + ' (temsilcinin daha önce uyguladığı önerilerden başarıya ulaşma oranı).');
    }

    // Rakip kampanya riski
    if (db.competitiveFlag) {
      lines.push('⚠️ Bu bölgede aktif bir rakip kampanyası tespit edildi — öneri buna göre güncellendi.');
    }

    // Dönem / zaman bağlamı
    if (db.temporalContext) {
      var tc = db.temporalContext;
      var cycleStr = tc.cycleWeek != null ? 'Dönemin ' + tc.cycleWeek + '. haftası' : '';
      var remStr   = tc.remainingWeeks != null ? tc.remainingWeeks + ' hafta kaldı' : '';
      var imsStr   = tc.imsDataWeekRange ? ' · IMS verisi: ' + tc.imsDataWeekRange.label : '';
      var tLine    = [cycleStr, remStr].filter(Boolean).join(' · ');
      if (tLine) lines.push('📅 Zaman bağlamı: ' + tLine + imsStr + '.');
    }

    if (!lines.length) {
      lines.push('Bu karar için ek açıklama verisi mevcut değil.');
    }

    return lines;
  }

  // Returns a <details> HTML string with a "Neden?" summary toggle
  function renderNedenButton(decisionBasis, neden) {
    var lines = buildDecisionBasisText(decisionBasis, neden);
    var panelHtml = lines.map(function (l) {
      return '<div style="padding:3px 0;border-bottom:1px solid rgba(0,0,0,.06);' +
             'font-size:11px;color:var(--fg,#1e293b);line-height:1.5">' + _escHtml(l) + '</div>';
    }).join('');

    return (
      '<details style="display:inline-block;vertical-align:middle">' +
        '<summary style="cursor:pointer;list-style:none;font-size:10px;font-weight:700;' +
                 'color:#7C3AED;background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.2);' +
                 'border-radius:6px;padding:2px 8px;white-space:nowrap;user-select:none">❓ Neden?</summary>' +
        '<div style="position:absolute;z-index:999;background:var(--surf,#fff);' +
             'border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:10px 12px;' +
             'box-shadow:0 8px 24px rgba(0,0,0,.12);max-width:320px;margin-top:4px">' +
          '<div style="font-size:10px;font-weight:800;color:#7C3AED;margin-bottom:6px;' +
               'letter-spacing:.5px;text-transform:uppercase">Karar Gerekçesi</div>' +
          panelHtml +
        '</div>' +
      '</details>'
    );
  }

  // ── renderManualFeedbackButtons ── FAZ 11.2 ──────────────────────────
  // visitContext: { eczane, brick, ttt, product? }
  // Returns 4-button HTML string. Each button calls OutcomeTracker.recordManualFeedback().
  // Buttons are small and inline; the container should have position:relative.
  var _FEEDBACK_BTNS = [
    { type: 'UYGULANDIM',            label: '✓ Uygulandı',          clr: '#059669' },
    { type: 'SIPARIS_ALINDI',        label: '✓ Sipariş alındı',     clr: '#2563EB' },
    { type: 'SIPARIS_ALINAMADI',     label: '✗ Sipariş alınamadı',  clr: '#D97706' },
    { type: 'ZIYARET_GERCEKLESMEDI', label: '✗ Ziyaret yapılmadı',  clr: '#DC2626' }
  ];

  function renderManualFeedbackButtons(visitContext) {
    // Encode context for safe inline onclick (no quotes in values expected, but escape anyway)
    var ctxJson = JSON.stringify(visitContext || {})
      .replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var btns = _FEEDBACK_BTNS.map(function (fb) {
      return (
        '<button onclick="(function(){\n' +
          'var ctx=' + ctxJson.replace(/\n/g, '') + ';\n' +
          'if(window.OutcomeTracker&&typeof window.OutcomeTracker.recordManualFeedback===\'function\'){' +
            'window.OutcomeTracker.recordManualFeedback(ctx,\'' + fb.type + '\')' +
              '.then(function(){' +
                'var b=this;b.style.background=\'' + fb.clr + '\';b.style.color=\'#fff\';' +
                'b.disabled=true;' +
              '}.bind(this)).catch(function(){});' +
          '}' +
        '}).call(this)" ' +
        'style="font-size:10px;font-weight:700;cursor:pointer;border:1px solid ' + fb.clr + ';' +
               'color:' + fb.clr + ';background:transparent;border-radius:6px;padding:3px 8px;' +
               'margin:2px;white-space:nowrap;transition:background .15s">' +
          fb.label +
        '</button>'
      );
    }).join('');

    return (
      '<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:6px">' +
        btns +
      '</div>'
    );
  }

  // Minimal HTML escape (prevent XSS in dynamic text)
  function _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.ExplainableAI = {
    buildDecisionBasisText:       buildDecisionBasisText,
    renderNedenButton:            renderNedenButton,
    renderManualFeedbackButtons:  renderManualFeedbackButtons,
    version:                      '11.1'
  };

  window.renderNedenButton           = renderNedenButton;
  window.renderManualFeedbackButtons = renderManualFeedbackButtons;

  console.debug('[explainable-ai] FAZ 11.1 yüklendi.');

})();
