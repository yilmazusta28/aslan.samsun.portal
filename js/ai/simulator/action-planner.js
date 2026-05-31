// ══════════════════════════════════════════════════════════════════════
//  js/ai/simulator/action-planner.js
//  Phase 3.2 — Smart Target Simulator
//
//  Sorumluluk: Aksiyon planı + tam simülatör entegrasyonu
//    • buildActionPlan(ttt)          → öncelikli aksiyon listesi
//    • buildFullSimulation(ttt)      → tüm Phase 3.2 çıktısını birleştirir
//    • formatSimulationForAI(report) → AI context metnine eklenir
//    • renderTargetSimulator(ttt, [containerId]) → opsiyonel dashboard kartları
//
//  Pipeline:
//    simulateTarget × 4 senaryosu
//    + simulatePrim + bestPrimScenario
//    + buildScenario (worst/expected/best)
//    + analyzeProductImpact
//    + analyzeBrickImpact
//    + calculateTargetProbability
//    → buildActionPlan
//    → formatSimulationForAI (AI context'e eklenir)
//
//  AI entegrasyonu:
//    buildTTTContext() → formatSimulationForAI() (ai-context.js Phase 3.2 bloğu)
//
//  Bağımlılık:
//    js/ai/simulator/target-simulator-engine.js
//    js/ai/simulator/prim-simulator.js
//    js/ai/simulator/scenario-builder.js
//    js/ai/predictive/runrate-engine.js
//    js/data/data-state.js (GENEL)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL,
          simulateTarget, calculateTargetProbability, formatSimulatorForAI,
          simulatePrim, bestPrimScenario, formatPrimForAI,
          buildScenario, analyzeProductImpact, analyzeBrickImpact, formatScenariosForAI,
          calculateRunRate */

(function () {
  'use strict';

  // ── buildActionPlan ───────────────────────────────────────
  // Ürün etkisi + brick etkisi + prim optimizasyonu → sıralı aksiyon listesi.
  //
  // @param {string} ttt
  // @returns {Array<{
  //   priority:   number,
  //   category:   'ÜRÜN'|'BRICK'|'PRİM'|'HEDEF',
  //   action:     string,
  //   detail:     string,
  //   impact:     string,   — beklenen TL/realizasyon etkisi
  //   urgency:    'BUGÜN'|'BU HAFTA'|'BU DÖNEM'
  // }>}
  function buildActionPlan(ttt) {
    var plan = [];
    var priority = 1;

    try {
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (!gt) return plan;

      var currentReal = gt.tl_pct || 0;
      var rr = (typeof calculateRunRate === 'function')
        ? calculateRunRate(ttt)
        : { remainingDays: 0, dailyRunRate: 0 };
      var remaining = rr.remainingDays || 0;

      // ── 1. Acil hedef aksiyonu (dönem pozisyonu) ──────────
      var s91  = (typeof simulateTarget === 'function') ? simulateTarget(ttt, 91)  : null;
      var s100 = (typeof simulateTarget === 'function') ? simulateTarget(ttt, 100) : null;

      if (s91 && !s91.achievable && currentReal < 91) {
        plan.push({
          priority:  priority++,
          category:  'HEDEF',
          action:    '%91 prim eşiğine odaklan',
          detail:    'Günlük ₺' + (s91.requiredDailySales || 0).toLocaleString('tr-TR') +
            ' satış gerekiyor. Prim alabilmek için minimum eşik.',
          impact:    'Prim kaybını önler.',
          urgency:   remaining <= 5 ? 'BUGÜN' : remaining <= 15 ? 'BU HAFTA' : 'BU DÖNEM'
        });
      } else if (s91 && s91.achievable && currentReal >= 91 && s100 && s100.achievable) {
        plan.push({
          priority:  priority++,
          category:  'HEDEF',
          action:    '%100 tam prime ulaş',
          detail:    'Günlük ₺' + (s100.requiredDailySales || 0).toLocaleString('tr-TR') +
            ' satışla tam prime ulaşılabilir (×' + (s100.accelerationFactor || 1) + ' ivme).',
          impact:    'Tam prim + portföy bonusu.',
          urgency:   'BU HAFTA'
        });
      }

      // ── 2. En yüksek kaldıraçlı ürün ─────────────────────
      var prodImpact = (typeof analyzeProductImpact === 'function')
        ? analyzeProductImpact(ttt, 10) : [];

      prodImpact.slice(0, 2).forEach(function (p) {
        var urgency = p.currentReal < 70 ? 'BUGÜN' : p.currentReal < 85 ? 'BU HAFTA' : 'BU DÖNEM';
        plan.push({
          priority:  priority++,
          category:  'ÜRÜN',
          action:    p.product + ' satışlarını artır',
          detail:    p.product + ' mevcut real: %' + p.currentReal +
            '. %10 büyüme = genel real +%' + p.realizationGain + '.',
          impact:    'Toplam TL açığının %' + p.tlGapContrib + '\'ini kapatır.',
          urgency:   urgency
        });
      });

      // ── 3. En yüksek kaldıraçlı brick ────────────────────
      var brickImpact = (typeof analyzeBrickImpact === 'function')
        ? analyzeBrickImpact(ttt) : [];

      brickImpact.slice(0, 3).forEach(function (b) {
        if (b.impactScore < 15) return; // düşük etkili brickleri atla
        plan.push({
          priority:  priority++,
          category:  'BRICK',
          action:    b.brick + ' brickine odaklan',
          detail:    'Pazar payı %' + b.ourShare + ' — %10 artışta ₺' +
            (b.potentialTL || 0).toLocaleString('tr-TR') + ' ek TL.',
          impact:    'Etki skoru: ' + b.impactScore + '/100.',
          urgency:   b.sira <= 100 ? 'BUGÜN' : b.sira <= 333 ? 'BU HAFTA' : 'BU DÖNEM'
        });
      });

      // ── 4. Prim optimizasyonu ─────────────────────────────
      var best = (typeof bestPrimScenario === 'function') ? bestPrimScenario(ttt) : null;
      if (best && best.realization > currentReal && best.requiredDailyExtra > 0) {
        plan.push({
          priority:  priority++,
          category:  'PRİM',
          action:    '%' + best.realization + ' hedefine odaklan — ' + best.label,
          detail:    'Günlük ₺' + best.requiredDailyExtra.toLocaleString('tr-TR') +
            ' ek satışla toplam prim ₺' + best.prim.toLocaleString('tr-TR') + ' olur.',
          impact:    '₺' + best.prim.toLocaleString('tr-TR') + ' prim.',
          urgency:   'BU HAFTA'
        });
      }

      // ── 5. Risk önleme: zayıf ürün ────────────────────────
      var criticalUruns = (typeof GENEL !== 'undefined' ? GENEL : [])
        .filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM' && (r.tl_pct || 0) < 70; });

      criticalUruns.forEach(function (r) {
        plan.push({
          priority:  priority++,
          category:  'ÜRÜN',
          action:    r.urun + ' kritik açığını kapat',
          detail:    r.urun + ' sadece %' + (r.tl_pct || 0).toFixed(1) +
            ' realizasyonda — portföy primini tehdit ediyor.',
          impact:    'Portföy prim koşulunu (≥%91) kurtarır.',
          urgency:   'BUGÜN'
        });
      });

    } catch (e) {
      console.warn('[action-planner] buildActionPlan hata:', e.message);
    }

    return plan;
  }

  // ── buildFullSimulation ───────────────────────────────────
  // Tüm Phase 3.2 motorlarını çalıştırır, birleşik rapor döner.
  // @param {string} ttt
  // @returns {{ ttt, generatedAt, simulations, prim, scenarios,
  //             productImpact, brickImpact, probabilities,
  //             actionPlan, smartInsights }}
  function buildFullSimulation(ttt) {
    var report = {
      ttt:          ttt,
      generatedAt:  new Date().toISOString(),
      simulations:  [],
      prim:         [],
      bestPrim:     null,
      scenarios:    null,
      productImpact:[],
      brickImpact:  [],
      probabilities:{},
      actionPlan:   [],
      smartInsights:[]
    };

    if (!ttt) return report;

    try {
      // Hedef simülasyonları
      var targets = [91, 100, 110, 120];
      report.simulations = targets.map(function (t) {
        return (typeof simulateTarget === 'function') ? simulateTarget(ttt, t) : { target: t };
      });

      // Prim simülasyonu
      report.prim    = (typeof simulatePrim === 'function')      ? simulatePrim(ttt)      : [];
      report.bestPrim = (typeof bestPrimScenario === 'function') ? bestPrimScenario(ttt)  : null;

      // Senaryolar
      report.scenarios    = (typeof buildScenario === 'function')        ? buildScenario(ttt)        : null;

      // Etki analizleri
      report.productImpact = (typeof analyzeProductImpact === 'function') ? analyzeProductImpact(ttt) : [];
      report.brickImpact   = (typeof analyzeBrickImpact === 'function')   ? analyzeBrickImpact(ttt)   : [];

      // Olasılıklar
      report.probabilities = (typeof calculateTargetProbability === 'function')
        ? calculateTargetProbability(ttt) : {};

      // Aksiyon planı
      report.actionPlan = buildActionPlan(ttt);

      // Akıllı insight'lar
      report.smartInsights = _generateSmartInsights(ttt, report);

      console.debug('[action-planner] buildFullSimulation OK.',
        'TTT:', ttt,
        '| Aksiyonlar:', report.actionPlan.length,
        '| Insights:', report.smartInsights.length
      );

    } catch (e) {
      console.warn('[action-planner] buildFullSimulation hata:', e.message);
    }

    return report;
  }

  // ── _generateSmartInsights ────────────────────────────────
  function _generateSmartInsights(ttt, report) {
    var insights = [];

    try {
      var s91   = report.simulations.find(function (s) { return s.target === 91;  });
      var s100  = report.simulations.find(function (s) { return s.target === 100; });
      var s110  = report.simulations.find(function (s) { return s.target === 110; });
      var probs = report.probabilities;

      // Hedef bazlı
      if (s91 && probs[91] >= 90) {
        insights.push('%91 hedefi neredeyse garantilenmiş (%' + probs[91] + ' olasılık).');
      } else if (s91 && !s91.achievable) {
        insights.push('🔴 %91 prim eşiği risk altında — günlük ₺' +
          (s91.requiredDailySales || 0).toLocaleString('tr-TR') + ' gerekli.');
      }

      if (s100 && s100.requiredDailySales) {
        insights.push('%100 hedefi günlük ₺' +
          s100.requiredDailySales.toLocaleString('tr-TR') + ' satış gerektiriyor.');
      }

      if (s110 && s110.achievable) {
        insights.push('%110 hedefi ulaşılabilir görünüyor (%' + probs[110] + ' olasılık).');
      } else if (s110) {
        var accel = s110.accelerationFactor;
        if (accel) insights.push('%110 hedefi %' + Math.round((accel - 1) * 100) + ' ivme artışı gerektiriyor.');
      }

      // Ürün kaldıraç insight
      if (report.productImpact && report.productImpact.length) {
        var topProd = report.productImpact[0];
        insights.push(topProd.product + ' toplam TL açığının %' + topProd.tlGapContrib + '\'ini oluşturuyor.');
      }

      // Brick kaldıraç insight
      if (report.brickImpact && report.brickImpact.length) {
        var topBrick = report.brickImpact[0];
        insights.push(topBrick.brick + ' brick\'i %' + Math.round(topBrick.ourShare) +
          ' pazar payıyla en yüksek kaldıraç noktası (skor: ' + topBrick.impactScore + '/100).');
      }

      // Prim insight
      if (report.bestPrim) {
        insights.push('En karlı ulaşılabilir hedef %' + report.bestPrim.realization +
          ' → tahmini prim ₺' + report.bestPrim.prim.toLocaleString('tr-TR') + '.');
      }

      // Senaryo insight
      if (report.scenarios) {
        var expected = report.scenarios.expected;
        var best     = report.scenarios.best;
        if (best && expected && best.realization > expected.realization + 5) {
          insights.push('Hız %20 artarsa realizasyon %' + expected.realization +
            '\'den %' + best.realization + '\'e yükselir.');
        }
      }

    } catch (e) {
      console.warn('[action-planner] _generateSmartInsights hata:', e.message);
    }

    return insights;
  }

  // ── formatSimulationForAI ─────────────────────────────────
  // @param {object} report  buildFullSimulation() çıktısı
  // @returns {string}
  function formatSimulationForAI(report) {
    if (!report) return '';
    var lines = [];

    lines.push('');
    lines.push('=== AKILLI HEDEF SİMÜLATÖRÜ (PHASE 3.2) ===');
    lines.push('');

    // Akıllı insight'lar
    if (report.smartInsights && report.smartInsights.length) {
      lines.push('AKILLI GÖRÜŞLER:');
      report.smartInsights.forEach(function (i) { lines.push('  • ' + i); });
    }

    // Hedef simülasyonları
    if (report.simulations && report.simulations.length) {
      lines.push('');
      lines.push((typeof formatSimulatorForAI === 'function')
        ? formatSimulatorForAI(report.simulations).trim() : '');
    }

    // Prim
    if (report.prim && report.prim.length) {
      lines.push('');
      lines.push((typeof formatPrimForAI === 'function')
        ? formatPrimForAI(report.prim, report.bestPrim).trim() : '');
    }

    // Senaryolar + etki analizleri
    if (report.scenarios || report.productImpact || report.brickImpact) {
      lines.push('');
      lines.push((typeof formatScenariosForAI === 'function')
        ? formatScenariosForAI(report.scenarios, report.productImpact, report.brickImpact).trim() : '');
    }

    // Aksiyon planı
    if (report.actionPlan && report.actionPlan.length) {
      lines.push('');
      lines.push('ÖNERİLEN AKSİYON PLANI:');
      report.actionPlan.forEach(function (a) {
        var urg = a.urgency === 'BUGÜN' ? '[BUGÜN]' : a.urgency === 'BU HAFTA' ? '[BU HAFTA]' : '[BU DÖNEM]';
        lines.push('  ' + urg + ' #' + a.priority + ' [' + a.category + '] ' + a.action);
        lines.push('    → ' + a.detail);
        lines.push('    Etki: ' + a.impact);
      });
    }

    // Olasılık özeti
    if (report.probabilities && Object.keys(report.probabilities).length) {
      lines.push('');
      lines.push('HEDEF OLASILIĞI:');
      [91, 100, 110, 120].forEach(function (t) {
        var p    = report.probabilities[t] || 0;
        var icon = p >= 80 ? '🟢' : p >= 50 ? '🟡' : '🔴';
        lines.push('  ' + icon + ' %' + t + ': %' + p + ' olasılık');
      });
    }

    lines.push('');
    lines.push('NOT: Bu simülasyon mevcut satış hızına ve verilere dayanır. Gerçek sonuçlar farklılık gösterebilir.');
    lines.push('=== SİMÜLATÖR RAPORU SONU ===');

    return lines.join('\n');
  }

  // ── renderTargetSimulator ─────────────────────────────────
  // Opsiyonel hafif dashboard kartları — sadece container varsa render eder.
  // @param {string} ttt
  // @param {string} [containerId]  — varsayılan 'targetSimulatorContainer'
  function renderTargetSimulator(ttt, containerId) {
    var container = document.getElementById(containerId || 'targetSimulatorContainer');
    if (!container) return;

    var report = buildFullSimulation(ttt);
    var probs  = report.probabilities;

    var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
      .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
    var currentReal = gt ? (gt.tl_pct || 0) : 0;
    var currentTL   = gt ? (gt.satis_tl || 0) : 0;

    function _card(label, value, color, sub) {
      return '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:10px;padding:12px 14px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;' +
        'letter-spacing:.8px;margin-bottom:4px">' + label + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + color + ';line-height:1.2">' + value + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--dim,#6b7280);margin-top:3px">' + sub + '</div>' : '') +
        '</div>';
    }

    function _probColor(p) {
      return p >= 80 ? '#16A34A' : p >= 50 ? '#D97706' : '#DC2626';
    }

    var realColor = currentReal >= 91 ? '#16A34A' : currentReal >= 70 ? '#D97706' : '#DC2626';

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;padding:8px 0">';

    // Kart 1 — Mevcut Realizasyon
    html += _card('Mevcut Realizasyon',
      '%' + (Math.round(currentReal * 10) / 10),
      realColor,
      '₺' + Math.round(currentTL).toLocaleString('tr-TR') + ' satış'
    );

    // Kart 2 — %91 Olasılık
    html += _card('%91 Prim Eşiği',
      '%' + (probs[91] || 0) + ' olasılık',
      _probColor(probs[91] || 0),
      report.simulations.find(function (s) { return s.target === 91; })
        ? report.simulations.find(function (s) { return s.target === 91; }).primLabel : '—'
    );

    // Kart 3 — %100 Olasılık
    html += _card('%100 Tam Prim',
      '%' + (probs[100] || 0) + ' olasılık',
      _probColor(probs[100] || 0),
      (function () {
        var s = report.simulations.find(function (s) { return s.target === 100; });
        return s && s.requiredDailySales
          ? 'Günlük ₺' + s.requiredDailySales.toLocaleString('tr-TR') + ' gerekli'
          : 'Zaten karşılandı';
      })()
    );

    // Kart 4 — En Karlı Prim
    var bp = report.bestPrim;
    html += _card('En Karlı Hedef',
      bp ? '%' + bp.realization : '—',
      '#4F008C',
      bp ? 'Tahmini prim: ₺' + bp.prim.toLocaleString('tr-TR') : 'Hesaplanamadı'
    );

    html += '</div>';

    // Aksiyon planı özeti
    if (report.actionPlan && report.actionPlan.length) {
      html += '<div style="margin-top:8px;background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:8px;padding:10px 12px">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;' +
        'color:var(--dim,#6b7280);margin-bottom:6px">Öncelikli Aksiyonlar</div>';

      report.actionPlan.slice(0, 4).forEach(function (a) {
        var urgColor = a.urgency === 'BUGÜN' ? '#DC2626' : a.urgency === 'BU HAFTA' ? '#D97706' : '#6B7280';
        html += '<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:5px">' +
          '<span style="background:' + urgColor + ';color:#fff;border-radius:3px;padding:0 4px;' +
          'font-size:9px;font-weight:700;white-space:nowrap;margin-top:1px">' + a.urgency + '</span>' +
          '<div style="font-size:11px;color:var(--fg,#111);line-height:1.4">' +
          '<strong>' + a.action + '</strong><br>' +
          '<span style="color:var(--dim,#6b7280)">' + a.detail + '</span></div></div>';
      });

      html += '</div>';
    }

    // Smart insights
    if (report.smartInsights && report.smartInsights.length) {
      html += '<div style="margin-top:6px;background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:8px;padding:8px 12px;font-size:11px;color:var(--fg,#111);line-height:1.7">' +
        report.smartInsights.map(function (i) { return '• ' + i; }).join('<br>') +
        '</div>';
    }

    container.innerHTML = html;
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildActionPlan         = buildActionPlan;
  window.buildFullSimulation     = buildFullSimulation;
  window.formatSimulationForAI   = formatSimulationForAI;
  window.renderTargetSimulator   = renderTargetSimulator;

  console.debug('[action-planner] Phase 3.2 yüklendi.');

})();
