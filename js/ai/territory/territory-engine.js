// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/territory-engine.js
//  Phase 3.3 — Territory Optimization Engine
//
//  Sorumluluk: Tüm territory motorlarını birleştir
//    • buildTerritoryStrategy(ttt) → { topBricks, weakBricks,
//                                       opportunities, strategy }
//    • formatTerritoryForAI(report) → string (AI context eklentisi)
//    • renderTerritorySummary(ttt, [containerId]) → DOM (opsiyonel)
//
//  Pipeline:
//    rankBricks → analyzeCoverage → buildVisitPlan → analyzeWorkload
//    → buildTerritoryStrategy → formatTerritoryForAI
//
//  AI entegrasyonu:
//    buildTTTContext() → formatTerritoryForAI() (ai-context.js Phase 3.3 bloğu)
//
//  Bağımlılık:
//    brick-ranking-engine.js
//    coverage-engine.js
//    visit-planner.js
//    workload-engine.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── buildTerritoryStrategy ────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   ttt, generatedAt,
  //   topBricks, weakBricks, opportunities, rescueBricks,
  //   visitPlan, coverage, workload, strategy
  // }}
  function buildTerritoryStrategy(ttt) {
    var result = {
      ttt:          ttt,
      generatedAt:  new Date().toISOString(),
      topBricks:    [],
      weakBricks:   [],
      rescueBricks: [],
      opportunities:[],
      visitPlan:    {},
      coverage:     [],
      workload:     {},
      strategy:     []
    };
    if (!ttt) return result;

    try {
      // 1. Brick sıralaması
      var ranked = typeof rankBricks === 'function' ? rankBricks(ttt) : [];

      result.topBricks    = ranked.filter(function(r){ return r.score >= 60; }).slice(0, 5);
      result.weakBricks   = ranked.filter(function(r){ return r.score < 40; }).slice(0, 5);
      result.rescueBricks = ranked.filter(function(r){ return r.classification === 'RESCUE'; });
      result.opportunities= ranked.filter(function(r){ return r.classification === 'OPPORTUNITY'; }).slice(0, 5);

      // 2. Kapsama analizi
      result.coverage = typeof analyzeCoverage === 'function' ? analyzeCoverage(ttt) : [];

      // 3. Ziyaret planı
      result.visitPlan = typeof buildVisitPlan === 'function' ? buildVisitPlan(ttt) : {};

      // 4. İş yükü
      result.workload = typeof analyzeWorkload === 'function' ? analyzeWorkload(ttt) : {};

      // 5. Stratejik öneri listesi
      var strategy = [];
      var sp = 1;

      if (result.rescueBricks.length) {
        strategy.push({
          priority: sp++,
          type: 'RESCUE',
          action: 'Acil brick ziyareti',
          detail: result.rescueBricks.slice(0,3).map(function(b){ return b.brick; }).join(', ') +
            ' — skor düşük, ziyaret yok. Bu hafta ziyaret et.',
          urgency: 'BUGÜN'
        });
      }

      if (result.opportunities.length) {
        strategy.push({
          priority: sp++,
          type: 'OPPORTUNITY',
          action: 'Fırsat bricklerine odaklan',
          detail: result.opportunities.slice(0,3).map(function(b){ return b.brick; }).join(', ') +
            ' — yüksek pazar potansiyeli ve büyüme fırsatı.',
          urgency: 'BU HAFTA'
        });
      }

      var undercov = result.coverage.filter(function(c){
        return c.status === 'UNDER_COVERED' || c.status === 'UNTOUCHED';
      });
      if (undercov.length) {
        strategy.push({
          priority: sp++,
          type: 'COVERAGE',
          action: 'Kapsama açığını kapat',
          detail: undercov.slice(0,3).map(function(c){ return c.area; }).join(', ') +
            ' — eczane ziyareti yetersiz. Penetrasyon artırılmalı.',
          urgency: 'BU HAFTA'
        });
      }

      if (result.workload.visitDebt > 0) {
        strategy.push({
          priority: sp++,
          type: 'WORKLOAD',
          action: 'Ziyaret açığını kapat (' + result.workload.visitDebt + ' brick)',
          detail: 'Kalan sürede ' + result.workload.weeklyVisitCapacity + ' brick kapasitesi var. ' +
            'Öncelik sırasına göre ziyaret planlanmalı.',
          urgency: 'BU DÖNEM'
        });
      }

      // Güçlü brickler için koruma
      if (result.topBricks.length) {
        strategy.push({
          priority: sp++,
          type: 'MAINTAIN',
          action: 'Güçlü brickleri koru',
          detail: result.topBricks.slice(0,3).map(function(b){ return b.brick; }).join(', ') +
            ' — yüksek skor, tempo korunmalı.',
          urgency: 'BU DÖNEM'
        });
      }

      result.strategy = strategy;

      console.debug('[territory-engine] buildTerritoryStrategy tamamlandı.',
        'TTT:', ttt, '| Bricks:', ranked.length,
        '| Rescue:', result.rescueBricks.length,
        '| Opp:', result.opportunities.length);

    } catch (e) {
      console.warn('[territory-engine] buildTerritoryStrategy hata:', e.message);
    }

    return result;
  }

  // ── formatTerritoryForAI ──────────────────────────────────
  // AI context'e eklenecek territory raporu.
  // Mevcut context SİLİNMEZ — sadece eklenir.
  // @param {Object} report — buildTerritoryStrategy() çıktısı
  // @returns {string}
  function formatTerritoryForAI(report) {
    if (!report) return '';
    var lines = [];

    lines.push('');
    lines.push('=== BÖLGE OPTİMİZASYON RAPORU (TERRITORY ENGINE) ===');

    // İş yükü özeti
    if (report.workload && report.workload.workload) {
      var wl = report.workload;
      var wlIcon = wl.workload === 'CRITICAL' ? '🔴' : wl.workload === 'HIGH' ? '🟡' : wl.workload === 'MEDIUM' ? '🟢' : '⚪';
      lines.push('');
      lines.push('İŞ YÜKÜ: ' + wlIcon + ' ' + wl.workload +
        ' | ' + wl.totalBricks + ' brick | ' + wl.activePharmacies + ' eczane' +
        ' | ' + wl.focusAreas + ' öncelikli alan | ' + wl.riskAreas + ' risk bölgesi');
      if (wl.visitDebt > 0) lines.push('⚠️ Ziyaret açığı: ' + wl.visitDebt + ' brick kalan sürede kapsanamayabilir.');
      wl.insights.forEach(function(i){ lines.push('  → ' + i); });
    }

    // Top 5 brick
    if (report.topBricks && report.topBricks.length) {
      lines.push('');
      lines.push('ÖNCELIK SIRALI TOP ' + report.topBricks.length + ' BRİCK:');
      report.topBricks.forEach(function(b, i) {
        lines.push('  ' + (i+1) + '. ' + b.brick +
          ' [' + b.classification + '] Skor:' + b.score + ' — ' + b.reason);
      });
    }

    // RESCUE brickler
    if (report.rescueBricks && report.rescueBricks.length) {
      lines.push('');
      lines.push('🆘 ACİL RESCUE BRİCKLER:');
      report.rescueBricks.forEach(function(b) {
        lines.push('  • ' + b.brick + ': ' + b.detail);
      });
    }

    // Fırsat brickler
    if (report.opportunities && report.opportunities.length) {
      lines.push('');
      lines.push('🎯 FIRSAT BRİCKLER:');
      report.opportunities.forEach(function(b, i) {
        lines.push('  ' + (i+1) + '. ' + b.brick + ' — ' + b.reason);
      });
    }

    // Kapsama özeti
    if (report.coverage && report.coverage.length) {
      var unc = report.coverage.filter(function(c){ return c.status === 'UNTOUCHED'; });
      var und = report.coverage.filter(function(c){ return c.status === 'UNDER_COVERED'; });
      if (unc.length || und.length) {
        lines.push('');
        lines.push('KAPSAMA AÇIKLARI:');
        if (unc.length) lines.push('  🔴 Hiç ziyaret edilmemiş: ' + unc.map(function(c){ return c.area; }).join(', '));
        if (und.length) lines.push('  🟡 Yetersiz kapsanan: ' + und.map(function(c){ return c.area; }).join(', '));
      }
    }

    // Haftalık ziyaret planı
    if (report.visitPlan && report.visitPlan.weekly && report.visitPlan.weekly.length) {
      lines.push('');
      lines.push('BU HAFTA ZİYARET PLANı (Öncelik sırasıyla):');
      report.visitPlan.weekly.slice(0, 5).forEach(function(w) {
        lines.push('  #' + w.priority + ' ' + w.brick + ' [' + w.classification + '] — ' + w.reason);
      });
    }

    // Strateji özeti
    if (report.strategy && report.strategy.length) {
      lines.push('');
      lines.push('STRATEJİK AKSİYONLAR:');
      report.strategy.forEach(function(s) {
        var uIcon = s.urgency === 'BUGÜN' ? '🔴' : s.urgency === 'BU HAFTA' ? '🟡' : '🟢';
        lines.push('  ' + uIcon + ' [' + s.urgency + '] ' + s.action + ': ' + s.detail);
      });
    }

    lines.push('');
    lines.push('=== BÖLGE RAPORU SONU ===');

    return lines.join('\n');
  }

  // ── renderTerritorySummary ────────────────────────────────
  // Opsiyonel basit dashboard kartları.
  // Mevcut sayfalar değiştirilmez — sadece belirtilen container'a yazar.
  // @param {string} ttt
  // @param {string} [containerId] — varsayılan: 'territorySummaryContainer'
  function renderTerritorySummary(ttt, containerId) {
    var container = document.getElementById(containerId || 'territorySummaryContainer');
    if (!container) return; // Container yoksa sessizce çık

    var report = buildTerritoryStrategy(ttt);
    var wl     = report.workload || {};
    var topB   = report.topBricks[0]  || null;
    var rescue = report.rescueBricks[0] || null;
    var opp    = report.opportunities[0] || null;
    var cov    = report.coverage.find(function(c){ return c.status === 'UNDER_COVERED' || c.status === 'UNTOUCHED'; });

    var wlColor = function(w) {
      return w === 'CRITICAL' ? '#DC2626' : w === 'HIGH' ? '#D97706' : w === 'MEDIUM' ? '#4F008C' : '#16A34A';
    };

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;padding:10px 0">';

    // İş yükü kartı
    html += '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:12px">' +
      '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:1px">Bölge İş Yükü</div>' +
      '<div style="font-size:18px;font-weight:700;color:' + wlColor(wl.workload) + ';margin:4px 0">' + (wl.workload || '—') + '</div>' +
      '<div style="font-size:11px;color:var(--dim,#6b7280)">' +
        (wl.totalBricks || 0) + ' brick · ' + (wl.activePharmacies || 0) + ' eczane' +
      '</div>' +
      (wl.visitDebt > 0 ? '<div style="font-size:10px;color:#D97706;margin-top:4px">⚠️ Ziyaret açığı: ' + wl.visitDebt + '</div>' : '') +
    '</div>';

    // Öncelikli brick kartı
    if (topB) {
      html += '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:1px">Öncelikli Brick</div>' +
        '<div style="font-size:14px;font-weight:700;color:#4F008C;margin:4px 0">' + topB.brick + '</div>' +
        '<div style="font-size:11px;color:var(--dim,#6b7280)">Skor: ' + topB.score + ' — ' + topB.reason + '</div>' +
      '</div>';
    }

    // Rescue kartı
    if (rescue) {
      html += '<div style="background:var(--card,#fff);border:1px solid #DC2626;border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;color:#DC2626;text-transform:uppercase;letter-spacing:1px">🆘 Acil Brick</div>' +
        '<div style="font-size:14px;font-weight:700;color:#DC2626;margin:4px 0">' + rescue.brick + '</div>' +
        '<div style="font-size:11px;color:var(--dim,#6b7280)">' + rescue.reason + '</div>' +
      '</div>';
    }

    // Fırsat kartı
    if (opp) {
      html += '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;letter-spacing:1px">🎯 En İyi Fırsat</div>' +
        '<div style="font-size:14px;font-weight:700;color:#059669;margin:4px 0">' + opp.brick + '</div>' +
        '<div style="font-size:11px;color:var(--dim,#6b7280)">' + opp.reason + '</div>' +
      '</div>';
    }

    // Kapsama uyarısı
    if (cov) {
      html += '<div style="background:var(--card,#fff);border:1px solid #D97706;border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;color:#D97706;text-transform:uppercase;letter-spacing:1px">📍 Kapsama Açığı</div>' +
        '<div style="font-size:14px;font-weight:700;color:#D97706;margin:4px 0">' + cov.area + '</div>' +
        '<div style="font-size:11px;color:var(--dim,#6b7280)">%' + cov.coverage + ' kapsama — ' + cov.detail + '</div>' +
      '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // ── EXPORTS ────────────────────────────────────────────────
  window.buildTerritoryStrategy  = buildTerritoryStrategy;
  window.formatTerritoryForAI    = formatTerritoryForAI;
  window.renderTerritorySummary  = renderTerritorySummary;

  console.debug('[territory-engine] Phase 3.3 yüklendi.');

})();
