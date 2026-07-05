// ══════════════════════════════════════════════════════════════════════
//  js/ai/coach/coach-engine.js
//  Phase 3.4 — AI Sales Coach
//
//  Sorumluluk: Tüm coach modüllerini birleştiren orkestratör
//    • buildSalesCoach(ttt)        → tam koçluk raporu
//    • formatCoachForAI(report)    → AI context metni
//    • renderCoachSummary(ttt, id) → opsiyonel dashboard kartları
//
//  Pipeline:
//    analyzePerformance      (performance-coach.js)
//    generateGoalPlan        (goal-coach.js)
//    generateCoachDailyPlan  (daily-plan-engine.js) — DÜZELTME: eskiden
//                              generateDailyPlan idi, autonomous-planning-
//                              engine.js'deki AYNI İSİMLİ farklı fonksiyonla
//                              window üzerinde çakışıyordu (bkz. o dosyadaki
//                              yorum). Benzersiz isme taşındı.
//    generateSalesHabits     (habit-engine.js)
//    → buildSalesCoach
//    → formatCoachForAI (ai-context.js Phase 3.4 bloğuna eklenir)
//
//  Koçluk öncelik ağırlıkları:
//    35% Realizasyon açığı
//    25% Forecast riski
//    20% Bölge fırsatı
//    10% Pazar payı riski
//    10% Ürün fırsatı
//
//  Bağımlılık:
//    performance-coach.js, goal-coach.js,
//    daily-plan-engine.js, habit-engine.js,
//    js/data/data-state.js (GENEL)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, analyzePerformance, generateGoalPlan,
          generateCoachDailyPlan, generateSalesHabits,
          buildTerritoryStrategy, detectRisks, findOpportunities,
          generateRecommendations, calculateRunRate, _coachingPriorityScore */

(function () {
  'use strict';

  // ── _buildCoachingNarrative ───────────────────────────────
  // Gerçek veri odaklı koçluk metni üretir — genel ifadeler YASAK.
  // "Panocer hedefin altında" değil:
  // "Panocer %68 realizasyonda — günlük 3 kutu ek satışla bu haftaki açık kapanır."
  function _buildCoachingNarrative(ttt, perf, goalPlan, daily) {
    var coaching = [];

    try {
      var gt = (typeof GENEL !== 'undefined' ? GENEL : [])
        .find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      if (!gt) return coaching;

      var realPct    = gt.tl_pct   || 0;
      var remaining  = goalPlan.remainingDays || 0;
      var dailyReq   = goalPlan.dailyReq || 0;

      // Performans bazlı ana mesaj
      if (perf.level === 'EXCELLENT') {
        coaching.push({
          type:    'MOTIVASYON',
          message: 'Mükemmel performans! %' + realPct.toFixed(1) + ' realizasyonla dönem liderlerinden birisin. ' +
            'Tempoyu koru ve %' + (perf.forecastReal > 110 ? '110+' : '100') + ' hedefine odaklan.',
          urgency: 'MONITOR'
        });
      } else if (perf.level === 'GOOD') {
        coaching.push({
          type:    'YÖNLENDİRME',
          message: 'İyi gidiyorsun (%' + realPct.toFixed(1) + '). ' +
            (dailyReq > 0
              ? 'Günlük ₺' + dailyReq.toLocaleString('tr-TR') + ' ile tam prime ulaşılabilir.'
              : 'Tam prim garantilendi — şimdi bonus hedefini zorla.'),
          urgency: 'IMPORTANT'
        });
      } else if (perf.level === 'AVERAGE') {
        coaching.push({
          type:    'UYARI',
          message: '%' + realPct.toFixed(1) + ' realizasyon — prim eşiğine ' +
            (91 - realPct).toFixed(1) + ' puan kaldı. ' +
            (remaining > 0
              ? remaining + ' iş günüde günlük ₺' + dailyReq.toLocaleString('tr-TR') + ' ile %91 karşılanır.'
              : 'Dönem kapandı.'),
          urgency: 'IMPORTANT'
        });
      } else {
        coaching.push({
          type:    'ACİL',
          message: '🔴 %' + realPct.toFixed(1) + ' realizasyon — prim riski kritik. ' +
            (remaining > 0
              ? 'Günlük ₺' + dailyReq.toLocaleString('tr-TR') + ' satış gerekiyor. ' +
                'En yüksek etkili ürün: ' + (goalPlan.productFocus[0] ? goalPlan.productFocus[0].product : '—') + '.'
              : 'Dönem kapandı — bir sonraki dönem için plan yap.'),
          urgency: 'URGENT'
        });
      }

      // Ürün özel mesajlar (genel değil — sayısal)
      goalPlan.productFocus.forEach(function (p) {
        coaching.push({
          type:    'ÜRÜN KOÇLUĞU',
          message: p.product + ' %' + p.realPct + ' realizasyonda. ' + p.reason,
          urgency: p.realPct < 70 ? 'URGENT' : 'IMPORTANT'
        });
      });

      // Sabah aksiyonlarından kritik mesaj
      // Savunma: daily.morning her zaman dizi olmayabilir (örn. dailyPlan
      // beklenmedik bir şekle sahipse) — boş dizi fallback ile çökmeyi önle.
      var morningUrgent = (daily.morning || []).filter(function (a) { return a.urgency === 'URGENT'; });
      if (morningUrgent.length) {
        coaching.push({
          type:    'BUGÜN ÖNCE',
          message: 'Bugünün önceliği: ' + morningUrgent.map(function (a) { return a.action; }).join(' → '),
          urgency: 'URGENT'
        });
      }

      // Forecast mesajı
      if (perf.forecastReal > 0) {
        var fcMsg = 'Run rate %' + perf.realPct + ' mevcut — forecast %' + perf.forecastReal + ' dönem sonu öngörüyor.';
        if (perf.forecastReal < 91) {
          fcMsg += ' %91 prim eşiğine ulaşmak için hızlanma gerekli.';
        } else if (perf.forecastReal >= 100) {
          fcMsg += ' Tam prime ulaşmak için mevcut tempo yeterli.';
        }
        coaching.push({
          type:    'TAHMİN',
          message: fcMsg,
          urgency: perf.forecastReal < 91 ? 'URGENT' : 'MONITOR'
        });
      }

    } catch (e) {
      console.warn('[coach-engine] _buildCoachingNarrative hata:', e.message);
    }

    return coaching;
  }

  // ── buildSalesCoach ───────────────────────────────────────
  // @param {string} ttt
  // @returns {{
  //   ttt, generatedAt, priorityScore,
  //   performance, goalPlan, dailyPlan, habits, coaching,
  //   priorities, risks, actions, smartInsights
  // }}
  function buildSalesCoach(ttt) {
    var result = {
      ttt:          ttt,
      generatedAt:  new Date().toISOString(),
      priorityScore: 0,
      performance:  {},
      goalPlan:     {},
      dailyPlan:    {},
      habits:       {},
      coaching:     [],
      priorities:   [],
      risks:        [],
      actions:      [],
      smartInsights: []
    };

    if (!ttt) return result;

    try {
      // ── 1. Performans analizi ──────────────────────────────
      result.performance = (typeof analyzePerformance === 'function')
        ? analyzePerformance(ttt) : {};
      result.priorityScore = result.performance.score || 0;

      // ── 2. Hedef planı ─────────────────────────────────────
      result.goalPlan = (typeof generateGoalPlan === 'function')
        ? generateGoalPlan(ttt) : {};

      // ── 3. Günlük plan ─────────────────────────────────────
      result.dailyPlan = (typeof generateCoachDailyPlan === 'function')
        ? generateCoachDailyPlan(ttt) : {};

      // ── 4. Alışkanlıklar ───────────────────────────────────
      result.habits = (typeof generateSalesHabits === 'function')
        ? generateSalesHabits(ttt) : {};

      // ── 5. Koçluk narratifi ────────────────────────────────
      result.coaching = _buildCoachingNarrative(
        ttt, result.performance, result.goalPlan, result.dailyPlan
      );

      // ── 6. Öncelikler (acil aksiyonlardan) ────────────────
      var priorities = [];
      var allActions = (result.dailyPlan.morning || [])
        .concat(result.dailyPlan.midday  || [])
        .concat(result.dailyPlan.afternoon || []);

      allActions.filter(function (a) { return a.urgency === 'URGENT'; })
        .forEach(function (a, i) {
          priorities.push({ rank: i + 1, action: a.action, detail: a.detail, category: a.category });
        });
      result.priorities = priorities.slice(0, 5);

      // ── 7. Risk listesi (intelligence raporundan) ─────────
      result.risks = (typeof detectRisks === 'function')
        ? detectRisks(ttt).filter(function (r) { return r.severity === 'HIGH'; }).slice(0, 3)
        : [];

      // ── 8. Tüm aksiyonlar (haftalık + dönem) ──────────────
      result.actions = (result.dailyPlan.thisWeek || [])
        .concat(result.dailyPlan.endOfPeriod || [])
        .slice(0, 10);

      // ── 9. Smart insights ──────────────────────────────────
      var insights = [];
      result.coaching.forEach(function (c) { if (c.urgency === 'URGENT') insights.push(c.message); });
      result.coaching.forEach(function (c) { if (c.urgency === 'IMPORTANT') insights.push(c.message); });
      result.smartInsights = insights.slice(0, 6);

      console.debug('[coach-engine] buildSalesCoach tamamlandı.',
        'TTT:', ttt, '| Skor:', result.priorityScore,
        '| Seviye:', result.performance.level,
        '| Aksiyonlar:', result.priorities.length);

    } catch (e) {
      console.warn('[coach-engine] buildSalesCoach hata:', e.message);
    }

    return result;
  }

  // ── formatCoachForAI ──────────────────────────────────────
  // @param {object} report  buildSalesCoach() çıktısı
  // @returns {string}
  function formatCoachForAI(report) {
    if (!report) return '';
    var lines = [];

    lines.push('');
    lines.push('=== AI SATIŞ KOÇU RAPORU (PHASE 3.4) ===');
    lines.push('');

    // Performans özeti
    var perf = report.performance;
    if (perf && perf.level) {
      lines.push('PERFORMANS SEVİYESİ: ' + (perf.icon || '') + ' ' + perf.label +
        ' (Skor: %' + perf.realPct + ' real | Forecast: %' + perf.forecastReal + ')');
      lines.push('Değerlendirme: ' + perf.explanation);
      if (perf.strengths && perf.strengths.length) {
        lines.push('Güçlü yönler: ' + perf.strengths.join('; '));
      }
      if (perf.gaps && perf.gaps.length) {
        lines.push('Gelişim alanları: ' + perf.gaps.join('; '));
      }
    }

    // Koçluk mesajları — en somut, sayısal mesajlar önce
    if (report.coaching && report.coaching.length) {
      lines.push('');
      lines.push('KOÇLUK MESAJLARI:');
      report.coaching.forEach(function (c) {
        var icon = c.urgency === 'URGENT' ? '🔴' : c.urgency === 'IMPORTANT' ? '🟡' : '🟢';
        lines.push('  ' + icon + ' [' + c.type + '] ' + c.message);
      });
    }

    // Bugünün planı
    var dp = report.dailyPlan;
    if (dp) {
      lines.push('');
      lines.push('BUGÜN (' + (dp.date || '') + '):');

      var morningUrgent = (dp.morning || []).filter(function (a) { return a.urgency === 'URGENT'; });
      if (morningUrgent.length) {
        lines.push('  🔴 Acil sabah aksiyonları:');
        morningUrgent.forEach(function (a) { lines.push('    • ' + a.action + ' — ' + a.detail); });
      }

      var morningImportant = (dp.morning || []).filter(function (a) { return a.urgency !== 'URGENT'; });
      if (morningImportant.length) {
        lines.push('  Sabah: ' + morningImportant.map(function (a) { return a.action; }).join(' → '));
      }

      if (dp.midday && dp.midday.length) {
        lines.push('  Öğle: ' + dp.midday.map(function (a) { return a.action; }).join(' → '));
      }
      if (dp.afternoon && dp.afternoon.length) {
        lines.push('  Öğleden sonra: ' + dp.afternoon.map(function (a) { return a.action; }).join(' → '));
      }
      if (dp.summary) lines.push('  Özet: ' + dp.summary);
    }

    // Hedef planı
    var gp = report.goalPlan;
    if (gp && gp.steps && gp.steps.length) {
      lines.push('');
      lines.push('HEDEF YOL HARİTASI (%' + gp.primaryTarget + ' hedefi):');
      lines.push('  Günlük gerekli: ₺' + (gp.dailyReq || 0).toLocaleString('tr-TR'));
      lines.push('  Haftalık gerekli: ₺' + (gp.weeklyReq || 0).toLocaleString('tr-TR'));
      lines.push('  Toplam açık: ₺' + (gp.gap || 0).toLocaleString('tr-TR'));
      lines.push('  Adımlar:');
      gp.steps.forEach(function (s) {
        var icon = s.urgency === 'BUGÜN' ? '🔴' : s.urgency === 'BU HAFTA' ? '🟡' : '🟢';
        lines.push('    ' + icon + ' ' + s.step + ' — ' + s.detail);
      });
    }

    // Dönüm noktaları
    if (gp && gp.milestones && gp.milestones.length) {
      lines.push('');
      lines.push('DÖNEM DÖNÜM NOKTALARI:');
      gp.milestones.forEach(function (m) { lines.push('  • ' + m.note); });
    }

    // Bu hafta / dönem sonu
    if (report.actions && report.actions.length) {
      lines.push('');
      lines.push('BU HAFTA & DÖNEM SONU AKSİYONLARI:');
      report.actions.slice(0, 6).forEach(function (a) {
        var icon = a.urgency === 'URGENT' ? '🔴' : a.urgency === 'IMPORTANT' ? '🟡' : '🟢';
        lines.push('  ' + icon + ' [' + a.category + '] ' + a.action + ' — ' + a.detail);
      });
    }

    // Günlük alışkanlıklar
    var habits = report.habits;
    if (habits && habits.daily && habits.daily.length) {
      lines.push('');
      lines.push('GÜNLÜK SATIŞ ALIŞKANLIKLARI:');
      habits.daily.forEach(function (h) {
        lines.push('  ✓ ' + h.habit + ' (' + h.frequency + ')');
        lines.push('    Neden: ' + h.why);
      });
    }

    if (habits && habits.contextual && habits.contextual.length) {
      lines.push('');
      lines.push('BAĞLAMSAL AKSİYONLAR:');
      habits.contextual.forEach(function (h) {
        var icon = h.urgency === 'BUGÜN' ? '🔴' : '🟡';
        lines.push('  ' + icon + ' ' + h.habit + ' [' + h.urgency + ']');
        lines.push('    Tetikleyici: ' + h.trigger);
      });
    }

    lines.push('');
    lines.push('NOT: Koçluk önerileri mevcut satış verisi ve run rate\'e dayanır. ' +
      'Gerçek saha koşullarını değerlendirerek uygula.');
    lines.push('=== KOÇLUK RAPORU SONU ===');

    return lines.join('\n');
  }

  // ── renderCoachSummary ────────────────────────────────────
  // Opsiyonel 4 kartlık dashboard. Container yoksa sessizce çıkar.
  // @param {string} ttt
  // @param {string} [containerId]
  function renderCoachSummary(ttt, containerId) {
    var container = document.getElementById(containerId || 'coachSummaryContainer');
    if (!container) return;

    var report = buildSalesCoach(ttt);
    var perf   = report.performance;
    var daily  = report.dailyPlan;
    var goal   = report.goalPlan;

    function _card(label, value, color, sub) {
      return '<div style="background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:10px;padding:12px 14px">' +
        '<div style="font-size:10px;color:var(--dim,#6b7280);text-transform:uppercase;' +
        'letter-spacing:.8px;margin-bottom:4px">' + label + '</div>' +
        '<div style="font-size:16px;font-weight:700;color:' + color + ';line-height:1.2">' + value + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--dim,#6b7280);margin-top:3px;line-height:1.5">' + sub + '</div>' : '') +
        '</div>';
    }

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;padding:8px 0">';

    // Kart 1 — Performans Seviyesi
    html += _card('Koç Değerlendirmesi',
      (perf.icon || '') + ' ' + (perf.label || '—'),
      perf.color || '#6B7280',
      (perf.explanation || '').slice(0, 80) + (perf.explanation && perf.explanation.length > 80 ? '…' : '')
    );

    // Kart 2 — Bugünün Önceliği
    var todayPriority = report.priorities[0];
    html += _card('Bugünün Önceliği',
      todayPriority ? todayPriority.action.slice(0, 40) : 'Normal ziyaret günü',
      todayPriority ? '#DC2626' : '#16A34A',
      todayPriority ? todayPriority.detail.slice(0, 70) + '…' : 'Tempoyu koru, kilit eczaneleri ziyaret et.'
    );

    // Kart 3 — Günlük Hedef
    html += _card('Günlük Satış Hedefi',
      goal.dailyReq > 0 ? '₺' + goal.dailyReq.toLocaleString('tr-TR') : 'Karşılandı ✓',
      goal.dailyReq > 0 ? '#4F008C' : '#16A34A',
      '%' + goal.primaryTarget + ' hedefi için · ' + goal.remainingDays + ' iş günü kaldı'
    );

    // Kart 4 — En Büyük Risk
    var topRisk = report.risks[0];
    html += _card('En Büyük Risk',
      topRisk ? topRisk.title || 'Risk Var' : '✅ Risk Yok',
      topRisk ? '#DC2626' : '#16A34A',
      topRisk ? (topRisk.detail || topRisk.reason || '').slice(0, 70) : 'Devam et'
    );

    html += '</div>';

    // Smart insights
    if (report.smartInsights && report.smartInsights.length) {
      html += '<div style="margin-top:6px;background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:8px;padding:10px 12px">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--dim,#6b7280);margin-bottom:6px">Koçluk Görüşü</div>';

      report.smartInsights.slice(0, 4).forEach(function (ins) {
        html += '<div style="font-size:11px;color:var(--fg,#111);padding:2px 0;line-height:1.5">• ' + ins + '</div>';
      });
      html += '</div>';
    }

    // Sabah aksiyonları özet listesi
    if (daily.morning && daily.morning.length) {
      html += '<div style="margin-top:6px;background:var(--card,#fff);border:1px solid var(--brd,#e5e7eb);' +
        'border-radius:8px;padding:10px 12px">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--dim,#6b7280);margin-bottom:6px">Bugünün Planı</div>';

      ['morning','midday','afternoon'].forEach(function (slot) {
        var slotLabel = slot === 'morning' ? 'Sabah' : slot === 'midday' ? 'Öğle' : 'Öğleden Sonra';
        var items     = daily[slot] || [];
        if (!items.length) return;
        html += '<div style="font-size:10px;font-weight:700;color:var(--dim,#6b7280);margin:4px 0 2px">' + slotLabel + '</div>';
        items.slice(0, 2).forEach(function (a) {
          var urgColor = a.urgency === 'URGENT' ? '#DC2626' : a.urgency === 'IMPORTANT' ? '#D97706' : '#6B7280';
          html += '<div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:3px">' +
            '<span style="width:6px;height:6px;border-radius:50%;background:' + urgColor + ';margin-top:4px;flex-shrink:0"></span>' +
            '<div style="font-size:11px;color:var(--fg,#111);line-height:1.4">' +
            '<strong>' + a.action + '</strong>' +
            '</div></div>';
        });
      });

      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ── FAZ 12.0: buildDailyNarrative(eczane, twin, decision) ────────────
  // Tek paragraflık doğal Türkçe günlük özet.
  // twin: DigitalTwinBuilder.getDigitalTwin() çıktısı (null güvenli)
  // decision: DecisionEngine.decide() çıktısı (null güvenli)
  // Mevcut coach mesaj fonksiyonları DEĞİŞMEDİ — bu YENİ bir ek fonksiyondur.
  function buildDailyNarrative(eczane, twin, decision) {
    var parts = [];

    // Eczane + bölge
    var brickStr = (twin && twin.brick) ? twin.brick + ' bölgesindeki' : '';
    parts.push((brickStr ? brickStr + ' ' : '') + (eczane || 'eczane') + ' bugünün öncelikli eczanesidir.');

    // Davranış profili
    if (twin && twin.behaviorType) {
      var typeMap = {
        REGULAR_BUYER:   'düzenli alıcı',
        GROWING:         'büyüyen eczane',
        AT_RISK:         'risk altında',
        REACTIVATION:    'yeniden kazanım hedefi',
        CAMPAIGN_BUYER:  'kampanya odaklı',
        STOCK_BUILDER:   'stok kuran',
        COMPETITIVE_RISK:'rakip tehdidi altında',
        SEASONAL_BUYER:  'mevsimsel alıcı',
        NEW_ACCOUNT:     'yeni müşteri'
      };
      var typeLabel = typeMap[twin.behaviorType] || twin.behaviorType;
      parts.push('Profil: ' + typeLabel + '.');
    }

    // Stok tahmini
    if (twin && twin.estimatedRemainingStock != null && twin.estimatedRemainingStock >= 0) {
      var stockStr = twin.estimatedRemainingStock > 0
        ? 'Tahmini ' + twin.estimatedRemainingStock + ' kutu stok kalmış'
        : 'Stok tükenme noktasına yakın';
      if (twin.estimatedDepletionDate) {
        stockStr += ' (' + twin.estimatedDepletionDate + ' dolayında sipariş bekleniyor)';
      }
      parts.push(stockStr + '.');
    }

    // Sipariş tahmini
    if (twin && twin.estimatedOrderQty && twin.estimatedOrderQty > 0) {
      parts.push('Tahmini sipariş: ' + twin.estimatedOrderQty + ' kutu.');
    }

    // Rakip kampanyası
    if (decision && decision.decisionBasis && decision.decisionBasis.competitiveFlag) {
      parts.push('Bu bölgede aktif rakip kampanyası var — hızlı aksiyon önerilir.');
    }

    // Başarı olasılığı
    if (decision && decision.confidence != null) {
      parts.push('Başarı olasılığı: %' + decision.confidence + '.');
    }

    return parts.join(' ');
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildSalesCoach    = buildSalesCoach;
  window.buildDailyNarrative = buildDailyNarrative;
  window.formatCoachForAI   = formatCoachForAI;
  window.renderCoachSummary = renderCoachSummary;

  console.debug('[coach-engine] Phase 3.4 yüklendi.');

})();
