// ══════════════════════════════════════════════════════════════════════
//  js/ai/autonomous-planning-engine.js — PHASE 5.7
//  Autonomous Planning Engine — AI Saha Komutanı
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
    try {
      var imsData = (typeof MIGI_BRICK_TL_RAW !== 'undefined') ? MIGI_BRICK_TL_RAW : [];
      var tttBricks = imsData.filter(function (r) { return r.ttt === ttt; });
      tttBricks.forEach(function (r) {
        if ((r.mi || 100) < 85) {
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

    var visits = todayVisits.slice(0, 10).map(function (p) {
      var key         = (p.gln || p.eczane || '').toString();
      var fullProfile = profileByKey[key] || p;
      var affinity    = fullProfile.productAffinityScore || {};
      var totalBoxes  = p.expectedOrderBoxes || fullProfile.expectedOrderBoxes || 0;
      var totalTL     = p.expectedOrderValue || fullProfile.expectedOrderValue || 0;

      var topProducts = PRODUCTS
        .filter(function (u) { return (affinity[u] || 0) > 0; })
        .sort(function (a, b) { return (affinity[b] || 0) - (affinity[a] || 0); })
        .slice(0, 2);

      var affinitySum = topProducts.reduce(function (s, u) { return s + (affinity[u] || 0); }, 0);

      var products = topProducts.map(function (u) {
        var share = affinitySum > 0 ? (affinity[u] / affinitySum) : (1 / topProducts.length);
        var price = (typeof IMS_TL_MAP !== 'undefined' && IMS_TL_MAP[u]) ? IMS_TL_MAP[u] : 100;
        var boxes = totalBoxes > 0 ? Math.max(1, Math.round(totalBoxes * share)) : Math.max(1, Math.round(affinity[u] || 5));
        var tl    = totalTL > 0 ? Math.round(totalTL * share) : boxes * price;
        return { urun: u, boxes: boxes, tl: tl };
      });

      // Ürün afinitesi hiç yoksa ama toplam beklenen kutu/TL varsa yine de
      // jenerik tek satır göster — boş kart yerine.
      if (!products.length && totalBoxes > 0) {
        products.push({ urun: PRODUCTS[0], boxes: totalBoxes, tl: totalTL });
      }

      var expectedTL = totalTL || products.reduce(function (s, x) { return s + x.tl; }, 0);

      return {
        eczane:   p.eczane,
        brick:    p.brick || '',
        score:    Math.round(p.visitScore || p._visitScore || fullProfile.visitPriorityScore || 0),
        products: products,
        why:      _explainVisit(fullProfile),
        expectedTL: expectedTL
      };
    });

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
        items: (daily && daily.visits || []).flatMap
          ? (daily.visits || []).flatMap(function (v) {
              return (v.products || []).map(function (p) {
                return v.eczane + ' → ' + p.urun + ' ' + p.boxes + ' kutu';
              });
            }).slice(0, 8)
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
      } catch (err) {
        el.innerHTML = '<div class="ape-error">Hata: ' + (err.message || 'Bilinmeyen hata') + '</div>';
        console.error('[APE] render hata:', err);
      }
    }, 50);
  }

  // ── HTML Oluşturucular ─────────────────────────────────────────────────

  function _renderHTML(daily, weekly, cards, gap, ttt) {
    var prob      = daily.successProbability;
    var probMeta  = _probLabel(prob);

    return [
      // ── Hero ─────────────────────────────────────────────────────────
      '<div class="ape-hero">',
      '  <div class="ape-hero-left">',
      '    <div class="ape-hero-label">AI SAHA PLANI · ' + daily.dateLabel + '</div>',
      '    <div class="ape-hero-ttt">' + ttt + '</div>',
      '    <div class="ape-hero-period">' + daily.period + ' · ' + daily.remainingDays + ' iş günü kaldı</div>',
      '  </div>',
      '  <div class="ape-hero-right">',
      '    <div class="ape-prob-ring" style="--prob-color:' + probMeta.color + '">',
      '      <div class="ape-prob-val">%' + prob + '</div>',
      '      <div class="ape-prob-lbl">' + probMeta.text + '</div>',
      '    </div>',
      '  </div>',
      '</div>',

      // ── KPI Şeridi ────────────────────────────────────────────────────
      '<div class="ape-kpi-row">',
      '  <div class="ape-kpi"><div class="ape-kpi-val">' + _fTL(daily.targetTL) + '</div><div class="ape-kpi-lbl">Günlük Hedef</div></div>',
      '  <div class="ape-kpi"><div class="ape-kpi-val ape-kpi-green">' + _fTL(daily.expectedTL) + '</div><div class="ape-kpi-lbl">Beklenen Katkı</div></div>',
      '  <div class="ape-kpi"><div class="ape-kpi-val ape-kpi-warn">' + _fTL(daily.kalanGap) + '</div><div class="ape-kpi-lbl">Kalan Gap</div></div>',
      '  <div class="ape-kpi"><div class="ape-kpi-val">' + daily.visits.length + ' eczane</div><div class="ape-kpi-lbl">Bugünkü Ziyaret</div></div>',
      '</div>',

      // ── 5 Aksiyon Kartı ───────────────────────────────────────────────
      '<div class="ape-cards-row">',
      _renderCard(cards.goToday),
      _renderCard(cards.sellToday),
      _renderCard(cards.primActions),
      _renderCard(cards.risks),
      _renderCard(cards.opportunities),
      '</div>',

      // ── Günlük Ziyaret Listesi ────────────────────────────────────────
      '<div class="ape-section">',
      '  <div class="ape-section-title">📋 BUGÜNÜN GÖREVİ</div>',
      daily.visits.map(function (v, i) {
        return '<div class="ape-visit-item">' +
          '<div class="ape-visit-num">' + (i + 1) + '</div>' +
          '<div class="ape-visit-body">' +
            '<div class="ape-visit-name">' + v.eczane + ' <span class="ape-brick-badge">' + (v.brick || '') + '</span></div>' +
            v.products.map(function (p) {
              return '<div class="ape-visit-prod">→ ' + p.urun + ' <b>' + p.boxes + ' kutu</b></div>';
            }).join('') +
            '<div class="ape-visit-why">' + v.why.join(' · ') + '</div>' +
          '</div>' +
          '<div class="ape-visit-tl">' + _fTL(v.expectedTL) + '</div>' +
          '</div>';
      }).join(''),
      '  <div class="ape-visit-total">Tahmini toplam katkı: <b>' + _fTL(daily.expectedTL) + '</b></div>',
      '</div>',

      // ── Haftalık Rota ─────────────────────────────────────────────────
      (weekly && weekly.days && weekly.days.length) ? [
        '<div class="ape-section">',
        '  <div class="ape-section-title">🗓️ HAFTALIK ROTA</div>',
        '  <div class="ape-weekly-grid">',
        weekly.days.map(function (d) {
          return '<div class="ape-day-card">' +
            '<div class="ape-day-name">' + d.dayLabel + '</div>' +
            '<div class="ape-day-brick">' + (d.brick || '—') + '</div>' +
            '<div class="ape-day-count">' + d.count + ' eczane</div>' +
            '</div>';
        }).join(''),
        '  </div>',
        '</div>'
      ].join('') : '',

      // ── Gap Closure ───────────────────────────────────────────────────
      '<div class="ape-section">',
      '  <div class="ape-section-title">🎯 GAP KAPAMA STRATEJİSİ</div>',
      '  <div class="ape-gap-strategy">' + (gap.strategy || '') + '</div>',
      '  <div class="ape-gap-meta">',
      '    Kalan Gap: <b>' + _fTL(gap.kalanGap) + '</b> · ',
      '    ' + (gap.remainingDays || 0) + ' iş günü · ',
      '    Günlük ihtiyaç: <b>' + _fTL(gap.dailyNeed) + '</b>',
      '  </div>',
      '</div>',

      // ── Senaryo Simülatörü ────────────────────────────────────────────
      '<div class="ape-section">',
      '  <div class="ape-section-title">🔮 SENARYO SİMÜLATÖRÜ</div>',
      '  <div class="ape-sim-form">',
      '    <select id="ape-sim-urun" class="ape-sim-select">',
      PRODUCTS.map(function (u) { return '<option value="' + u + '">' + u + '</option>'; }).join(''),
      '    </select>',
      '    <input id="ape-sim-boxes" type="number" class="ape-sim-input" placeholder="Kutu sayısı" min="1" max="100" value="10">',
      '    <button id="ape-sim-btn" class="ape-sim-btn">Hesapla</button>',
      '  </div>',
      '  <div id="ape-sim-result"></div>',
      '</div>',

    ].join('\n');
  }

  function _renderCard(card) {
    return '<div class="ape-card">' +
      '<div class="ape-card-header"><span class="ape-card-icon">' + card.icon + '</span>' + card.title + '</div>' +
      '<ul class="ape-card-list">' +
      (card.items || []).map(function (it) {
        return '<li>' + it + '</li>';
      }).join('') +
      '</ul>' +
      '</div>';
  }

  function _renderSimResult(r) {
    if (!r.extraTL) return '<div class="ape-sim-empty">Sonuç hesaplanamadı.</div>';
    return '<div class="ape-sim-result-box">' +
      '<div class="ape-sim-row"><span>Ek satış:</span><b>' + _fTL(r.extraTL) + '</b></div>' +
      '<div class="ape-sim-row"><span>Yeni realizasyon:</span><b>%' + r.newReal + '</b></div>' +
      '<div class="ape-sim-row"><span>Yeni gap:</span><b>' + _fTL(r.newGap) + '</b></div>' +
      (r.newPrim ? '<div class="ape-sim-row"><span>Yeni prim:</span><b>' + _fTL(r.newPrim) + '</b></div>' : '') +
      '<div class="ape-sim-row"><span>Başarı ihtimali:</span><b>%' + r.newProb + '</b></div>' +
      '</div>';
  }

  // ── CSS Enjeksiyonu ────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('ape-styles')) return;
    var style = document.createElement('style');
    style.id = 'ape-styles';
    style.textContent = [
      '.ape-loading,.ape-error{padding:24px;text-align:center;color:var(--dim,#6B7280);font-size:14px}',
      '.ape-hero{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#4F008C,#7B2FBE);border-radius:12px;padding:20px 24px;margin-bottom:16px;color:#fff}',
      '.ape-hero-label{font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}',
      '.ape-hero-ttt{font-size:22px;font-weight:700;margin-bottom:2px}',
      '.ape-hero-period{font-size:13px;opacity:.9}',
      '.ape-prob-ring{text-align:center;background:rgba(255,255,255,.15);border-radius:50%;width:88px;height:88px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid var(--prob-color,#22c55e)}',
      '.ape-prob-val{font-size:22px;font-weight:800;line-height:1}',
      '.ape-prob-lbl{font-size:10px;opacity:.85;margin-top:3px}',
      '.ape-kpi-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}',
      '.ape-kpi{flex:1;min-width:120px;background:var(--surf2,#F8F7FF);border-radius:10px;padding:14px 16px;border:1px solid var(--border,#2d2d4e)}',
      '.ape-kpi-val{font-size:18px;font-weight:700;color:var(--text,#1F2937)}',
      '.ape-kpi-green{color:#22c55e}',
      '.ape-kpi-warn{color:#f59e0b}',
      '.ape-kpi-lbl{font-size:11px;color:var(--dim,#6B7280);margin-top:4px}',
      '.ape-cards-row{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}',
      '.ape-card{flex:1;min-width:180px;background:var(--surf2,#F8F7FF);border-radius:10px;padding:14px;border:1px solid var(--border,#2d2d4e)}',
      '.ape-card-header{font-size:13px;font-weight:700;color:var(--text,#1F2937);margin-bottom:10px;display:flex;align-items:center;gap:6px}',
      '.ape-card-icon{font-size:16px}',
      '.ape-card-list{margin:0;padding:0 0 0 4px;list-style:none}',
      '.ape-card-list li{font-size:12px;color:var(--dim,#6B7280);padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}',
      '.ape-section{background:var(--surf2,#F8F7FF);border-radius:10px;padding:16px 20px;margin-bottom:14px;border:1px solid var(--border,#2d2d4e)}',
      '.ape-section-title{font-size:13px;font-weight:700;color:var(--c2,#7B2FBE);margin-bottom:12px;text-transform:uppercase;letter-spacing:.4px}',
      '.ape-visit-item{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}',
      '.ape-visit-num{min-width:26px;height:26px;background:#4F008C;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}',
      '.ape-visit-body{flex:1}',
      '.ape-visit-name{font-size:14px;font-weight:600;color:var(--text,#1F2937);margin-bottom:4px}',
      '.ape-brick-badge{font-size:11px;background:rgba(167,139,250,.15);color:#a78bfa;border-radius:4px;padding:1px 6px;margin-left:6px}',
      '.ape-visit-prod{font-size:12px;color:#94a3b8;padding:1px 0}',
      '.ape-visit-why{font-size:11px;color:#64748b;margin-top:4px}',
      '.ape-visit-tl{font-size:14px;font-weight:700;color:#22c55e;white-space:nowrap;padding-top:2px}',
      '.ape-visit-total{margin-top:10px;font-size:13px;color:var(--dim,#6B7280);text-align:right}',
      '.ape-gap-strategy{font-size:14px;color:var(--text,#1F2937);margin-bottom:8px}',
      '.ape-gap-meta{font-size:13px;color:var(--dim,#6B7280)}',
      '.ape-weekly-grid{display:flex;gap:10px;flex-wrap:wrap}',
      '.ape-day-card{flex:1;min-width:100px;background:rgba(79,0,140,.15);border-radius:8px;padding:12px;border:1px solid rgba(79,0,140,.3);text-align:center}',
      '.ape-day-name{font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:6px}',
      '.ape-day-brick{font-size:12px;color:var(--text,#1F2937);margin-bottom:4px}',
      '.ape-day-count{font-size:12px;color:var(--dim,#6B7280)}',
      '.ape-sim-form{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center}',
      '.ape-sim-select,.ape-sim-input{background:var(--surf,#fff);border:1px solid var(--border,#2d2d4e);border-radius:8px;padding:8px 12px;color:var(--text,#1F2937);font-size:13px}',
      '.ape-sim-select{flex:2;min-width:140px}',
      '.ape-sim-input{flex:1;min-width:100px}',
      '.ape-sim-btn{background:#4F008C;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer}',
      '.ape-sim-btn:hover{background:#7B2FBE}',
      '.ape-sim-result-box{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:14px}',
      '.ape-sim-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:var(--dim,#6B7280)}',
      '.ape-sim-row b{color:var(--text,#1F2937)}',
      '.ape-sim-empty{font-size:13px;color:#888;padding:8px 0}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 15: Public API
  // ══════════════════════════════════════════════════════════════════════

  _injectCSS();

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
