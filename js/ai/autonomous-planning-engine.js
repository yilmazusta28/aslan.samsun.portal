// ══════════════════════════════════════════════════════════════════════
//  js/ai/autonomous-planning-engine.js — PHASE 5.7
//  Autonomous Planning Engine — AI Saha Koçu
//
//  Sorumluluk:
//    • generateDailyPlan(ttt)       → window.dailyMission
//    • generateWeeklyPlan(ttt)      → window.weeklyMission
//    • generateMonthlySprint(ttt)   → window.monthlyMission
//    • optimizeGapClosure(ttt)      → gap kapama stratejisi
//    • generateActionCards(ttt)     → 5 aksiyon kartı
//    • renderAutonomousDashboard(containerId, ttt) → UI render
//
//  Motor Registry (future-proof, hardcoded bağımlılık YOK):
//    window._APE_REGISTRY içine motor eklenebilir.
//
//  Persistence:
//    DAILY_MISSION_V1   → localStorage (günlük plan)
//    WEEKLY_MISSION_V1  → localStorage (haftalık plan)
//
//  Global bağımlılıklar:
//    GENEL, IMS, MIGI_BRICK_TL_RAW, ECZANE_RAW, PERIODS
//    buildPharmacyProfiles, buildTop30Pharmacies (pharmacy-intelligence.js)
//    buildVisitPlan (visit-planner.js)
//    buildWeeklyRoutes, buildTodayRoute (route-optimizer.js)
//    rankBricks (brick-ranking-engine.js)
//    simulateTarget, simulatePrim, bestPrimScenario (simulator/)
//    calculateRunRate (runrate-engine.js)
//    analyzeProductImpact (scenario-builder.js)
//    adaptiveModel (learning-engine.js / Phase 5.5)
//    workDays, fTL, fPct (core utils)
//
//  Yükleme sırası: ai-engine.js SONRASI
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard ─────────────────────────────────────────────────────────────
  if (window._APE_LOADED) {
    console.warn('[APE] Zaten yüklü — atlandı');
    return;
  }
  window._APE_LOADED = true;

  // ── Sabitler ──────────────────────────────────────────────────────────
  var STORE_DAILY   = 'DAILY_MISSION_V1';
  var STORE_WEEKLY  = 'WEEKLY_MISSION_V1';
  var DAY_TR        = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
  var PRODUCTS      = ['PANOCER', 'ACİDPASS', 'GRİPORT COLD', 'MOKSEFEN', 'FAMTREC'];

  // ── Motor Registry (future-proof) ─────────────────────────────────────
  // Dışarıdan motor eklemek için:
  //   window._APE_REGISTRY.push({ id: 'promo-engine', fn: myFn, weight: 1.0 });
  window._APE_REGISTRY = window._APE_REGISTRY || [];

  // ── Global State ──────────────────────────────────────────────────────
  window.dailyMission   = null;
  window.weeklyMission  = null;
  window.monthlyMission = null;

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 1: Yardımcı Fonksiyonlar
  // ══════════════════════════════════════════════════════════════════════

  function _today() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function _todayLabel() {
    var d = new Date();
    return DAY_TR[d.getDay()] + ', ' +
      d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function _fTL(v) {
    if (typeof fTL === 'function') return fTL(v);
    return (v || 0).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
  }

  function _fPct(v) {
    if (typeof fPct === 'function') return fPct(v);
    return (v || 0).toFixed(1) + '%';
  }

  function _workDays(from, to) {
    if (typeof workDays === 'function') return workDays(from, to);
    var a = new Date(from), b = new Date(to), cnt = 0;
    while (a <= b) {
      var dw = a.getDay();
      if (dw > 0 && dw < 6) cnt++;
      a.setDate(a.getDate() + 1);
    }
    return cnt;
  }

  // Aktif dönem bilgisi
  // BUG DÜZELTMESİ: bkz. date-utils.js getEffectivePeriod() yorumu — saf
  // takvim tarihiyle dönem seçmek, yeni dönemin verisi henüz sisteme
  // girilmeden "kalan gün"ü yeni döneme göre hesaplıyordu.
  function _getCurrentPeriod() {
    var today = _today();
    if (typeof getEffectivePeriod === 'function') return getEffectivePeriod(today);
    var periods = (typeof PERIODS !== 'undefined') ? PERIODS : [];
    return periods.find(function (p) { return today >= p.start && today <= p.end; }) || null;
  }

  // GENEL TOPLAM satırını getir
  function _getGT(ttt) {
    var genel = (typeof GENEL !== 'undefined') ? GENEL : [];
    return genel.find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; }) || null;
  }

  // Adaptif ağırlık: Phase 5.5 learning engine varsa kullan
  function _adaptiveWeight(engineId, defaultWeight) {
    try {
      if (window.adaptiveModel && window.adaptiveModel.weights &&
          window.adaptiveModel.weights[engineId] !== undefined) {
        return window.adaptiveModel.weights[engineId];
      }
    } catch (_e) {}
    return defaultWeight;
  }

  // ── Pharmacy profilleri (önbellekli) ──────────────────────────────────
  function _getProfiles(ttt) {
    try {
      if (typeof buildPharmacyProfiles === 'function') {
        return buildPharmacyProfiles(ttt) || [];
      }
    } catch (_e) {}
    return [];
  }

  function _getTop30(ttt) {
    try {
      if (typeof buildTop30Pharmacies === 'function') {
        return buildTop30Pharmacies(ttt) || [];
      }
      // fallback: profilleri sırala
      var profiles = _getProfiles(ttt);
      return profiles
        .slice()
        .sort(function (a, b) { return (b.visitPriorityScore || 0) - (a.visitPriorityScore || 0); })
        .slice(0, 30);
    } catch (_e) {}
    return [];
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 2: Visit Selection Engine (visitScore formülü)
  // ══════════════════════════════════════════════════════════════════════
  //
  //  visitScore = reorderScore × 0.30
  //             + growthScore  × 0.20
  //             + gapContrib   × 0.25
  //             + visitSuccess × 0.15
  //             + confidence   × 0.10
  //
  //  Adaptif öğrenme: ağırlıklar learning-engine'den gelir.

  function _calcVisitScore(profile) {
    var w1 = _adaptiveWeight('reorder',  0.30);
    var w2 = _adaptiveWeight('growth',   0.20);
    var w3 = _adaptiveWeight('gap',      0.25);
    var w4 = _adaptiveWeight('visit',    0.15);
    var w5 = _adaptiveWeight('conf',     0.10);

    var reorderScore  = (profile.reorderProbability   || 0) / 100;
    var growthScore   = Math.max(0, Math.min(1, (profile.growthRate || 0) / 50));
    var gapContrib    = (profile.gapContribution      || profile.opportunityScore || 0) / 100;
    var visitSuccess  = (profile.visitSuccessRate      || profile.visitPriorityScore || 50) / 100;
    var confidence    = 1 - Math.min(1, (profile.consecutiveZeroMonths || 0) / 6);

    return Math.min(100, (
      reorderScore * w1 +
      growthScore  * w2 +
      gapContrib   * w3 +
      visitSuccess * w4 +
      confidence   * w5
    ) * 100);
  }

  // Neden bu eczane? açıklaması
  function _explainVisit(profile) {
    var reasons = [];
    if ((profile.consecutiveGrowthMonths || 0) >= 2)
      reasons.push('✓ Son ' + profile.consecutiveGrowthMonths + ' ay büyüme');
    if ((profile.reorderProbability || 0) >= 70)
      reasons.push('✓ Sipariş döngüsü tamamlandı (%' + Math.round(profile.reorderProbability) + ')');
    if ((profile.opportunityScore || 0) >= 70)
      reasons.push('✓ Gap katkısı yüksek');
    if ((profile.visitPriorityScore || 0) >= 70)
      reasons.push('✓ Visit başarı oranı %' + Math.round(profile.visitPriorityScore));
    if ((profile.consecutiveZeroMonths || 0) >= 2)
      reasons.push('⚠️ ' + profile.consecutiveZeroMonths + ' ay 0 realizasyon');
    if (reasons.length === 0) reasons.push('✓ Standart takip');
    return reasons;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 3: Gap Closure Optimizer
  // ══════════════════════════════════════════════════════════════════════

  function optimizeGapClosure(ttt) {
    var gt      = _getGT(ttt);
    var period  = _getCurrentPeriod();
    if (!gt || !period) return { error: 'Veri yetersiz' };

    var today      = _today();
    var remaining  = _workDays(today, period.end);
    var kalanTL    = Math.max(0, gt.kalan_tl || 0);
    var dailyNeed  = remaining > 0 ? kalanTL / remaining : 0;

    // Ürün etkisi analizi
    var productImpact = [];
    try {
      if (typeof analyzeProductImpact === 'function') {
        productImpact = analyzeProductImpact(ttt) || [];
      }
    } catch (_e) {}

    // Top pharmacy contributors
    var top30  = _getTop30(ttt);
    var top5   = top30.slice(0, 5).map(function (p) {
      return {
        eczane:       p.eczane,
        brick:        p.brick,
        expectedTL:   p.expectedOrderValue || 0,
        daysToOrder:  p.daysToNextOrder || 0,
        reorderProb:  p.reorderProbability || 0
      };
    });

    return {
      kalanGap:      kalanTL,
      remainingDays: remaining,
      dailyNeed:     dailyNeed,
      topPharmacies: top5,
      productImpact: productImpact.slice(0, 3),
      strategy:      dailyNeed > 80000
        ? 'Yüksek hacimli ziyaretlere odaklan. Günlük hedef kritik seviyede.'
        : dailyNeed > 50000
        ? 'Normal tempo ile ulaşılabilir. Top 30 ziyareti sürdür.'
        : 'Gap kapanıyor. Prim optimizasyonuna geç.'
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 4: Başarı Olasılığı Hesabı
  // ══════════════════════════════════════════════════════════════════════

  function _calcSuccessProbability(ttt, dailyNeed, dailyExpected) {
    if (!dailyNeed || dailyNeed <= 0) return 95;
    var ratio = dailyExpected / dailyNeed;

    // Adaptif model varsa ağırlık ver
    var baseProb = Math.min(99, Math.round(ratio * 82));

    // Geçmiş tahmin doğruluğu boostı
    try {
      if (window.predictionStore && window.predictionStore.metrics) {
        var acc = window.predictionStore.metrics.overallAccuracy;
        if (acc) baseProb = Math.round(baseProb * (0.7 + 0.3 * (acc / 100)));
      }
    } catch (_e) {}

    return Math.max(10, Math.min(99, baseProb));
  }

  function _probLabel(prob) {
    if (prob >= 85) return { text: 'Çok iyi', color: '#22c55e', icon: '🟢' };
    if (prob >= 72) return { text: 'Ulaşılabilir', color: '#3b82f6', icon: '🔵' };
    if (prob >= 58) return { text: 'Riskli', color: '#f59e0b', icon: '🟡' };
    return { text: 'Düşük ihtimal', color: '#ef4444', icon: '🔴' };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 5: Risk ve Fırsat Motorları
  // ══════════════════════════════════════════════════════════════════════

  function _buildWarnings(ttt, profiles) {
    var warnings = [];
    profiles.forEach(function (p) {
      if ((p.consecutiveZeroMonths || 0) >= 2) {
        warnings.push({
          type:    'ZERO_SALES',
          eczane:  p.eczane,
          brick:   p.brick,
          message: p.eczane + ' — ' + p.consecutiveZeroMonths + ' ay 0 realizasyon',
          icon:    '⚠️'
        });
      }
      if ((p.consecutiveDeclineMonths || 0) >= 3) {
        warnings.push({
          type:    'DECLINING',
          eczane:  p.eczane,
          brick:   p.brick,
          message: p.eczane + ' — MI düşüyor (' + p.consecutiveDeclineMonths + ' ay)',
          icon:    '⚠️'
        });
      }
    });

    // Brick bazlı IMS uyarıları
    // BUG DÜZELTMESİ: r.ttt → r.person (gerçek alan adı) + sadece EN GÜNCEL
    // döneme ait satırlar kullanılıyor (bkz. prim-calc.js düzeltme notu).
    try {
      var imsData = (typeof MIGI_BRICK_TL_RAW !== 'undefined') ? MIGI_BRICK_TL_RAW : [];
      var _migiDonemNum = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
      var _tttRowsByBrick = {};
      imsData.filter(function (r) { return r.person === ttt; }).forEach(function (r) {
        if (!_tttRowsByBrick[r.brick]) _tttRowsByBrick[r.brick] = [];
        _tttRowsByBrick[r.brick].push(r);
      });
      Object.keys(_tttRowsByBrick).forEach(function (brick) {
        var rows = _tttRowsByBrick[brick];
        var latest = rows.reduce(function (max, r) { return Math.max(max, _migiDonemNum(r.donem)); }, 0);
        var r = rows.filter(function (rr) { return _migiDonemNum(rr.donem) === latest; })[0];
        if (r && (r.mi || 100) < 85) {
          warnings.push({
            type:    'LOW_MI',
            eczane:  r.brick,
            brick:   r.brick,
            message: r.brick + ' — IMS payı düşük (MI: ' + Math.round(r.mi || 0) + ')',
            icon:    '⚠️'
          });
        }
      });
    } catch (_e) {}

    // Sıralayıp üst 5'ini döndür
    return warnings.slice(0, 5);
  }

  function _buildOpportunities(ttt, profiles) {
    return profiles
      .filter(function (p) {
        return (p.consecutiveGrowthMonths || 0) >= 3 ||
               (p.daysToNextOrder || 999) <= 5 ||
               (p.opportunityScore || 0) >= 80;
      })
      .sort(function (a, b) { return (b.opportunityScore || 0) - (a.opportunityScore || 0); })
      .slice(0, 5)
      .map(function (p) {
        var reason = '';
        if ((p.consecutiveGrowthMonths || 0) >= 3)
          reason = p.consecutiveGrowthMonths + ' ay büyüme';
        else if ((p.daysToNextOrder || 999) <= 5)
          reason = 'Sipariş zamanı geldi';
        else
          reason = 'Gap katkısı yüksek';
        return {
          eczane:  p.eczane,
          brick:   p.brick,
          reason:  reason,
          score:   p.opportunityScore || 0,
          icon:    '🚀'
        };
      });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 6: Prim Maksimizasyonu
  // ══════════════════════════════════════════════════════════════════════

  function _buildPrimMaxItems(ttt) {
    var items = [];
    try {
      var best = (typeof bestPrimScenario === 'function') ? bestPrimScenario(ttt) : null;
      var genel = (typeof GENEL !== 'undefined') ? GENEL : [];
      var urunRows = genel.filter(function (r) {
        return r.ttt === ttt && r.urun !== 'GENEL TOPLAM' && r.urun !== 'DESTEVIT';
      });

      urunRows.sort(function (a, b) {
        return ((b.hedef_tl || 0) - (b.satis_tl || 0)) -
               ((a.hedef_tl || 0) - (a.satis_tl || 0));
      });

      urunRows.slice(0, 5).forEach(function (r) {
        var gap    = Math.max(0, (r.hedef_tl || 0) - (r.satis_tl || 0));
        var price  = (typeof IMS_TL_MAP !== 'undefined' && IMS_TL_MAP[r.urun]) ? IMS_TL_MAP[r.urun] : 100;
        var boxes  = Math.ceil(gap / price);
        if (boxes <= 0) return;
        var primEtki = Math.round(gap * 0.035); // tahmini prim yansıması
        items.push({
          urun:     r.urun,
          boxes:    boxes,
          primEtki: primEtki,
          gapTL:    gap
        });
      });
    } catch (_e) {}
    return items.slice(0, 3);
  }

  // BUG DÜZELTMESİ (kullanıcı bulgusu): "Bugün Sat" listesi eskiden sadece
  // eczanenin GEÇMİŞ satış afinitesine (productAffinityScore) bakarak ürün
  // seçiyordu — bu yüzden tüm gün boyunca hep en çok satılan 1-2 ürün
  // (PANOCER/ACİDPASS) öneriliyor, "Haftalık Aksiyon Planı"nın hedef açığına
  // göre satılması gerektiğini söylediği diğer ürünler (GRİPORT COLD,
  // MOKSEFEN, FAMTREC) hiç günlük göreve girmiyordu. _buildProductGapWeight,
  // analyzeProductImpact() (scenario-builder.js — "Haftalık Aksiyon Planı"nın
  // KENDİSİNİN kullandığı fonksiyon) çıktısındaki impactScore'u (0-10) 0-100
  // ölçeğe taşıyarak döndürür; bu sayede ürün seçimi hem "bu eczane tarihsel
  // olarak ne alır" hem de "hedefe göre ne satılması gerekiyor"u birlikte
  // dikkate alır.
  function _buildProductGapWeight(ttt) {
    var weight = {};
    try {
      var impact = (typeof analyzeProductImpact === 'function') ? (analyzeProductImpact(ttt) || []) : [];
      impact.forEach(function (row) {
        // impactScore 0-10 → 0-100
        weight[row.product] = Math.round((row.impactScore || 0) * 10);
      });
    } catch (_e) {}
    return weight;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 6.5: Recommendation Memory — Görünmez Hafıza Katmanı
  // ══════════════════════════════════════════════════════════════════════
  //
  //  Her "Bugünkü Ziyaret" (visit) öğesi, kullanıcıya gösterilmeden HEMEN
  //  ÖNCE saveRecommendation() ile pharma_recommendation_memory_v1'e
  //  kaydedilir (window.RecommendationMemory köprüsü üzerinden).
  //
  //  • UI davranışı DEĞİŞMEZ — bu sadece arka planda çalışan bir kayıt katmanı.
  //  • Duplicate kontrolü recommendation-memory.js içinde yapılır:
  //    representative + action + brick + pharmacy + gün aynıysa
  //    yeni kayıt oluşturulmaz.
  //  • window.RecommendationMemory mevcut değilse (örn. modül script
  //    yüklenmemiş/engellenmiş) sessizce atlanır — generateDailyPlan
  //    asla bu yüzden hata vermez.

  function _riskLevelFromTlPct(tlPct) {
    if (tlPct >= 100) return 'DÜŞÜK';
    if (tlPct >= 91)  return 'ORTA';
    return 'YÜKSEK';
  }

  function _persistVisitRecommendations(ttt, mission, gt) {
    try {
      var RM = window.RecommendationMemory;
      if (!RM || typeof RM.saveRecommendation !== 'function') return;
      if (!mission || !mission.visits || !mission.visits.length) return;

      var tlPct   = gt ? (gt.tl_pct   || 0) : 0;
      var primPct = gt ? (gt.prim_pct || 0) : 0;
      var period  = _getCurrentPeriod();
      var periodKey = period ? period.key : mission.period;

      mission.visits.forEach(function (v) {
        var topProduct = (v.products && v.products[0]) ? v.products[0].urun : null;

        RM.saveRecommendation({
          representative: ttt,
          period:         periodKey,
          recommendation: {
            action:           'ZİYARET',
            product:          topProduct || null,
            brick:            v.brick || null,
            pharmacy:         v.eczane || null,
            expectedImpactTL: v.expectedTL || 0,
            confidence:       Math.round(v.score || 0) / 100
          },
          contextSnapshot: {
            tlPct:         tlPct,
            primPct:       primPct,
            remainingDays: mission.remainingDays || 0,
            riskLevel:     _riskLevelFromTlPct(tlPct)
          }
        });
      });
    } catch (_e) {
      console.warn('[APE] _persistVisitRecommendations hata:', _e.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 7: generateDailyPlan
  // ══════════════════════════════════════════════════════════════════════

  function generateDailyPlan(ttt) {
    if (!ttt) return null;

    var gt      = _getGT(ttt);
    var period  = _getCurrentPeriod();
    var today   = _today();

    // Çekirdek metrikler
    var kalanTL      = gt ? Math.max(0, gt.kalan_tl || 0) : 0;
    var remaining    = period ? _workDays(today, period.end) : 17;
    var dailyNeed    = remaining > 0 ? kalanTL / remaining : 0;

    // Pharmacy profilleri
    var profiles = _getProfiles(ttt);
    var top30    = profiles
      .map(function (p) {
        p._visitScore = _calcVisitScore(p);
        return p;
      })
      .sort(function (a, b) { return b._visitScore - a._visitScore; })
      .slice(0, 30);

    // Bugünkü rota (route-optimizer'dan)
    var todayVisits = [];
    try {
      if (typeof buildTodayRoute === 'function') {
        var tr = buildTodayRoute(ttt);
        todayVisits = (tr && tr.pharmacies) ? tr.pharmacies : [];
      }
    } catch (_e) {}

    // Fallback: Top30'dan brick bazlı günlük seçim
    if (!todayVisits.length && top30.length) {
      // BUG DÜZELTMESİ: hafta sonu (Cmt/Paz) her ikisi de Pazartesi'nin
      // brick'ine işaret etmeli — eskiden Pazar günü yanlışlıkla Cuma'nın
      // brick'ini seçiyordu ((0-1+5)%5=4).
      var dow = new Date().getDay(); // 0=Paz 1=Pzt ... 6=Cmt
      var isWeekendFallback = (dow === 0 || dow === 6);
      var brickGroups = {};
      top30.forEach(function (p) {
        var b = p.brick || 'DİĞER';
        if (!brickGroups[b]) brickGroups[b] = [];
        brickGroups[b].push(p);
      });
      var brickList = Object.keys(brickGroups);
      var idx = isWeekendFallback ? 0 : (dow - 1 + 5) % 5; // 0-4 arası, hafta sonu → Pazartesi
      var todayBrick = brickList[idx % brickList.length];
      todayVisits = todayBrick ? (brickGroups[todayBrick] || []).slice(0, 8) : top30.slice(0, 8);
    }

    // BUG DÜZELTMESİ: buildTodayRoute() (route-optimizer.js) çıktısındaki
    // eczane objeleri productAffinityScore TAŞIMIYOR (rank/eczane/brick/
    // priority/visitScore/expectedOrderBoxes vb. daha dar bir şekil).
    // Bu yüzden `p.productAffinityScore` her zaman undefined kalıyor,
    // `affinity` her zaman {} oluyor ve ürün önerisi listesi ("BUGÜNÜN
    // GÖREVİ" ve "Bugün Sat" kartı) HER ZAMAN BOŞ görünüyordu — buildTodayRoute
    // normal koşulda hep bir sonuç döndürdüğü için brickGroups fallback'i de
    // devreye girmiyordu. Tam profili (buildPharmacyProfiles çıktısı,
    // productAffinityScore + visitPriorityScore + consecutiveGrowthMonths vb.
    // içerir) eczane/gln ile eşleştirip oradan okuyoruz; toplam kutu/TL için
    // de zaten doğru hesaplanmış expectedOrderBoxes/expectedOrderValue
    // kullanılıyor (affinity skorunu kutu sayısı yerine dağıtım ağırlığı
    // olarak kullanıyoruz).
    var profileByKey = {};
    profiles.forEach(function (pr) {
      var k = (pr.gln || pr.eczane || '').toString();
      if (k) profileByKey[k] = pr;
    });

    // BUG DÜZELTMESİ (kullanıcı bulgusu): hedef açığı ağırlığı — bkz.
    // _buildProductGapWeight tanımındaki not.
    var gapWeight = _buildProductGapWeight(ttt);

    var visits = todayVisits.slice(0, 10).map(function (p) {
      var key         = (p.gln || p.eczane || '').toString();
      var fullProfile = profileByKey[key] || p;
      var affinity    = fullProfile.productAffinityScore || {};
      var totalBoxes  = p.expectedOrderBoxes || fullProfile.expectedOrderBoxes || 0;
      var totalTL     = p.expectedOrderValue || fullProfile.expectedOrderValue || 0;

      // combinedScore: eczanenin geçmiş afinitesi (%60) + ürünün hedef
      // açığındaki payı/kaldıraç gücü (%40). Sadece afiniteye göre sıralarsak
      // her gün hep aynı 1-2 ürün (en çok satılanlar) öne çıkıyor; sadece
      // hedef açığına göre sıralarsak da eczanenin hiç almadığı bir ürünü
      // zorla önermiş oluruz — ikisinin karışımı daha dengeli.
      var combinedScore = {};
      PRODUCTS.forEach(function (u) {
        combinedScore[u] = (affinity[u] || 0) * 0.6 + (gapWeight[u] || 0) * 0.4;
      });

      var topProducts = PRODUCTS
        .filter(function (u) { return combinedScore[u] > 0; })
        .sort(function (a, b) { return combinedScore[b] - combinedScore[a]; })
        .slice(0, 3); // BUG DÜZELTMESİ: 2 → 3, diğer ürünlere de yer açmak için

      // BUG DÜZELTMESİ: pay (share) artık combinedScore toplamına göre
      // hesaplanıyor (eskiden sadece affinitySum'a göreydi). Sadece afiniteye
      // göre hesaplansaydı, gap ağırlığıyla listeye giren düşük-afiniteli
      // ürünler için share=0 çıkar, bu da o ürünün "0 TL / 0 kutu" gibi
      // anlamsız görünmesine yol açardı.
      var scoreSum = topProducts.reduce(function (s, u) { return s + (combinedScore[u] || 0); }, 0);

      // BUG DÜZELTMESİ (kullanıcı bulgusu — KAAN ASLAN GİRESUN MERKEZ-2 örneği):
      // rawBoxes = totalBoxes × share formülü, totalBoxes'ı (expectedOrderBoxes)
      // TEMSİLCİNİN/ziyaret planının ürettiği bir rakamdan alıyordu — eczanenin
      // KENDİ geçmişiyle sınırlı değildi. Sonuç: 1 aylık, sadece 42 kutu PANOCER
      // almış "Yeni Müşteri" bir eczaneye 165+135 (kampanya basamağı) kutu PANOCER
      // önerilebiliyordu — eczanenin şimdiye kadar hiç ulaşmadığı bir hacim.
      // Düzeltme: rawBoxes, eczanenin KENDİ tarihsel tavanının (historicalMaxBoxes)
      // ya da aylık ortalamasının (avgMonthlyBoxes) 1.5 katını asla aşamaz. Bu
      // eczane-özel bir tavan olduğundan gerçekten büyüyen/talep eden eczanelerde
      // hiçbir kısıtlama yaratmaz — sadece rep-hedefinden sızan aşırı büyütmeyi keser.
      var _histCap = Math.max(fullProfile.historicalMaxBoxes || 0, fullProfile.avgMonthlyBoxes || 0) * 1.5;

      var products = topProducts.map(function (u) {
        var share = scoreSum > 0 ? (combinedScore[u] / scoreSum) : (1 / topProducts.length);
        var price = (typeof IMS_TL_MAP !== 'undefined' && IMS_TL_MAP[u]) ? IMS_TL_MAP[u] : 100;
        var rawBoxes = totalBoxes > 0 ? Math.max(1, Math.round(totalBoxes * share)) : Math.max(1, Math.round(affinity[u] || 5));
        if (_histCap > 0) rawBoxes = Math.min(rawBoxes, Math.max(1, Math.round(_histCap)));

        // BUG DÜZELTMESİ (kullanıcı bulgusu): eczaneler kutu sayısını
        // rastgele/ham bir sayıyla değil, satış şartı (MF — mal fazlası)
        // basamaklarına göre verir (örn. ACİDPASS için 10+1, 20+3, 50+15).
        // Sistem "23 kutu ACİDPASS" gibi ham bir sayı önerince, saha
        // ekibi bunu 20+3 (20 sipariş + 3 bonus = 23 toplam) yerine
        // literal 23 birim sipariş gibi yorumlayabiliyordu. sales-conditions.js
        // içinde bu mantığı ZATEN doğru şekilde uygulayan getSiparisOnerisi()
        // vardı ama bu görev planı hiç çağırmıyordu — artık çağırıyor.
        var oneri = (typeof getSiparisOnerisi === 'function') ? getSiparisOnerisi(u, rawBoxes) : null;
        var boxes       = oneri ? oneri.miktar : rawBoxes;      // fiilen SİPARİŞ edilecek (ödenen) kutu
        var bonusBoxes  = oneri ? oneri.bonusKutu : 0;          // MF ile gelen bedava kutu
        var totalWithMF = oneri ? oneri.toplam : rawBoxes;      // eczanenin fiilen alacağı toplam
        var sart        = oneri && oneri.sart ? oneri.sart : null; // örn. "20+3"
        // BUG DÜZELTMESİ: sales-conditions.js artık küçük hedeflerde büyük
        // kampanya basamağını zorlamıyor, bunun yerine erken:true ile
        // düşük güvenli bir tahmin döndürüyor — bunu UI'ya taşıyoruz ki
        // saha ekibi bunun bir "satış şartı" değil, tahmini bir hatırlatma
        // olduğunu görebilsin.
        var erken       = !!(oneri && oneri.erken);

        var tl = totalTL > 0 ? Math.round(totalTL * share) : boxes * price;
        return { urun: u, boxes: boxes, bonusBoxes: bonusBoxes, totalWithMF: totalWithMF, sart: sart, erken: erken, tl: tl };
      });

      // Ürün afinitesi hiç yoksa ama toplam beklenen kutu/TL varsa yine de
      // jenerik tek satır göster — boş kart yerine. (Aynı MF şart mantığı
      // burada da uygulanır.)
      if (!products.length && totalBoxes > 0) {
        var _fbOneri = (typeof getSiparisOnerisi === 'function') ? getSiparisOnerisi(PRODUCTS[0], totalBoxes) : null;
        products.push({
          urun: PRODUCTS[0],
          boxes: _fbOneri ? _fbOneri.miktar : totalBoxes,
          bonusBoxes: _fbOneri ? _fbOneri.bonusKutu : 0,
          totalWithMF: _fbOneri ? _fbOneri.toplam : totalBoxes,
          sart: _fbOneri && _fbOneri.sart ? _fbOneri.sart : null,
          erken: !!(_fbOneri && _fbOneri.erken),
          tl: totalTL
        });
      }

      var expectedTL = totalTL || products.reduce(function (s, x) { return s + x.tl; }, 0);

      return {
        eczane:   p.eczane,
        brick:    p.brick || '',
        score:    Math.round(p.visitScore || p._visitScore || fullProfile.visitPriorityScore || 0),
        products: products,
        why:      _explainVisit(fullProfile),
        expectedTL: expectedTL,
        // BUG DÜZELTMESİ: _fillMissingProducts()'ın "yeni müşteri"ye zorla ürün
        // eklemesini engellemek için — bkz. aşağıdaki tanım.
        _behaviorType:  fullProfile.behaviorType  || null,
        _activeMonths:  fullProfile.activeMonths  || 0
      };
    });

    // BUG DÜZELTMESİ (kullanıcı bulgusu): topProducts.slice(0,3) her ziyarette
    // ayrı ayrı en iyi 3'ü seçtiği için, teorik olarak yine de bazı ürünler
    // günün TÜMÜNDE hiç görünmeyebilir (örn. o gün ziyaret edilen eczanelerin
    // hiçbirinde o ürünün ne afinitesi ne de yüksek gap ağırlığı yeterliyse).
    // "Haftalık Aksiyon Planı" 5 ürünün de hedefe göre satılması gerektiğini
    // söylüyorsa, günlük görev listesinde en azından hatırlatma amaçlı bir kez
    // geçmesi gerekir. Bu yüzden gün sonunda kapsanmayan ürünleri, hedef açığı
    // önceliğine (gapWeight) göre sırayla en uygun ziyarete ekliyoruz.
    (function _fillMissingProducts() {
      var covered = {};
      visits.forEach(function (v) {
        (v.products || []).forEach(function (x) { covered[x.urun] = true; });
      });
      var missing = PRODUCTS
        .filter(function (u) { return !covered[u]; })
        .sort(function (a, b) { return (gapWeight[b] || 0) - (gapWeight[a] || 0); });
      if (!missing.length || !visits.length) return;

      // BUG DÜZELTMESİ (kullanıcı bulgusu): bu eklenti eczanenin HİÇ almadığı
      // bir ürünü sabit "5 kutu" ile öneriyordu — eczane 1 aylık "Yeni Müşteri"
      // olsa bile ("KAAN ASLAN" örneği: sadece PANOCER+ACİDPASS almış, hiç
      // GRİPORT COLD/FAMTREC almamış). Yeni müşteri veya çok az geçmişi olan
      // (activeMonths < 3) eczanelere bu "hedef açığı hatırlatması" hiç
      // uygulanmaz — onlar için henüz hiçbir ürün için gerçek bir tercih
      // sinyali yok, tahmin yerine sessizce atlanır.
      var _fillEligible = visits.filter(function (v) {
        return v._behaviorType !== 'YENI_MUSTERI' && (v._activeMonths || 0) >= 3;
      });
      if (!_fillEligible.length) return;

      missing.forEach(function (u) {
        // En az ürünü olan (henüz kalabalıklaşmamış) uygun ziyareti seç.
        var target = _fillEligible.slice().sort(function (a, b) {
          return (a.products || []).length - (b.products || []).length;
        })[0];
        if (!target || target.products.length >= 4) return; // ziyaret başına makul üst sınır

        var price = (typeof IMS_TL_MAP !== 'undefined' && IMS_TL_MAP[u]) ? IMS_TL_MAP[u] : 100;
        var rawBoxes = 5; // afinite/hacim verisi yok — hedef açığı hatırlatması amaçlı minimum öneri
        var oneri = (typeof getSiparisOnerisi === 'function') ? getSiparisOnerisi(u, rawBoxes) : null;
        var boxes = oneri ? oneri.miktar : rawBoxes;
        var tl    = boxes * price;

        target.products.push({
          urun:        u,
          boxes:       boxes,
          bonusBoxes:  oneri ? oneri.bonusKutu : 0,
          totalWithMF: oneri ? oneri.toplam : rawBoxes,
          sart:        oneri && oneri.sart ? oneri.sart : null,
          erken:       !!(oneri && oneri.erken),
          tl:          tl,
          gapDriven:   true // hedef açığı nedeniyle eklendi (afiniteye dayanmıyor)
        });
        target.expectedTL += tl;
      });
    })();

    var expectedTL  = visits.reduce(function (s, v) { return s + v.expectedTL; }, 0);
    var successProb = _calcSuccessProbability(ttt, dailyNeed, expectedTL);
    var probMeta    = _probLabel(successProb);
    var warnings    = _buildWarnings(ttt, profiles);
    var opps        = _buildOpportunities(ttt, profiles);
    var primItems   = _buildPrimMaxItems(ttt);

    var mission = {
      date:              today,
      dateLabel:         _todayLabel(),
      ttt:               ttt,
      targetTL:          Math.round(dailyNeed),
      expectedTL:        Math.round(expectedTL),
      successProbability:successProb,
      probLabel:         probMeta.text,
      probColor:         probMeta.color,
      probIcon:          probMeta.icon,
      visits:            visits,
      warnings:          warnings,
      opportunities:     opps,
      primItems:         primItems,
      kalanGap:          kalanTL,
      remainingDays:     remaining,
      period:            period ? period.label : '—',
      generatedAt:       new Date().toISOString()
    };

    window.dailyMission = mission;

    // ── Görünmez hafıza katmanı: kullanıcıya gösterilmeden hemen önce kaydet ──
    _persistVisitRecommendations(ttt, mission, gt);

    _savePlan(STORE_DAILY, mission);
    return mission;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 8: generateWeeklyPlan
  // ══════════════════════════════════════════════════════════════════════

  function generateWeeklyPlan(ttt) {
    if (!ttt) return null;

    var days = [];
    try {
      if (typeof buildWeeklyRoutes === 'function') {
        var wr = buildWeeklyRoutes(ttt) || [];
        days = wr.map(function (d, i) {
          return {
            dayLabel:  d.dayName || DAY_TR[i + 1] || 'Gün ' + (i + 1),
            date:      d.date || '',
            brick:     d.brick || (d.pharmacies && d.pharmacies[0] && d.pharmacies[0].brick) || '',
            count:     (d.pharmacies || []).length,
            pharmacies:(d.pharmacies || []).slice(0, 8).map(function (p) { return p.eczane; }),
            expectedTL:d.totalExpectedTL || 0
          };
        });
      }
    } catch (_e) {}

    // Fallback: visit-planner'dan
    if (!days.length) {
      try {
        if (typeof buildVisitPlan === 'function') {
          var vp = buildVisitPlan(ttt);
          var dayKeys = ['monday','tuesday','wednesday','thursday','friday'];
          var dayNames = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma'];
          dayKeys.forEach(function (k, i) {
            var arr = vp[k] || [];
            days.push({
              dayLabel:   dayNames[i],
              brick:      arr[0] && arr[0].brick ? arr[0].brick : '—',
              count:      arr.length,
              pharmacies: arr.slice(0, 6).map(function (p) { return p.eczane || p.brick || '—'; }),
              expectedTL: 0
            });
          });
        }
      } catch (_e2) {}
    }

    var mission = {
      ttt:        ttt,
      days:       days,
      totalVisits:days.reduce(function (s, d) { return s + d.count; }, 0),
      generatedAt:new Date().toISOString()
    };

    window.weeklyMission = mission;
    _savePlan(STORE_WEEKLY, mission);
    return mission;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 9: generateMonthlySprint
  // ══════════════════════════════════════════════════════════════════════

  function generateMonthlySprint(ttt) {
    if (!ttt) return null;

    var gt     = _getGT(ttt);
    var period = _getCurrentPeriod();
    var gapClosure = optimizeGapClosure(ttt);

    var sprint = {
      ttt:          ttt,
      period:       period ? period.label : '—',
      kalanGap:     gapClosure.kalanGap || 0,
      remainingDays:gapClosure.remainingDays || 0,
      dailyNeed:    gapClosure.dailyNeed || 0,
      strategy:     gapClosure.strategy || '',
      topPharmacies:gapClosure.topPharmacies || [],
      productFocus: gapClosure.productImpact || [],
      generatedAt:  new Date().toISOString()
    };

    window.monthlyMission = sprint;
    return sprint;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 10: generateActionCards
  // ══════════════════════════════════════════════════════════════════════

  function generateActionCards(ttt) {
    var daily  = window.dailyMission  || generateDailyPlan(ttt);
    var weekly = window.weeklyMission || generateWeeklyPlan(ttt);
    var gap    = optimizeGapClosure(ttt);

    return {
      goToday: {
        icon:  '🗺️',
        title: 'Bugün Git',
        count: (daily && daily.visits) ? daily.visits.length : 0,
        items: (daily && daily.visits || []).map(function (v) {
          return v.eczane + (v.brick ? ' (' + v.brick + ')' : '');
        }).slice(0, 8)
      },
      sellToday: {
        icon:  '💊',
        title: 'Bugün Sat',
        // BUG DÜZELTMESİ (kullanıcı bulgusu): eski slice(0,8), ziyaret başına
        // artık 3-4 ürün olabildiğinden (bkz. topProducts.slice(0,3) ve
        // _fillMissingProducts) listenin daha ilk 2-3 eczanesinde dolup
        // taşıyor, hedef açığı için eklenen ürünler hiç görünmüyordu.
        items: (daily && daily.visits || []).flatMap
          ? (daily.visits || []).flatMap(function (v) {
              return (v.products || []).map(function (p) {
                var kutuTxt = p.sart ? (p.sart + ' kutu (toplam ' + p.totalWithMF + ')') : (p.boxes + ' kutu');
                var etiket = (p.erken ? ' (tahmini — erken)' : '') + (p.gapDriven ? ' (hedef açığı)' : '');
                return v.eczane + ' → ' + p.urun + ' ' + kutuTxt + etiket;
              });
            }).slice(0, 15)
          : []
      },
      primActions: {
        icon:  '💰',
        title: 'Prim İçin Yap',
        items: (daily && daily.primItems || []).map(function (x) {
          return x.urun + ' +' + x.boxes + ' kutu → prim etkisi ' + _fTL(x.primEtki);
        })
      },
      risks: {
        icon:  '⚠️',
        title: 'Riskler',
        items: (daily && daily.warnings || []).map(function (w) {
          return w.icon + ' ' + w.message;
        })
      },
      opportunities: {
        icon:  '🚀',
        title: 'Fırsatlar',
        items: (daily && daily.opportunities || []).map(function (o) {
          return o.icon + ' ' + o.eczane + ' — ' + o.reason;
        })
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 11: Senaryo Simülasyonu
  // ══════════════════════════════════════════════════════════════════════

  function simulateScenario(ttt, urun, extraBoxes) {
    var result = {
      urun:       urun,
      extraBoxes: extraBoxes,
      extraTL:    0,
      newReal:    0,
      newPrim:    0,
      newGap:     0,
      newProb:    0
    };

    try {
      var price  = (typeof IMS_TL_MAP !== 'undefined' && IMS_TL_MAP[urun]) ? IMS_TL_MAP[urun] : 100;
      var extraTL = extraBoxes * price;
      result.extraTL = extraTL;

      var gt = _getGT(ttt);
      if (!gt) return result;

      var newGercek = (gt.satis_tl || 0) + extraTL;
      var newReal   = gt.hedef_tl > 0 ? (newGercek / gt.hedef_tl) * 100 : 0;
      result.newReal = Math.round(newReal * 10) / 10;
      result.newGap  = Math.max(0, (gt.kalan_tl || 0) - extraTL);

      // Prim simülasyonu
      if (typeof simulatePrim === 'function') {
        var primList = simulatePrim(ttt, [Math.round(newReal)]);
        result.newPrim = primList && primList[0] ? primList[0].totalPrim : 0;
      }

      // Yeni başarı ihtimali
      var period    = _getCurrentPeriod();
      var today     = _today();
      var remaining = period ? _workDays(today, period.end) : 1;
      result.newProb = _calcSuccessProbability(ttt, result.newGap / Math.max(1, remaining), 0);

    } catch (_e) {
      console.warn('[APE] simulateScenario hata:', _e.message);
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 12: Executive Mode
  // ══════════════════════════════════════════════════════════════════════

  function getExecutiveSummary(tttList) {
    var rows = (typeof GENEL !== 'undefined') ? GENEL : [];
    return (tttList || []).map(function (ttt) {
      var gt = rows.find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      var hasPlan = !!_loadPlan(STORE_DAILY);
      return {
        ttt:        ttt,
        realPct:    gt ? (gt.tl_pct || 0) : 0,
        kalanGap:   gt ? Math.max(0, gt.kalan_tl || 0) : 0,
        hasPlan:    hasPlan,
        planStatus: hasPlan ? 'Uyguladı' : 'Uygulamadı'
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 13: Persistence
  // ══════════════════════════════════════════════════════════════════════

  function _savePlan(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (_e) { console.warn('[APE] save hata:', _e.message); }
  }

  function _loadPlan(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) { return null; }
  }

  function loadSavedDailyPlan() {
    return _loadPlan(STORE_DAILY);
  }

  function loadSavedWeeklyPlan() {
    return _loadPlan(STORE_WEEKLY);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 14: UI Render — renderAutonomousDashboard
  // ══════════════════════════════════════════════════════════════════════

  function renderAutonomousDashboard(containerId, ttt) {
    var el = document.getElementById(containerId);
    if (!el || !ttt) return;

    el.innerHTML = '<div class="ape-loading"><i class="fas fa-spinner fa-spin"></i> AI Saha Planı hazırlanıyor...</div>';

    // Async-safe: setTimeout ile UI'yi bloklamadan hesapla
    setTimeout(function () {
      try {
        var daily  = generateDailyPlan(ttt);
        var weekly = generateWeeklyPlan(ttt);
        var cards  = generateActionCards(ttt);
        var gap    = optimizeGapClosure(ttt);

        if (!daily) {
          el.innerHTML = '<div class="ape-error">Veri yüklenmedi. Lütfen CSV dosyalarını yükleyin.</div>';
          return;
        }

        el.innerHTML = _renderHTML(daily, weekly, cards, gap, ttt);

        // Senaryo formu event listener
        var simBtn = document.getElementById('ape-sim-btn');
        if (simBtn) {
          simBtn.addEventListener('click', function () {
            var urun   = document.getElementById('ape-sim-urun').value;
            var boxes  = parseInt(document.getElementById('ape-sim-boxes').value || '0', 10);
            var result = simulateScenario(ttt, urun, boxes);
            document.getElementById('ape-sim-result').innerHTML = _renderSimResult(result);
          });
        }

        var refreshBtn = document.getElementById('ape-refresh-btn');
        if (refreshBtn) {
          refreshBtn.addEventListener('click', function () {
            renderAutonomousDashboard(containerId, ttt);
          });
        }
      } catch (err) {
        el.innerHTML = '<div class="ape-error">Hata: ' + (err.message || 'Bilinmeyen hata') + '</div>';
        console.error('[APE] render hata:', err);
      }
    }, 50);
  }

  // ── HTML Oluşturucular ── "AI Satış Koçu" görsel yapısı ile hizalı ─────
  //  (ai-sales-coach-v2.js ile aynı .card / .card-hd / .card-badge sistemi
  //   ve yazı üslubu kullanılır — ayrı bir .ape-* stil sayfası YOK)

  function _gauge(val, label, color) {
    var v = Math.max(0, Math.min(100, val || 0));
    return '<div style="flex:1;text-align:center;padding:8px 4px">' +
      '<div style="font-size:18px;font-weight:900;color:' + color + '">' + Math.round(val || 0) + '</div>' +
      '<div style="font-size:8px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">' + label + '</div>' +
      '<div style="height:4px;background:#E2E8F0;border-radius:2px;margin-top:4px">' +
        '<div style="height:100%;width:' + v + '%;background:' + color + ';border-radius:2px"></div>' +
      '</div>' +
    '</div>';
  }

  function _miniCard(card) {
    if (!card) return '';
    var rows = (card.items || []).slice(0, 4).map(function (it) {
      return '<div style="font-size:9px;color:var(--text);padding:3px 0;border-bottom:1px solid var(--border);line-height:1.4">' + it + '</div>';
    }).join('');
    return '<div style="background:var(--surf2);border-radius:8px;padding:8px 10px">' +
      '<div style="font-size:9px;font-weight:700;color:var(--c1);margin-bottom:5px;text-transform:uppercase;letter-spacing:1px">' +
        card.icon + ' ' + card.title +
      '</div>' +
      (rows || '<div style="font-size:9px;color:var(--dim)">Veri yok</div>') +
    '</div>';
  }

  function _renderHTML(daily, weekly, cards, gap, ttt) {
    var prob        = daily.successProbability;
    var probMeta    = _probLabel(prob);
    var progressPct = daily.targetTL > 0 ? Math.min(100, Math.round(daily.expectedTL / daily.targetTL * 100)) : 0;
    var visitLoad   = Math.min(100, daily.visits.length * 10);

    var visitRows = daily.visits.length ? daily.visits.map(function (v, i) {
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:13px;font-weight:800;color:var(--c1);min-width:18px">' + (i + 1) + '.</span>' +
        '<div style="flex:1">' +
          '<div style="font-size:11px;font-weight:700">' + v.eczane +
            ' <span style="font-size:9px;background:rgba(167,139,250,.15);color:#a78bfa;border-radius:4px;padding:1px 6px;margin-left:4px">' + (v.brick || '') + '</span>' +
          '</div>' +
          v.products.map(function (p) {
            // BUG DÜZELTMESİ (kullanıcı bulgusu): p.erken===true demek,
            // sales-conditions.js bu hedef için bir MF basamağını ZORLAMADI —
            // orantılı, düşük güvenli bir tahmin döndürdü (bkz. getSiparisOnerisi).
            // Bunu turuncu/kesin "MF" rozetiyle karıştırmamak için ayrı,
            // soluk/kesikli bir "tahmini" rozeti kullanıyoruz.
            var kutuTxt;
            if (p.sart) {
              kutuTxt = p.sart + ' kutu <span style="font-size:9px;font-weight:700;color:#D97706;background:#FEF3C7;border-radius:4px;padding:1px 5px">MF +' + p.bonusBoxes + '</span> (toplam ' + p.totalWithMF + ')';
            } else if (p.erken) {
              kutuTxt = p.boxes + ' kutu <span style="font-size:9px;font-weight:700;color:#6B7280;background:transparent;border:1px dashed #9CA3AF;border-radius:4px;padding:0px 5px">tahmini</span>';
            } else {
              kutuTxt = p.boxes + ' kutu';
            }
            return '<div style="font-size:9px;color:var(--dim);padding:1px 0">→ ' + p.urun + ' <b style="color:var(--text)">' + kutuTxt + '</b></div>';
          }).join('') +
          '<div style="font-size:9px;color:var(--text);margin-top:1px">' + v.why.join(' · ') + '</div>' +
        '</div>' +
        '<div style="font-weight:800;font-size:11px;color:#15803D;white-space:nowrap">' + _fTL(v.expectedTL) + '</div>' +
      '</div>';
    }).join('') : '<div style="font-size:11px;color:var(--dim);padding:8px 0">⏳ Ziyaret listesi hazırlanıyor…</div>';

    var weeklyBlock = (weekly && weekly.days && weekly.days.length) ? (
      '<div class="card">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-title">🗓️ Haftalık Rota Planı</span>' +
          '<span class="card-badge">' + weekly.days.reduce(function (s, d) { return s + d.count; }, 0) + ' eczane</span>' +
        '</div>' +
        '<div class="card-body-0" style="padding:12px 16px">' +
          '<div style="display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px">' +
            weekly.days.map(function (d) {
              return '<div style="flex:1;min-width:120px;background:var(--surf2);border-radius:10px;padding:12px;border:1px solid var(--border);text-align:center">' +
                '<div style="font-size:12px;font-weight:700;color:var(--c2);margin-bottom:6px">' + d.dayLabel + '</div>' +
                '<div style="font-size:11px;color:var(--text);margin-bottom:4px">' + (d.brick || '—') + '</div>' +
                '<div style="font-size:11px;color:var(--dim)">' + d.count + ' eczane</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>'
    ) : '';

    return [

      // ══ AI Saha Koçu — Günlük Görev Planı ═══════════════════════════
      '<div class="card">',
      '  <div class="card-hd" style="flex-wrap:wrap;gap:6px">',
      '    <span class="card-title">🧭 AI Saha Koçu — Günlük Görev Planı</span>',
      '    <span class="card-badge" style="background:' + probMeta.color + '22;color:' + probMeta.color + ';font-weight:800">' + probMeta.icon + ' %' + prob + ' ' + probMeta.text + '</span>',
      '    <span class="card-badge" style="background:#EFF6FF;color:#1D4ED8">' + daily.dateLabel + '</span>',
      '    <span class="card-badge" style="background:#FEF3C7;color:#D97706">' + ttt + ' · ' + daily.period + ' · ' + daily.remainingDays + ' iş günü kaldı</span>',
      '  </div>',
      '  <div class="card-body-0" style="padding:12px 16px">',

      '    <div style="display:flex;gap:4px;background:var(--surf2);border-radius:10px;margin-bottom:12px">',
             _gauge(prob, 'Başarı %', probMeta.color),
      '      <div style="width:1px;background:var(--border);margin:8px 0"></div>',
             _gauge(progressPct, 'Hedefe İlerleme', '#0891B2'),
      '      <div style="width:1px;background:var(--border);margin:8px 0"></div>',
             _gauge(visitLoad, 'Ziyaret Yükü', '#4F008C'),
      '    </div>',

      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">',
      '      <div style="background:var(--surf2);border-radius:8px;padding:8px 10px">',
      '        <div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Günlük Hedef</div>',
      '        <div style="font-size:13px;font-weight:800;color:var(--text)">' + _fTL(daily.targetTL) + '</div>',
      '      </div>',
      '      <div style="background:var(--surf2);border-radius:8px;padding:8px 10px">',
      '        <div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Beklenen Katkı</div>',
      '        <div style="font-size:13px;font-weight:800;color:#15803D">' + _fTL(daily.expectedTL) + '</div>',
      '      </div>',
      '      <div style="background:var(--surf2);border-radius:8px;padding:8px 10px">',
      '        <div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Kalan Gap</div>',
      '        <div style="font-size:13px;font-weight:800;color:#D97706">' + _fTL(daily.kalanGap) + '</div>',
      '      </div>',
      '      <div style="background:var(--surf2);border-radius:8px;padding:8px 10px">',
      '        <div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Bugünkü Ziyaret</div>',
      '        <div style="font-size:13px;font-weight:800;color:var(--text)">' + daily.visits.length + ' eczane</div>',
      '      </div>',
      '    </div>',

      '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:14px">',
             _miniCard(cards.goToday),
             _miniCard(cards.sellToday),
             _miniCard(cards.primActions),
             _miniCard(cards.risks),
             _miniCard(cards.opportunities),
      '    </div>',

      '    <div style="font-size:9px;font-weight:700;color:var(--c1);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">📋 BUGÜN YAP — Ziyaret Planı</div>',
      visitRows,
      '    <div style="margin-top:8px;font-size:11px;color:var(--dim);text-align:right">Tahmini toplam katkı: <b style="color:var(--text)">' + _fTL(daily.expectedTL) + '</b></div>',

      '    <button id="ape-refresh-btn" class="btn-calc" style="margin-top:12px;font-size:10px;padding:7px 14px;border-radius:8px;width:100%">🔄 Planı Yenile</button>',

      '  </div>',
      '</div>',

      // ══ Haftalık Rota (varsa) ════════════════════════════════════════
      weeklyBlock,

      // ══ Gap Kapama Stratejisi ════════════════════════════════════════
      '<div class="card">',
      '  <div class="card-hd" style="flex-wrap:wrap;gap:6px">',
      '    <span class="card-title">🎯 Gap Kapama Stratejisi</span>',
      '    <span class="card-badge">' + (gap.remainingDays || 0) + ' iş günü kaldı</span>',
      '  </div>',
      '  <div class="card-body-0" style="padding:12px 16px">',
      '    <div style="font-size:12px;color:var(--text);margin-bottom:10px;line-height:1.5">' + (gap.strategy || '') + '</div>',
      '    <div style="display:flex;gap:8px;flex-wrap:wrap">',
      '      <div style="flex:1;min-width:130px;background:var(--surf2);border-radius:8px;padding:8px 10px">',
      '        <div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Kalan Gap</div>',
      '        <div style="font-size:13px;font-weight:800;color:#D97706">' + _fTL(gap.kalanGap) + '</div>',
      '      </div>',
      '      <div style="flex:1;min-width:130px;background:var(--surf2);border-radius:8px;padding:8px 10px">',
      '        <div style="font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Günlük İhtiyaç</div>',
      '        <div style="font-size:13px;font-weight:800;color:var(--text)">' + _fTL(gap.dailyNeed) + '</div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',

      // ══ Senaryo Simülatörü ═══════════════════════════════════════════
      '<div class="card">',
      '  <div class="card-hd">',
      '    <span class="card-title">🔮 Senaryo Simülatörü</span>',
      '  </div>',
      '  <div class="card-body-0" style="padding:12px 16px">',
      '    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">',
      '      <select id="ape-sim-urun" class="inp" style="flex:2;min-width:140px">',
             PRODUCTS.map(function (u) { return '<option value="' + u + '">' + u + '</option>'; }).join(''),
      '      </select>',
      '      <input id="ape-sim-boxes" type="number" class="inp" style="flex:1;min-width:100px" placeholder="Kutu sayısı" min="1" max="100" value="10">',
      '      <button id="ape-sim-btn" class="btn-calc" style="font-size:12px;padding:8px 18px">Hesapla</button>',
      '    </div>',
      '    <div id="ape-sim-result"></div>',
      '  </div>',
      '</div>',

    ].join('\n');
  }

  function _renderSimResult(r) {
    if (!r.extraTL) return '<div style="font-size:11px;color:var(--dim);padding:8px 0">Sonuç hesaplanamadı.</div>';
    return '<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:12px">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:var(--dim)"><span>Ek satış:</span><b style="color:var(--text)">' + _fTL(r.extraTL) + '</b></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:var(--dim)"><span>Yeni realizasyon:</span><b style="color:var(--text)">%' + r.newReal + '</b></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:var(--dim)"><span>Yeni gap:</span><b style="color:var(--text)">' + _fTL(r.newGap) + '</b></div>' +
      (r.newPrim ? '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:var(--dim)"><span>Yeni prim:</span><b style="color:var(--text)">' + _fTL(r.newPrim) + '</b></div>' : '') +
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;color:var(--dim)"><span>Başarı ihtimali:</span><b style="color:var(--text)">%' + r.newProb + '</b></div>' +
    '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 15: Public API
  // ══════════════════════════════════════════════════════════════════════

  window.generateDailyPlan           = generateDailyPlan;
  window.generateWeeklyPlan          = generateWeeklyPlan;
  window.generateMonthlySprint       = generateMonthlySprint;
  window.optimizeGapClosure          = optimizeGapClosure;
  window.generateActionCards         = generateActionCards;
  window.simulateScenario            = simulateScenario;
  window.renderAutonomousDashboard   = renderAutonomousDashboard;
  window.getExecutiveSummary         = getExecutiveSummary;
  window.loadSavedDailyPlan          = loadSavedDailyPlan;
  window.loadSavedWeeklyPlan         = loadSavedWeeklyPlan;

  console.log('[APE 5.7] Autonomous Planning Engine yüklendi ✓');

})();
