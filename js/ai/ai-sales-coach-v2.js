// ══════════════════════════════════════════════════════════════════════
//  js/ai/ai-sales-coach-v2.js — PHASE 4.8
//  AI Sales Coach V2
//
//  Sorumluluk:
//    • buildSalesCoachContext(ttt)   → tüm motorları birleşik context
//    • runSalesCoach(ttt)            → AI_SALES_COACH state üret
//    • renderCoachSummaryCard(id)    → "AI Satış Koçu" kartı
//    • renderScenarioCard(id)        → "Dönem Sonu Senaryoları" kartı
//
//  Kullanılan Motorlar:
//    Forecast Engine, Target Simulator, Territory Optimizer,
//    Pharmacy Intelligence, Route Optimizer,
//    Executive Dashboard, Prim Engine
//
//  AI Raporu Bölümleri:
//    1. EXECUTIVE SUMMARY
//    2. TODAY ACTION PLAN
//    3. TOP 10 PHARMACY TARGETS
//    4. BIGGEST RISKS
//    5. BIGGEST OPPORTUNITIES
//    6. PRIM OPTIMIZATION
//    7. WEEKLY ROUTE PLAN
//    8. END OF PERIOD SCENARIO
//
//  Global bağımlılıklar:
//    GENEL, window.PHARMACY_INTELLIGENCE, window.ROUTE_OPTIMIZER
//    buildTTTContext (ai-context.js), buildRouteContext (route-optimizer.js)
//    calcPrimForTTT, getCarpan (prim-calc.js)
//
//  Yükleme sırası: ai-context.js + route-optimizer.js SONRASI
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard ─────────────────────────────────────────────────────────────
  if (window._SALES_COACH_V2_LOADED) {
    console.warn('[SalesCoachV2] Zaten yüklü — atlandı');
    return;
  }

  // ── State ─────────────────────────────────────────────────────────────
  window.AI_SALES_COACH = {
    tttFilter:         null,
    executiveSummary:  null,  // { status, successChance, gap, riskLevel, confidenceScore, priorityScore }
    todayActions:      [],    // [{ rank, eczane, brick, expectedValue, product, reason, priority }]
    topPharmacies:     [],    // top 10 pharma by visitPriorityScore
    biggestRisks:      [],    // [{ type, eczane/brick, description, severity }]
    biggestOpps:       [],    // [{ type, eczane/brick, description, potential }]
    primOptimization:  null,  // { current91, current100, current105 } TL gaps
    weeklyRoute:       [],    // from ROUTE_OPTIMIZER
    endOfPeriod:       null,  // { bad, normal, aggressive } scenarios
    generatedAt:       null
  };

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 1: Yardımcı — GENEL satır bul
  // ══════════════════════════════════════════════════════════════════════

  function _getGenelRow(ttt) {
    if (typeof GENEL === 'undefined' || !GENEL) return null;
    return GENEL.find(function (g) {
      return g.ttt === ttt && g.urun === 'GENEL TOPLAM';
    }) || null;
  }

  function _getAllTTTs() {
    if (typeof GENEL === 'undefined' || !GENEL) return [];
    var seen = {};
    return GENEL.filter(function (g) {
      if (g.urun !== 'GENEL TOPLAM') return false;
      if (seen[g.ttt]) return false;
      seen[g.ttt] = true;
      return true;
    }).map(function (g) { return g.ttt; });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 2: Executive Summary hesabı
  // ══════════════════════════════════════════════════════════════════════

  function _buildExecutiveSummary(ttt) {
    var row = _getGenelRow(ttt);
    if (!row) return null;

    var real  = row.tl_pct || 0;
    var hedef = 91; // prim eşiği

    // Durum
    var status = real >= 100 ? 'Mükemmel' :
                 real >= 91  ? 'İyi'       :
                 real >= 80  ? 'Kritik'    : 'Tehlike';

    // Başarı ihtimali (basit tahminci: real vs kalan dönem)
    var successChance = Math.min(99, Math.max(5, Math.round(real * 0.82 + 3)));
    if (real >= 100) successChance = 97;
    if (real >= 110) successChance = 99;

    // Gap: hedefe ulaşmak için gereken TL delta
    // BUG DÜZELTMESİ: row.tl_real / row.tl_target GENEL_TABLO şemasında hiç
    // yok (gerçek alanlar: satis_tl, hedef_tl — bkz. csv-parser.js). Bu
    // yüzden gap91TL/gap100TL her zaman 0 çıkıyor ve "Dönem Sonu
    // Senaryoları" kartı gerçek performanstan bağımsız olarak HER ZAMAN
    // "✅ Geçildi" gösteriyordu.
    var tlReal   = row.satis_tl || 0;
    var tlTarget = row.hedef_tl || 0;
    var gap91TL  = Math.max(0, (tlTarget * 0.91) - tlReal);
    var gap100TL = Math.max(0, tlTarget - tlReal);

    // Risk seviyesi
    var riskLevel = real >= 95  ? 'Düşük'  :
                    real >= 85  ? 'Orta'   :
                    real >= 75  ? 'Yüksek' : 'Çok Yüksek';

    // Confidence Score: data zenginliğine bakarak
    var hasPharmacy = !!(window.PHARMACY_INTELLIGENCE && window.PHARMACY_INTELLIGENCE.profiles && window.PHARMACY_INTELLIGENCE.profiles.length > 0);
    var hasRoute    = !!(window.ROUTE_OPTIMIZER && window.ROUTE_OPTIMIZER.todayRoute);
    var confidence  = 60 + (hasPharmacy ? 20 : 0) + (hasRoute ? 15 : 0) + (tlTarget > 0 ? 5 : 0);
    confidence = Math.min(100, confidence);

    // Priority Score: ne kadar acil aksiyon gerekli (ters korelasyon)
    var priority = Math.max(5, Math.min(100, Math.round(100 - real + 15)));
    if (real >= 100) priority = Math.round(priority * 0.4);

    return {
      status:          status,
      real:            Math.round(real * 10) / 10,
      hedef:           hedef,
      gap91TL:         Math.round(gap91TL),
      gap100TL:        Math.round(gap100TL),
      riskLevel:       riskLevel,
      successChance:   successChance,
      confidenceScore: confidence,
      priorityScore:   priority,
      tlReal:          tlReal,
      tlTarget:        tlTarget
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 3: Today Action Plan
  // ══════════════════════════════════════════════════════════════════════

  function _buildTodayActions(ttt) {
    var ro = window.ROUTE_OPTIMIZER;
    if (!ro || !ro.todayRoute || !ro.todayRoute.pharmacies) return [];

    var PRODUCTS = ['ACİDPASS', 'PANOCER', 'GRİPORT COLD', 'MOKSEFEN', 'FAMTREC'];

    return ro.todayRoute.pharmacies.slice(0, 10).map(function (p, i) {
      // Ürün öneri: prioritye göre
      var product = p.priority === 'URGENT' ? PRODUCTS[0] :
                    p.priority === 'OPPORTUNITY' ? PRODUCTS[1] :
                    PRODUCTS[i % PRODUCTS.length];

      // Sebep
      var reason = p.priority === 'URGENT'
        ? 'Sipariş zamanı geldi — ' + p.daysToNextOrder + ' günde son.'
        : p.priority === 'OPPORTUNITY'
          ? 'Yüksek fırsat skoru %' + p.opportunityScore + '.'
          : p.priority === 'RECOVERY'
            ? 'Risk altında — ' + p.classification + ' yeniden kazanım gerekli.'
            : 'Reorder olasılığı %' + p.reorderProbability + '.';

      return {
        rank:          i + 1,
        eczane:        p.eczane,
        brick:         p.brick,
        expectedValue: p.expectedOrderValue || 0,
        expectedBoxes: p.expectedOrderBoxes || 0,
        product:       product,
        reason:        reason,
        priority:      p.priority,
        reorderProb:   p.reorderProbability
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 4: Top 10 Pharmacy Targets
  // ══════════════════════════════════════════════════════════════════════

  function _buildTopPharmacies() {
    var pi = window.PHARMACY_INTELLIGENCE;
    if (!pi || !pi.profiles || !pi.profiles.length) return [];

    var sorted = pi.profiles.slice().sort(function (a, b) {
      return (b.visitPriorityScore || 0) - (a.visitPriorityScore || 0);
    });
    return sorted.slice(0, 10).map(function (p, i) {
      return {
        rank:               i + 1,
        eczane:             p.eczane,
        brick:              p.brick,
        classification:     p.classification,
        visitPriorityScore: p.visitPriorityScore,
        reorderProbability: p.reorderProbability,
        opportunityScore:   p.opportunityScore,
        expectedOrderBoxes: p.expectedOrderBoxes,
        expectedOrderValue: p.expectedOrderValue,
        daysToNextOrder:    p.daysToNextOrder
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 5: Biggest Risks
  // ══════════════════════════════════════════════════════════════════════

  function _buildRisks(ttt) {
    var risks = [];
    var pi    = window.PHARMACY_INTELLIGENCE;

    // Pharmacy-level risks
    if (pi && pi.profiles) {
      var atRisk = pi.profiles.filter(function (p) {
        return p.classification === 'AT_RISK' || p.classification === 'REACTIVATION';
      }).slice(0, 4);
      atRisk.forEach(function (p) {
        risks.push({
          type:        p.classification === 'AT_RISK' ? 'ECZANE_RISK' : 'KAYIP_ECZANE',
          eczane:      p.eczane,
          brick:       p.brick,
          description: p.classification === 'AT_RISK'
            ? 'Sipariş vermedi — ' + (p.daysSinceLastOrder || '?') + ' gün.'
            : 'Yeniden kazanım gerekli.',
          severity:    p.classification === 'AT_RISK' ? 'YÜKSEK' : 'ORTA'
        });
      });

      var campaignOnly = pi.profiles.filter(function (p) {
        return p.classification === 'CAMPAIGN_BUYER';
      }).slice(0, 2);
      campaignOnly.forEach(function (p) {
        risks.push({
          type:        'KAMPANYA_BAĞIMLISI',
          eczane:      p.eczane,
          brick:       p.brick,
          description: 'Yalnızca kampanyada sipariş veriyor.',
          severity:    'ORTA'
        });
      });
    }

    // GENEL dönem riski
    var row = _getGenelRow(ttt);
    if (row) {
      var real = row.tl_pct || 0;
      if (real < 85) {
        risks.unshift({
          type:        'DÖNEM_RİSKİ',
          brick:       'GENEL',
          description: 'Gerçekleşme %' + Math.round(real) + ' — prim eşiğinin altında!',
          severity:    'KRİTİK'
        });
      }
    }

    return risks.slice(0, 6);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 6: Biggest Opportunities
  // ══════════════════════════════════════════════════════════════════════

  function _buildOpportunities() {
    var opps = [];
    var pi   = window.PHARMACY_INTELLIGENCE;
    if (!pi || !pi.profiles) return opps;

    var growing = pi.profiles.filter(function (p) {
      return p.classification === 'GROWING' && p.reorderProbability > 60;
    }).slice(0, 3);
    growing.forEach(function (p) {
      opps.push({
        type:        'BÜYÜYEN_ECZANE',
        eczane:      p.eczane,
        brick:       p.brick,
        description: 'Büyüyor — sipariş olasılığı %' + p.reorderProbability + '.',
        potential:   p.expectedOrderValue || 0
      });
    });

    var highOpp = pi.profiles.filter(function (p) {
      return p.opportunityScore > 75 && p.classification !== 'GROWING';
    }).slice(0, 3);
    highOpp.forEach(function (p) {
      opps.push({
        type:        'YÜKSEK_FIRSAT',
        eczane:      p.eczane,
        brick:       p.brick,
        description: 'Fırsat skoru ' + p.opportunityScore + '/100.',
        potential:   p.expectedOrderValue || 0
      });
    });

    // Route urgents
    var ro = window.ROUTE_OPTIMIZER;
    if (ro && ro.todayRoute) {
      var urgents = ro.todayRoute.pharmacies.filter(function (p) {
        return p.priority === 'URGENT';
      }).slice(0, 2);
      urgents.forEach(function (p) {
        opps.push({
          type:        'ACİL_FIRSAT',
          eczane:      p.eczane,
          brick:       p.brick,
          description: '⚡ BUGÜN sipariş bekleniyor — ' + p.daysToNextOrder + ' gün kaldı.',
          potential:   p.expectedOrderValue || 0
        });
      });
    }

    return opps.slice(0, 6);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 7: Prim Optimization
  // ══════════════════════════════════════════════════════════════════════

  function _buildPrimOptimization(ttt) {
    if (typeof calcPrimForTTT !== 'function') return null;

    var row = _getGenelRow(ttt);
    if (!row) return null;

    // BUG DÜZELTMESİ: satis_tl/hedef_tl olmalıydı (bkz. yukarıdaki
    // _buildExecutiveSummary düzeltme notu) — eskiden tlTarget her zaman 0
    // okunduğu için bu fonksiyon HER ZAMAN null dönüyor, "Prim Optimizasyonu"
    // bölümü hiç görünmüyordu.
    var tlReal   = row.satis_tl || 0;
    var tlTarget = row.hedef_tl || 0;
    if (tlTarget <= 0) return null;

    var currentReal = row.tl_pct || 0;
    var current     = calcPrimForTTT(ttt);

    // 91% için gereken ek kutu/TL
    var need91  = Math.max(0, tlTarget * 0.91 - tlReal);
    var need100 = Math.max(0, tlTarget - tlReal);
    var need105 = Math.max(0, tlTarget * 1.05 - tlReal);

    // Prim farkları (approximate)
    var prim91  = typeof getCarpan === 'function' ? getCarpan(91)  * 55000 : 0;
    var prim100 = typeof getCarpan === 'function' ? getCarpan(100) * 55000 : 0;
    var prim105 = typeof getCarpan === 'function' ? getCarpan(105) * 55000 * 1.20 : 0;

    return {
      currentReal:  Math.round(currentReal * 10) / 10,
      currentPrim:  Math.round(current),
      need91:       Math.round(need91),
      need100:      Math.round(need100),
      need105:      Math.round(need105),
      prim91:       Math.round(prim91),
      prim100:      Math.round(prim100),
      prim105:      Math.round(prim105),
      diff91:       Math.round(prim91 - current),
      diff100:      Math.round(prim100 - current),
      diff105:      Math.round(prim105 - current)
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 8: End of Period Scenarios
  // ══════════════════════════════════════════════════════════════════════

  function _buildEndOfPeriod(ttt) {
    var row = _getGenelRow(ttt);
    if (!row) return null;

    if (typeof calculateRunRate !== 'function') return null;
    var rr = calculateRunRate(ttt);
    if (!rr || !rr.totalDays || !row.hedef_tl) return null;

    var tlReal   = row.satis_tl || 0;
    var tlTarget = row.hedef_tl || 0;

    // "Normal" senaryo = calculateRunRate'in kendi projeksiyonu (zaten
    // haftalık-ortalama bazlı, gerçek dönem uzunluğuna göre doğru hesaplı).
    // "Kötü"/"Agresif" senaryolar SADECE KALAN dönemdeki hızı ±yüzde
    // değiştirir — şimdiye kadar gerçekleşen satış (tlReal) sabit kalır.
    var normalTL      = rr.projectedMonthEnd || tlReal;
    var remainingPart = Math.max(0, normalTL - tlReal);
    var badTL         = tlReal + remainingPart * 0.85;
    var aggressiveTL  = tlReal + remainingPart * 1.20;

    var badReal        = Math.round((badTL / tlTarget) * 1000) / 10;
    var normalReal     = Math.round((normalTL / tlTarget) * 1000) / 10;
    var aggressiveReal = Math.round((aggressiveTL / tlTarget) * 1000) / 10;

    return {
      workDaysLeft:   rr.remainingDays,
      bad:            { label: 'Kötü',    pct: Math.min(150, badReal),        icon: '🔴' },
      normal:         { label: 'Normal',  pct: Math.min(150, normalReal),     icon: '🟡' },
      aggressive:     { label: 'Agresif', pct: Math.min(150, aggressiveReal), icon: '🟢' }
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 9: buildSalesCoachContext — AI'ya giden birleşik context
  // ══════════════════════════════════════════════════════════════════════

  function buildSalesCoachContext(tttFilter) {
    try {
      var sc = window.AI_SALES_COACH;
      if (!sc || !sc.executiveSummary || sc.tttFilter !== (tttFilter || 'TÜMÜ')) {
        runSalesCoach(tttFilter);
        sc = window.AI_SALES_COACH;
      }

      var lines = [
        '',
        '══════════════════════════════════════',
        'AI SATIŞ KOÇU V2 (Phase 4.8)',
        'AI TALİMAT: Önce route optimizer çıktısını analiz et. Sonra satış stratejisini oluştur.',
        'NE YAPMALIYIM? sorusuna mutlaka cevap ver.',
        '══════════════════════════════════════',
        ''
      ];

      // 1. EXECUTIVE SUMMARY
      if (sc.executiveSummary) {
        var es = sc.executiveSummary;
        lines.push('1. EXECUTIVE SUMMARY');
        lines.push('Durum: ' + es.status);
        lines.push('Gerçekleşme: %' + es.real + ' | Hedef: %' + es.hedef);
        lines.push('Gap (91%): ' + es.gap91TL.toLocaleString('tr-TR') + '₺');
        lines.push('Gap (100%): ' + es.gap100TL.toLocaleString('tr-TR') + '₺');
        lines.push('Risk: ' + es.riskLevel);
        lines.push('Başarı ihtimali: %' + es.successChance);
        lines.push('Confidence Score: ' + es.confidenceScore + '/100');
        lines.push('Priority Score: ' + es.priorityScore + '/100');
        lines.push('');
      }

      // 2. TODAY ACTION PLAN
      if (sc.todayActions && sc.todayActions.length) {
        lines.push('2. TODAY ACTION PLAN — BUGÜN YAP');
        sc.todayActions.slice(0, 5).forEach(function (a) {
          lines.push(a.rank + '. ' + a.eczane + ' [' + a.brick + ']');
          lines.push('   Beklenen: ' + a.expectedValue.toLocaleString('tr-TR') + '₺ | Ürün: ' + a.product);
          lines.push('   Sebep: ' + a.reason);
        });
        lines.push('');
      }

      // 3. TOP 10 PHARMACY TARGETS
      if (sc.topPharmacies && sc.topPharmacies.length) {
        lines.push('3. TOP 10 PHARMACY TARGETS');
        sc.topPharmacies.slice(0, 5).forEach(function (p) {
          lines.push(p.rank + '. ' + p.eczane + ' | Puan: ' + p.visitPriorityScore +
            ' | Reorder: %' + p.reorderProbability + ' | ' + p.classification);
        });
        lines.push('');
      }

      // 4. BIGGEST RISKS
      if (sc.biggestRisks && sc.biggestRisks.length) {
        lines.push('4. BIGGEST RISKS');
        sc.biggestRisks.slice(0, 4).forEach(function (r) {
          lines.push('[' + r.severity + '] ' + r.type + ': ' + r.description);
        });
        lines.push('');
      }

      // 5. BIGGEST OPPORTUNITIES
      if (sc.biggestOpps && sc.biggestOpps.length) {
        lines.push('5. BIGGEST OPPORTUNITIES');
        sc.biggestOpps.slice(0, 4).forEach(function (o) {
          lines.push(o.type + ': ' + o.description +
            (o.potential > 0 ? ' (' + o.potential.toLocaleString('tr-TR') + '₺)' : ''));
        });
        lines.push('');
      }

      // 6. PRIM OPTIMIZATION
      if (sc.primOptimization) {
        var p = sc.primOptimization;
        lines.push('6. PRIM OPTIMIZATION');
        lines.push('Mevcut gerçekleşme: %' + p.currentReal);
        lines.push('%91 için: +' + p.need91.toLocaleString('tr-TR') + '₺ gerekli → Prim farkı: +' + p.diff91.toLocaleString('tr-TR') + '₺');
        lines.push('%100 için: +' + p.need100.toLocaleString('tr-TR') + '₺ gerekli → Prim farkı: +' + p.diff100.toLocaleString('tr-TR') + '₺');
        lines.push('%105 için: +' + p.need105.toLocaleString('tr-TR') + '₺ gerekli → Prim farkı: +' + p.diff105.toLocaleString('tr-TR') + '₺');
        lines.push('');
      }

      // 7. WEEKLY ROUTE PLAN
      var ro = window.ROUTE_OPTIMIZER;
      if (ro && ro.weeklyRoutes && ro.weeklyRoutes.length) {
        lines.push('7. WEEKLY ROUTE PLAN');
        ro.weeklyRoutes.forEach(function (d) {
          lines.push(d.day + ': ' + d.pharmacyCount + ' eczane | ' + d.brick +
            ' | ' + d.expectedBoxes + ' kutu | ' + d.expectedRevenue.toLocaleString('tr-TR') + '₺' +
            (d.urgentCount > 0 ? ' ⚡' + d.urgentCount + ' ACİL' : ''));
        });
        lines.push('');
      }

      // 8. END OF PERIOD SCENARIO
      if (sc.endOfPeriod) {
        var ep = sc.endOfPeriod;
        lines.push('8. END OF PERIOD SCENARIO (' + ep.workDaysLeft + ' iş günü kaldı)');
        lines.push(ep.bad.icon       + ' Kötü:    %' + ep.bad.pct);
        lines.push(ep.normal.icon    + ' Normal:  %' + ep.normal.pct);
        lines.push(ep.aggressive.icon + ' Agresif: %' + ep.aggressive.pct);
        lines.push('');
      }

      lines.push('══════════════════════════════════════');
      return lines.join('\n');

    } catch (err) {
      console.warn('[SalesCoachV2] buildSalesCoachContext hata:', err.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 10: Ana orkestrasyon
  // ══════════════════════════════════════════════════════════════════════

  function runSalesCoach(tttFilter) {
    try {
      // Route Optimizer'ın çalıştığından emin ol
      if (typeof runRouteOptimizer === 'function' && window._ROUTE_OPTIMIZER_READY) {
        if (!window.ROUTE_OPTIMIZER || !window.ROUTE_OPTIMIZER.todayRoute ||
            window.ROUTE_OPTIMIZER.tttFilter !== (tttFilter || 'TÜMÜ')) {
          runRouteOptimizer(tttFilter);
        }
      }

      // Pharmacy Intelligence'ı çalıştır
      if (typeof buildPharmacyProfiles === 'function' &&
          (!window.PHARMACY_INTELLIGENCE || !window.PHARMACY_INTELLIGENCE.profiles)) {
        try { buildPharmacyProfiles(tttFilter); } catch (_e) { /* silent */ }
      }

      // TTT filtresi — ilk TTT veya verilen TTT
      var ttt = tttFilter || (typeof selTTT !== 'undefined' && selTTT) ||
                (_getAllTTTs()[0] || '');

      var es   = _buildExecutiveSummary(ttt);
      var acts = _buildTodayActions(ttt);
      var tops = _buildTopPharmacies();
      var rsk  = _buildRisks(ttt);
      var opp  = _buildOpportunities();
      var prim = _buildPrimOptimization(ttt);
      var ep   = _buildEndOfPeriod(ttt);
      var wk   = (window.ROUTE_OPTIMIZER && window.ROUTE_OPTIMIZER.weeklyRoutes) || [];

      window.AI_SALES_COACH = {
        tttFilter:        tttFilter || 'TÜMÜ',
        ttt:              ttt,
        executiveSummary: es,
        todayActions:     acts,
        topPharmacies:    tops,
        biggestRisks:     rsk,
        biggestOpps:      opp,
        primOptimization: prim,
        weeklyRoute:      wk,
        endOfPeriod:      ep,
        generatedAt:      new Date().toISOString()
      };

      console.log(
        '[SalesCoachV2] ✅ Phase 4.8:',
        es ? es.status : '—',
        '| Acts:', acts.length,
        '| Risks:', rsk.length,
        '| Opps:', opp.length
      );
      return true;

    } catch (err) {
      console.error('[SalesCoachV2] runSalesCoach hata:', err);
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 11: Dashboard — "AI Satış Koçu" Kartı
  // ══════════════════════════════════════════════════════════════════════

  function renderCoachSummaryCard(containerId, tttFilter) {
    var container = document.getElementById(containerId);
    if (!container) return;

    runSalesCoach(tttFilter);
    var sc = window.AI_SALES_COACH;
    var es = sc && sc.executiveSummary;

    if (!es) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim)">⏳ Koç verisi hazırlanıyor…</div>';
      return;
    }

    // Durum rengi
    var statusColor = es.status === 'Mükemmel' ? '#15803D' :
                      es.status === 'İyi'       ? '#1D4ED8' :
                      es.status === 'Kritik'    ? '#D97706' : '#DC2626';

    // Bugünün 5 aksiyonu
    var actions = sc.todayActions.slice(0, 5);
    var actionRows = actions.map(function (a) {
      var prioIcon = a.priority === 'URGENT' ? '⚡' :
                     a.priority === 'OPPORTUNITY' ? '💡' :
                     a.priority === 'RECOVERY' ? '🔄' : '•';
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:13px;font-weight:800;color:var(--c1);min-width:18px">' + a.rank + '.</span>' +
        '<div style="flex:1">' +
          '<div style="font-size:11px;font-weight:700">' + prioIcon + ' ' + a.eczane + '</div>' +
          '<div style="font-size:9px;color:var(--dim)">' + a.brick + ' | ' + a.product + '</div>' +
          '<div style="font-size:9px;color:var(--text);margin-top:1px">' + a.reason + '</div>' +
        '</div>' +
        '<div style="font-weight:800;font-size:11px;color:#15803D;white-space:nowrap">' +
          (a.expectedValue > 0 ? a.expectedValue.toLocaleString('tr-TR') + '₺' : a.expectedBoxes + ' kts') +
        '</div>' +
      '</div>';
    }).join('');

    // Confidence & priority gauge HTML
    var _gauge = function (val, label, color) {
      return '<div style="flex:1;text-align:center;padding:8px 4px">' +
        '<div style="font-size:18px;font-weight:900;color:' + color + '">' + val + '</div>' +
        '<div style="font-size:8px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">' + label + '</div>' +
        '<div style="height:4px;background:#E2E8F0;border-radius:2px;margin-top:4px">' +
          '<div style="height:100%;width:' + val + '%;background:' + color + ';border-radius:2px"></div>' +
        '</div>' +
      '</div>';
    };

    container.innerHTML =
      '<div class="card" style="border:2px solid ' + statusColor + '22">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-title">🤖 AI Satış Koçu</span>' +
          '<span class="card-badge" style="background:' + statusColor + '22;color:' + statusColor + ';font-weight:800">' + es.status + '</span>' +
          '<span class="card-badge" style="background:#EFF6FF;color:#1D4ED8">%' + es.real + ' gerçekleşme</span>' +
          '<span class="card-badge" style="background:#FEF3C7;color:#D97706">%' + es.successChance + ' başarı ihtimali</span>' +
        '</div>' +
        '<div class="card-body-0" style="padding:12px 16px">' +

          // Gauge bar
          '<div style="display:flex;gap:4px;background:var(--surf2);border-radius:10px;margin-bottom:12px">' +
            _gauge(es.confidenceScore, 'Confidence', '#4F008C') +
            '<div style="width:1px;background:var(--border);margin:8px 0"></div>' +
            _gauge(es.priorityScore,   'Öncelik',    '#DC2626') +
            '<div style="width:1px;background:var(--border);margin:8px 0"></div>' +
            _gauge(es.successChance,   'Başarı %',   '#15803D') +
          '</div>' +

          // Status grid
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
            '<div style="background:var(--surf2);border-radius:8px;padding:8px 10px">' +
              '<div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Gap (91%)</div>' +
              '<div style="font-size:13px;font-weight:800;color:' + (es.gap91TL > 0 ? '#DC2626' : '#15803D') + '">' +
                (es.gap91TL > 0 ? es.gap91TL.toLocaleString('tr-TR') + '₺' : '✅ Geçildi') +
              '</div>' +
            '</div>' +
            '<div style="background:var(--surf2);border-radius:8px;padding:8px 10px">' +
              '<div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Risk Seviyesi</div>' +
              '<div style="font-size:13px;font-weight:800;color:' + statusColor + '">' + es.riskLevel + '</div>' +
            '</div>' +
          '</div>' +

          // Today's 5 actions
          '<div style="font-size:9px;font-weight:700;color:var(--c1);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">BUGÜN YAP — Günün 5 Aksiyonu</div>' +
          (actions.length ? actionRows :
            '<div style="font-size:11px;color:var(--dim);padding:8px 0">⏳ Aksiyon listesi hazırlanıyor…</div>') +

          // Refresh button
          '<button class="btn-calc" style="margin-top:10px;font-size:10px;padding:7px 14px;border-radius:8px;width:100%"' +
            ' onclick="(function(){runSalesCoach(null);renderCoachSummaryCard(\'' + containerId + '\');renderScenarioCard(\'salesCoachScenarioCard\');})()">' +
            '🔄 Koçu Yenile' +
          '</button>' +

        '</div>' +
      '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 12: Dashboard — "Dönem Sonu Senaryoları" Kartı
  // ══════════════════════════════════════════════════════════════════════

  function renderScenarioCard(containerId, tttFilter) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var sc = window.AI_SALES_COACH;
    if (!sc || !sc.endOfPeriod) {
      runSalesCoach(tttFilter);
      sc = window.AI_SALES_COACH;
    }

    var ep = sc && sc.endOfPeriod;
    var pr = sc && sc.primOptimization;

    if (!ep) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim)">⏳ Senaryo verisi hazırlanıyor…</div>';
      return;
    }

    var _scenCard = function (scen, color, bgColor) {
      return '<div style="flex:1;min-width:130px;background:' + bgColor + ';border:2px solid ' + color + '44;' +
             'border-radius:12px;padding:14px;text-align:center">' +
        '<div style="font-size:24px;margin-bottom:4px">' + scen.icon + '</div>' +
        '<div style="font-size:11px;font-weight:700;color:' + color + ';margin-bottom:2px">' + scen.label + '</div>' +
        '<div style="font-size:26px;font-weight:900;color:' + color + '">%' + scen.pct + '</div>' +
        '<div style="font-size:9px;color:var(--dim);margin-top:2px">Beklenen Kapanış</div>' +
      '</div>';
    };

    var primRows = pr ? (
      '<div style="margin-top:12px">' +
        '<div style="font-size:9px;font-weight:700;color:var(--c1);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">PRİM OPTİMİZASYONU</div>' +
        '<div style="display:flex;flex-direction:column;gap:5px">' +
          _primRow('%91 için', pr.need91, pr.diff91, '#D97706') +
          _primRow('%100 için', pr.need100, pr.diff100, '#0891B2') +
          _primRow('%105 için', pr.need105, pr.diff105, '#15803D') +
        '</div>' +
      '</div>'
    ) : '';

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-title">📊 Dönem Sonu Senaryoları</span>' +
          '<span class="card-badge">' + ep.workDaysLeft + ' iş günü kaldı</span>' +
        '</div>' +
        '<div class="card-body-0" style="padding:12px 16px">' +
          '<div style="display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px">' +
            _scenCard(ep.bad,        '#DC2626', '#FEF2F2') +
            _scenCard(ep.normal,     '#D97706', '#FFFBEB') +
            _scenCard(ep.aggressive, '#15803D', '#F0FDF4') +
          '</div>' +

          // Risks & Opps short
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">' +
            _miniList('En Büyük Riskler', sc.biggestRisks, '#DC2626', '⚠️') +
            _miniList('En Büyük Fırsatlar', sc.biggestOpps, '#15803D', '💡') +
          '</div>' +

          primRows +

        '</div>' +
      '</div>';
  }

  function _primRow(label, need, diff, color) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;' +
           'background:var(--surf2);border-radius:6px;padding:5px 10px">' +
      '<span style="font-size:10px;font-weight:700;color:' + color + '">' + label + '</span>' +
      '<span style="font-size:10px;color:var(--dim)">+' + need.toLocaleString('tr-TR') + '₺ gerekli</span>' +
      '<span style="font-size:11px;font-weight:800;color:' + color + '">+' + diff.toLocaleString('tr-TR') + '₺ prim</span>' +
    '</div>';
  }

  function _miniList(title, items, color, icon) {
    var rows = (items || []).slice(0, 3).map(function (item) {
      // description zaten eczane/brick adını içeriyor — sadece description göster
      var desc = (item.description || '').trim();
      // Eğer description eczane adıyla başlıyorsa adı çıkar, kısa tut
      var prefix = item.eczane || item.brick || '';
      if (prefix && desc.indexOf(prefix) === 0) {
        desc = desc.slice(prefix.length).replace(/^[\s:\-–]+/, '');
      }
      // İlk harf büyük
      desc = desc.charAt(0).toUpperCase() + desc.slice(1);
      return '<div style="font-size:9px;color:var(--text);padding:3px 0;border-bottom:1px solid var(--border);line-height:1.4">' +
        '<span style="font-weight:700;color:var(--text)">' + icon + ' ' + prefix + '</span>' +
        (desc ? '<br><span style="color:var(--dim)">' + desc + '</span>' : '') +
      '</div>';
    }).join('');
    return '<div style="background:var(--surf2);border-radius:8px;padding:8px 10px">' +
      '<div style="font-size:9px;font-weight:700;color:' + color + ';margin-bottom:5px;text-transform:uppercase;letter-spacing:1px">' + title + '</div>' +
      (rows || '<div style="font-size:9px;color:var(--dim)">Veri yok</div>') +
    '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════

  window.buildSalesCoachContext  = buildSalesCoachContext;
  window.runSalesCoach           = runSalesCoach;
  window.renderCoachSummaryCard  = renderCoachSummaryCard;
  window.renderScenarioCard      = renderScenarioCard;

  window._SALES_COACH_V2_LOADED  = true;
  window._SALES_COACH_V2_READY   = true;

  console.log('[SalesCoachV2] ✅ Phase 4.8 yüklendi');

})();
