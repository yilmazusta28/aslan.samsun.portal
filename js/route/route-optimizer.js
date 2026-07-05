// ══════════════════════════════════════════════════════════════════════
//  js/route/route-optimizer.js — PHASE 4.7
//  Smart Route Optimizer
//
//  Sorumluluk:
//    • runRouteOptimizer(ttt)         → ROUTE_OPTIMIZER state'ini güncelle
//    • buildTodayRoute(ttt)           → bugünün akıllı rotası
//    • buildWeeklyRoutes(ttt)         → pazartesi-cuma rota planı
//    • buildRouteContext(ttt)         → AI context metni
//    • renderTodayRouteCard(id, ttt)  → "Bugünkü Akıllı Rota" kartı
//    • renderWeeklyRouteCard(id, ttt) → "Haftalık Rota Planı" kartı
//
//  Girdi metrikleri (pharmacy-intelligence.js çıktısından):
//    classification, reorderProbability, opportunityScore
//    visitPriorityScore, expectedOrderDate, expectedOrderBoxes
//    expectedOrderValue, daysToNextOrder, daysSinceLastOrder
//    brick, eczane, gln
//
//  visitScore = (visitPriorityScore×0.40 + reorderProbability×0.25
//              + opportunityScore×0.20 + gapContribution×0.15)
//    → 0-100 normalize
//
//  Priority flags:
//    URGENT      : reorderProbability > 85 VE daysToNextOrder <= 3
//    OPPORTUNITY : opportunityScore > 80
//    RECOVERY    : classification IN [AT_RISK, REACTIVATION]
//
//  Brick Clustering:
//    Aynı brick içindeki eczaneler aynı güne gruplandırılır.
//    maxDailyVisits (default 12) kapasitesi brickler arası dağıtılır.
//
//  Gün sırası: Pazartesi-Cuma (5 iş günü)
//  Her gün en fazla maxDailyVisits eczane.
//
//  Global bağımlılıklar:
//    ECZANE_RAW, eczaneLoaded
//    window.PHARMACY_INTELLIGENCE (pharmacy-intelligence.js)
//    buildPharmacyProfiles() (pharmacy-intelligence.js)
//
//  Yükleme sırası: pharmacy-intelligence.js SONRASI, ai-context.js ÖNCESI
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard ─────────────────────────────────────────────────────────────
  if (window._ROUTE_OPTIMIZER_LOADED) {
    console.warn('[RouteOptimizer] Zaten yüklü — atlandı');
    return;
  }

  // ── Sabitler ──────────────────────────────────────────────────────────
  var DEFAULT_MAX_DAILY_VISITS = 12;
  var DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
  var AVG_BOX_PRICE = 109;

  // ── Global State ──────────────────────────────────────────────────────
  window.ROUTE_OPTIMIZER = {
    todayRoute:   null,
    weeklyRoutes: [],
    settings:     { maxDailyVisits: DEFAULT_MAX_DAILY_VISITS },
    generatedAt:  null,
    tttFilter:    null
  };

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 1: Gap Contribution hesabı
  //  Eczanenin brick'indeki IMS pazar payı fırsatından türetilir.
  //  IMS yoksa daysSinceLastOrder/avgOrderCycle proxy kullanılır.
  // ══════════════════════════════════════════════════════════════════════

  function _calcGapContribution(profile) {
    // Birincil: IMS verisiyle brick bazlı pazar açığı
    try {
      if (typeof IMS !== 'undefined' && IMS && IMS.length && profile.ttt) {
        var brickKey = (profile.brick || '').toUpperCase();
        var imsRows  = IMS.filter(function (r) {
          return (r.ttt === profile.ttt) &&
                 ((r.brick || '').toUpperCase() === brickKey) &&
                 r.is_mkt;
        });
        if (imsRows.length) {
          var mktTotal = imsRows.reduce(function (s, r) { return s + (r.toplam || 0); }, 0);
          if (mktTotal > 0) {
            // Eczanenin brick pazar payına oransal katkısı
            var eczShare = profile.avgMonthlyBoxes / Math.max(1, mktTotal);
            var gapScore = Math.min(100, eczShare * 5000); // normalize
            return Math.round(gapScore);
          }
        }
      }
    } catch (_e) { /* silent */ }

    // Yedek: order cycle gap proxy
    var daysSince = profile.daysSinceLastOrder || 30;
    var avgCycle  = profile.avgOrderCycle      || 30;
    var gap       = avgCycle > 0 ? daysSince / avgCycle : 1;
    return Math.min(100, Math.round(gap * 50));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 2: Visit Score hesabı (0-100, sonradan normalize edilir)
  // ══════════════════════════════════════════════════════════════════════

  function _calcVisitScore(profile) {
    var vps  = profile.visitPriorityScore || 0;
    var rp   = profile.reorderProbability  || 0;
    var opp  = profile.opportunityScore    || 0;
    var gap  = _calcGapContribution(profile);

    return (vps * 0.40) + (rp * 0.25) + (opp * 0.20) + (gap * 0.15);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 3: Priority Flag belirleme
  // ══════════════════════════════════════════════════════════════════════

  function _determinePriority(profile) {
    // URGENT: Sipariş olasılığı yüksek ve çok az zaman kalmış
    if (profile.reorderProbability > 85 && (profile.daysToNextOrder || 0) <= 3) {
      return 'URGENT';
    }
    // OPPORTUNITY: Yüksek fırsat skoru
    if (profile.opportunityScore > 80) {
      return 'OPPORTUNITY';
    }
    // RECOVERY: Risk altında veya yeniden kazanım
    if (profile.classification === 'AT_RISK' || profile.classification === 'REACTIVATION') {
      return 'RECOVERY';
    }
    return 'NORMAL';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 4: Profilleri zenginleştir (visitScore + priority)
  // ══════════════════════════════════════════════════════════════════════

  function _enrichProfiles(profiles) {
    // Ham visit score hesapla
    var enriched = profiles.map(function (p) {
      var rawScore  = _calcVisitScore(p);
      var priority  = _determinePriority(p);
      var gapContr  = _calcGapContribution(p);
      return {
        gln:                p.gln,
        eczane:             p.eczane,
        brick:              p.brick,
        ttt:                p.ttt,
        classification:     p.classification,
        reorderProbability: p.reorderProbability,
        opportunityScore:   p.opportunityScore,
        visitPriorityScore: p.visitPriorityScore,
        expectedOrderBoxes: p.expectedOrderBoxes,
        expectedOrderValue: p.expectedOrderValue,
        expectedOrderDate:  p.expectedOrderDate,
        daysToNextOrder:    p.daysToNextOrder,
        daysSinceLastOrder: p.daysSinceLastOrder,
        avgMonthlyBoxes:    p.avgMonthlyBoxes,
        trendSlope:         p.trendSlope,
        gapContribution:    gapContr,
        priority:           priority,
        _rawScore:          rawScore
      };
    });

    // visitScore 0-100 normalize et
    var maxRaw = enriched.reduce(function (m, p) { return Math.max(m, p._rawScore); }, 1);
    enriched.forEach(function (p) {
      p.visitScore = maxRaw > 0 ? Math.round((p._rawScore / maxRaw) * 100) : 0;
      delete p._rawScore;
    });

    // Önce URGENT, sonra OPPORTUNITY, sonra visitScore'a göre sırala
    enriched.sort(function (a, b) {
      var prioOrder = { URGENT: 0, OPPORTUNITY: 1, RECOVERY: 2, NORMAL: 3 };
      var pa = prioOrder[a.priority] !== undefined ? prioOrder[a.priority] : 3;
      var pb = prioOrder[b.priority] !== undefined ? prioOrder[b.priority] : 3;
      if (pa !== pb) return pa - pb;
      return b.visitScore - a.visitScore;
    });

    return enriched;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 5: Brick Clustering
  //  Aynı brick içindeki eczaneleri grupla, max kapasiteye göre dağıt.
  // ══════════════════════════════════════════════════════════════════════

  function _clusterByBrick(profiles) {
    var brickMap = {};
    profiles.forEach(function (p) {
      var key = (p.brick || 'BILINMIYOR').toUpperCase();
      if (!brickMap[key]) brickMap[key] = [];
      brickMap[key].push(p);
    });

    // Brick'leri içlerindeki en yüksek visitScore'a göre sırala
    var bricks = Object.keys(brickMap).map(function (k) {
      var arr = brickMap[k];
      var maxScore  = Math.max.apply(null, arr.map(function (p) { return p.visitScore; }));
      var totalBoxes= arr.reduce(function (s, p) { return s + (p.expectedOrderBoxes || 0); }, 0);
      var urgentCnt = arr.filter(function (p) { return p.priority === 'URGENT'; }).length;
      return {
        name:       k,
        pharmacies: arr,
        maxScore:   maxScore,
        totalBoxes: totalBoxes,
        urgentCnt:  urgentCnt
      };
    });

    // URGENT içeren brickler önce, sonra maxScore
    bricks.sort(function (a, b) {
      if (b.urgentCnt !== a.urgentCnt) return b.urgentCnt - a.urgentCnt;
      return b.maxScore - a.maxScore;
    });

    return bricks;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 6: Günlük rota oluştur (tek bir gün için)
  // ══════════════════════════════════════════════════════════════════════

  function _buildDayRoute(dayName, brickClusters, startIdx, maxVisits) {
    var pharmacies = [];
    var usedBricks = [];
    var totalBoxes = 0;
    var totalValue = 0;
    var count      = 0;

    // Bricklerden sırasıyla eczane al
    for (var bi = startIdx; bi < brickClusters.length && count < maxVisits; bi++) {
      var cluster = brickClusters[bi];
      var added   = 0;

      for (var pi = 0; pi < cluster.pharmacies.length && count < maxVisits; pi++) {
        var p = cluster.pharmacies[pi];
        pharmacies.push({
          rank:               pharmacies.length + 1,
          eczane:             p.eczane,
          brick:              p.brick || p.name,
          priority:           p.priority,
          visitScore:         p.visitScore,
          reorderProbability: p.reorderProbability,
          opportunityScore:   p.opportunityScore,
          expectedOrderBoxes: p.expectedOrderBoxes || 0,
          expectedOrderValue: p.expectedOrderValue || 0,
          expectedOrderDate:  p.expectedOrderDate  || '—',
          daysToNextOrder:    p.daysToNextOrder     || 0,
          classification:     p.classification,
          gapContribution:    p.gapContribution     || 0,
          gln:                p.gln                 || '',
          // FAZ 10.3/11.1: Explainable AI — kademeden gelen açıklama
          tier:               p.tier  || 0,
          neden:              p.neden || null
        });
        totalBoxes += (p.expectedOrderBoxes || 0);
        totalValue += (p.expectedOrderValue || 0);
        count++;
        added++;
      }

      if (added > 0) {
        usedBricks.push({
          name:  cluster.name,
          count: added,
          boxes: cluster.pharmacies.slice(0, added).reduce(function (s, p) {
            return s + (p.expectedOrderBoxes || 0);
          }, 0)
        });
      }
    }

    var primaryBrick = usedBricks.length ? usedBricks[0].name : '—';

    return {
      day:              dayName,
      brick:            primaryBrick,
      bricks:           usedBricks,
      expectedRevenue:  totalValue,
      expectedBoxes:    totalBoxes,
      pharmacies:       pharmacies,
      pharmacyCount:    pharmacies.length,
      urgentCount:      pharmacies.filter(function (p) { return p.priority === 'URGENT'; }).length,
      opportunityCount: pharmacies.filter(function (p) { return p.priority === 'OPPORTUNITY'; }).length,
      recoveryCount:    pharmacies.filter(function (p) { return p.priority === 'RECOVERY'; }).length
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 7: Ana rota üreteci
  // ══════════════════════════════════════════════════════════════════════

  // ── FAZ 10.3: 5-Kademe Sıralama Yardımcıları ──────────────────────────

  // Kademe 1: Bugünkü PLANLI brickler (RoutePlanInput manuel girişi)
  function _tier1PlannedBricks(enriched, tttFilter) {
    if (!window.RoutePlanInput || typeof window.RoutePlanInput.getTodayPlanSync !== 'function') return [];
    var plan = window.RoutePlanInput.getTodayPlanSync(tttFilter);
    if (!plan || !plan.bricks || !plan.bricks.length) return [];
    var plannedBricks = plan.bricks.map(function (b) { return b.toUpperCase(); });
    return enriched.filter(function (p) {
      return plannedBricks.indexOf((p.brick || '').toUpperCase()) >= 0;
    }).map(function (p) { return Object.assign({}, p, { tier: 1, neden: 'Planlanmış brick (' + p.brick + ')' }); });
  }

  // Kademe 2: Sipariş zamanı gelen eczaneler (daysToNextOrder <= 7)
  function _tier2OrderDue(enriched) {
    return enriched.filter(function (p) {
      return (p.daysToNextOrder || 999) <= 7 && p.reorderProbability >= 50;
    }).map(function (p) { return Object.assign({}, p, { tier: 2, neden: 'Sipariş zamanı (' + p.daysToNextOrder + ' gün)' }); });
  }

  // Kademe 3: Rakip baskısı olan eczaneler (competitiveCampaigns + brick eşleme)
  function _tier3CompetitivePressure(enriched, tttFilter) {
    var pressuredBricks = {};
    try {
      if (window.CompetitiveAdapter && typeof window.CompetitiveAdapter.normalizeCompetitive === 'function') {
        var cData = window.CompetitiveAdapter.normalizeCompetitive();
        var comps = (cData && cData.competitorActions) || [];
        comps.filter(function (a) { return !a.isOwn && a.kampanya; }).forEach(function (a) {
          if (a.brick) pressuredBricks[(a.brick || '').toUpperCase()] = true;
        });
      }
    } catch (_e) {}
    if (!Object.keys(pressuredBricks).length) return [];
    return enriched.filter(function (p) {
      return pressuredBricks[(p.brick || '').toUpperCase()];
    }).map(function (p) { return Object.assign({}, p, { tier: 3, neden: 'Rakip baskısı — ' + p.brick }); });
  }

  // Kademe 4: Yüksek Opportunity Score (OpportunityScoreEngine, FAZ 6.5)
  function _tier4HighOpportunity(enriched) {
    return enriched.filter(function (p) { return (p.opportunityScore || 0) >= 70; })
      .map(function (p) { return Object.assign({}, p, { tier: 4, neden: 'Yüksek fırsat (opp=' + p.opportunityScore + ')' }); });
  }

  // Kademe 5: Ziyaret edilmemiş yüksek potansiyelli eczaneler (FAZ 9.2)
  function _tier5UnselectedHighPotential(enriched, tttFilter) {
    if (!window.CoverageSelection || typeof window.CoverageSelection.listUnselectedHighPotential !== 'function') return [];
    try {
      // listUnselectedHighPotential Promise döner — sync cache için enriched'den proxy kullan
      return enriched.filter(function (p) { return (p.reorderProbability || 0) >= 60; })
        .map(function (p) { return Object.assign({}, p, { tier: 5, neden: 'Ziyaret planına eklenmesi önerilir (potansiyel)' }); });
    } catch (_e) { return []; }
  }

  function buildTodayRoute(tttFilter) {
    var MAX_DAILY = 5; // FAZ 10.3: SON-MASTER'ın istediği maksimum 5 eczane

    // Profilleri al
    var profiles = _getProfiles(tttFilter);
    if (!profiles || !profiles.length) return null;

    // Zenginleştir
    var enriched = _enrichProfiles(profiles);

    // Bugünün günü
    // BUG DÜZELTMESİ: Cumartesi/Pazar günü eskiden dayOffset sabit 1'e
    // ayarlanıyordu — bu "Salı" (DAY_NAMES[1]) etiketini gösteriyordu ama
    // aslında hâlâ BUGÜN için bir ziyaret listesi üretip gösteriyordu.
    // Hafta sonu iş günü olmadığından "bugüne eczane önerilmemeli" —
    // artık hafta sonuysa bir sonraki iş gününün (Pazartesi) planı
    // üretiliyor ve `isWeekend` bayrağıyla işaretleniyor, render fonksiyonu
    // bunu "bugün" yerine "Pazartesi için" diye göstermeli.
    var today      = new Date().getDay();
    var isWeekend  = (today === 0 || today === 6);
    var dayOffset  = isWeekend ? 0 : today - 1; // hafta sonu → Pazartesi (index 0)
    var dayName    = DAY_NAMES[Math.min(dayOffset, 4)];

    // FAZ 10.3: 5-kademe sıralama
    var used = {};
    var result = [];

    function _addFromTier(tieredList) {
      tieredList.forEach(function (p) {
        var key = p.gln || p.eczane;
        if (!used[key] && result.length < MAX_DAILY) {
          used[key] = true;
          result.push(p);
        }
      });
    }

    _addFromTier(_tier1PlannedBricks(enriched, tttFilter));
    _addFromTier(_tier2OrderDue(enriched));
    _addFromTier(_tier3CompetitivePressure(enriched, tttFilter));
    _addFromTier(_tier4HighOpportunity(enriched));
    _addFromTier(_tier5UnselectedHighPotential(enriched, tttFilter));

    // Kademe dolmadıysa kalan yüksek-skor eczanelerden tamamla (fallback)
    if (result.length < MAX_DAILY) {
      var clusters = _clusterByBrick(enriched);
      clusters.forEach(function (cluster) {
        cluster.pharmacies.forEach(function (p) {
          var key = p.gln || p.eczane;
          if (!used[key] && result.length < MAX_DAILY) {
            used[key] = true;
            result.push(Object.assign({}, p, { tier: 0, neden: 'Genel sıralama' }));
          }
        });
      });
    }

    // _buildDayRoute için sahte tek-cluster yapısı
    var fakeCluster = [{ name: dayName, pharmacies: result }];
    var built = _buildDayRoute(dayName, fakeCluster, 0, MAX_DAILY);
    if (built) built.isWeekend = isWeekend;
    return built;
  }

  function buildWeeklyRoutes(tttFilter) {
    var maxVisits = (window.ROUTE_OPTIMIZER.settings || {}).maxDailyVisits || DEFAULT_MAX_DAILY_VISITS;

    var profiles = _getProfiles(tttFilter);
    if (!profiles || !profiles.length) return [];

    var enriched = _enrichProfiles(profiles);
    var clusters = _clusterByBrick(enriched);

    var routes = [];
    var globalPharmacyIdx = 0; // kaç eczane kullandık

    // Her gün için ayrı rota oluştur
    // Strategi: URGENT'lar her gün önce gösterilir, normal eczaneler gün bazlı dağıtılır
    var urgents     = enriched.filter(function (p) { return p.priority === 'URGENT'; });
    var nonUrgents  = enriched.filter(function (p) { return p.priority !== 'URGENT'; });

    // Non-urgent clusters
    var nonUrgentClusters = _clusterByBrick(nonUrgents);

    var usedPharmacies = new Set();

    // BUG DÜZELTMESİ: Temsilcinin route-plan-input.js (FAZ 10.2/10.3) ile
    // GİRDİĞİ haftalık brick planı bu fonksiyon tarafından hiç okunmuyordu
    // — "Haftalık Rota" her zaman salt algoritmik dağılım gösteriyordu,
    // temsilci Pazartesi-Cuma için brick seçip kaydetse bile hiçbir şey
    // değişmiyordu. buildTodayRoute()'daki Kademe-1 mantığıyla TUTARLI
    // olacak şekilde: o gün için manuel plan VARSA önce o brick'lerdeki
    // eczaneler kullanılır, kalan kapasite eskisi gibi (urgent + brick
    // kümeleri) doldurulur. Manuel plan yoksa davranış hiç değişmez.
    var manualWeekPlan = null;
    try {
      if (window.RoutePlanInput && typeof window.RoutePlanInput.getWeekPlanSync === 'function') {
        manualWeekPlan = window.RoutePlanInput.getWeekPlanSync(tttFilter);
      }
    } catch (_e) {}

    for (var d = 0; d < 5; d++) {
      var dayPharmacies = [];
      var dayBoxes      = 0;
      var dayValue      = 0;
      var dayBricks     = {};

      // Kademe-1: bu gün için temsilcinin manuel planı (varsa) önce eklenir
      var weekday = d + 1; // route-plan-input.js: 1=Pazartesi...5=Cuma
      var plannedBricks = (manualWeekPlan && manualWeekPlan[weekday] && manualWeekPlan[weekday].length)
        ? manualWeekPlan[weekday].map(function (b) { return b.toUpperCase(); })
        : null;

      if (plannedBricks) {
        enriched
          .filter(function (p) { return plannedBricks.indexOf((p.brick || '').toUpperCase()) >= 0; })
          .sort(function (a, b) { return b.visitScore - a.visitScore; })
          .forEach(function (p) {
            var pKey = p.gln || p.eczane;
            if (dayPharmacies.length < maxVisits && !usedPharmacies.has(pKey)) {
              dayPharmacies.push(p);
              usedPharmacies.add(pKey);
            }
          });
      }

      // Önce URGENT'ları ekle (her gün paylaştırılır)
      urgents.forEach(function (p) {
        if (dayPharmacies.length < maxVisits && !usedPharmacies.has(p.gln || p.eczane)) {
          dayPharmacies.push(p);
          usedPharmacies.add(p.gln || p.eczane);
        }
      });

      // Kalan kapasiteyi non-urgent cluster'lardan doldur
      var remaining = maxVisits - dayPharmacies.length;
      for (var ci = 0; ci < nonUrgentClusters.length && remaining > 0; ci++) {
        var cluster = nonUrgentClusters[ci];
        for (var pi = 0; pi < cluster.pharmacies.length && remaining > 0; pi++) {
          var p = cluster.pharmacies[pi];
          var pKey = p.gln || p.eczane;
          if (!usedPharmacies.has(pKey)) {
            dayPharmacies.push(p);
            usedPharmacies.add(pKey);
            remaining--;
          }
        }
      }

      // Rank ve toplam hesapla
      var rankedPharmacies = dayPharmacies.map(function (p, i) {
        dayBoxes += (p.expectedOrderBoxes || 0);
        dayValue += (p.expectedOrderValue || 0);
        var bKey = (p.brick || 'BİLİNMİYOR').toUpperCase();
        if (!dayBricks[bKey]) dayBricks[bKey] = 0;
        dayBricks[bKey]++;
        return {
          rank:               i + 1,
          eczane:             p.eczane,
          brick:              p.brick,
          priority:           p.priority,
          visitScore:         p.visitScore,
          reorderProbability: p.reorderProbability,
          opportunityScore:   p.opportunityScore,
          expectedOrderBoxes: p.expectedOrderBoxes || 0,
          expectedOrderValue: p.expectedOrderValue || 0,
          expectedOrderDate:  p.expectedOrderDate  || '—',
          daysToNextOrder:    p.daysToNextOrder     || 0,
          classification:     p.classification,
          gapContribution:    p.gapContribution     || 0,
          gln:                p.gln                 || ''
        };
      });

      // Dominant brick bul
      var primaryBrick = Object.keys(dayBricks).length
        ? Object.keys(dayBricks).sort(function (a, b) { return dayBricks[b] - dayBricks[a]; })[0]
        : '—';

      // Brick listesi
      var bricksArr = Object.keys(dayBricks).map(function (k) {
        return { name: k, count: dayBricks[k] };
      }).sort(function (a, b) { return b.count - a.count; });

      routes.push({
        day:              DAY_NAMES[d],
        dayIndex:         d,
        brick:            primaryBrick,
        bricks:           bricksArr,
        expectedRevenue:  dayValue,
        expectedBoxes:    dayBoxes,
        pharmacies:       rankedPharmacies,
        pharmacyCount:    rankedPharmacies.length,
        urgentCount:      rankedPharmacies.filter(function (p) { return p.priority === 'URGENT'; }).length,
        opportunityCount: rankedPharmacies.filter(function (p) { return p.priority === 'OPPORTUNITY'; }).length,
        recoveryCount:    rankedPharmacies.filter(function (p) { return p.priority === 'RECOVERY'; }).length
      });
    }

    return routes;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 8: Profil kaynak yardımcısı
  // ══════════════════════════════════════════════════════════════════════

  function _getProfiles(tttFilter) {
    // Önce PHARMACY_INTELLIGENCE state'inden al
    var pi = window.PHARMACY_INTELLIGENCE;
    if (pi && pi.profiles && pi.profiles.length &&
        (pi.tttFilter === (tttFilter || 'TÜMÜ') || !tttFilter)) {
      return pi.profiles.filter(function (p) {
        return p.totalBoxes > 0 && p.classification !== 'CAMPAIGN_BUYER';
      });
    }

    // Yoksa doğrudan buildPharmacyProfiles çağır
    if (typeof buildPharmacyProfiles === 'function') {
      var profiles = buildPharmacyProfiles(tttFilter);
      return (profiles || []).filter(function (p) {
        return p.totalBoxes > 0 && p.classification !== 'CAMPAIGN_BUYER';
      });
    }

    return [];
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 9: Ana orkestrasyon
  // ══════════════════════════════════════════════════════════════════════

  function runRouteOptimizer(tttFilter) {
    try {
      if (!window.PHARMACY_INTELLIGENCE && typeof buildPharmacyProfiles !== 'function') {
        console.warn('[RouteOptimizer] pharmacy-intelligence.js yüklü değil');
        return false;
      }

      var todayRoute   = buildTodayRoute(tttFilter);
      var weeklyRoutes = buildWeeklyRoutes(tttFilter);

      window.ROUTE_OPTIMIZER = {
        todayRoute:   todayRoute,
        weeklyRoutes: weeklyRoutes,
        settings:     { maxDailyVisits: DEFAULT_MAX_DAILY_VISITS },
        generatedAt:  new Date().toISOString(),
        tttFilter:    tttFilter || 'TÜMÜ'
      };

      console.log(
        '[RouteOptimizer] ✅ Phase 4.7:',
        todayRoute ? todayRoute.pharmacyCount + ' bugün' : '—',
        '| Haftalık:', weeklyRoutes.length, 'gün |',
        (weeklyRoutes.reduce(function (s, r) { return s + r.pharmacyCount; }, 0)),
        'toplam ziyaret'
      );
      return true;

    } catch (err) {
      console.error('[RouteOptimizer] Hata:', err);
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 10: AI Context
  // ══════════════════════════════════════════════════════════════════════

  function buildRouteContext(tttFilter) {
    try {
      var ro = window.ROUTE_OPTIMIZER;

      // State yoksa veya farklı TTT için yeniden hesapla
      if (!ro || !ro.todayRoute ||
          ro.tttFilter !== (tttFilter || 'TÜMÜ')) {
        runRouteOptimizer(tttFilter);
        ro = window.ROUTE_OPTIMIZER;
      }

      if (!ro || !ro.todayRoute) {
        return '\n\n--- ROUTE OPTIMIZER (4.7) ---\n(Veri yok — pharmacy-intelligence çalıştırın)';
      }

      var lines = [
        '',
        '--- ROUTE OPTIMIZER (Phase 4.7) ---',
        'Üretim: ' + (ro.generatedAt ? ro.generatedAt.slice(0, 10) : '—'),
        'AI TALİMAT: Önce route optimizer çıktısını analiz et. Sonra satış stratejisini oluştur.',
        ''
      ];

      // Bugünün rotası
      var t = ro.todayRoute;
      if (t) {
        lines.push('BUGÜNÜN ROTASI');
        lines.push('Gün: ' + t.day + ' | Brick: ' + t.brick);
        lines.push('Beklenen TL: ' + t.expectedRevenue.toLocaleString('tr-TR') + '₺ | Beklenen Kutu: ' + t.expectedBoxes);
        if (t.urgentCount > 0)      lines.push('⚡ ACİL ZİYARET: ' + t.urgentCount + ' eczane');
        if (t.opportunityCount > 0) lines.push('💡 FIRSAT: ' + t.opportunityCount + ' eczane');
        if (t.recoveryCount > 0)    lines.push('🔄 KAZANİM: ' + t.recoveryCount + ' eczane');
        lines.push('');

        t.pharmacies.forEach(function (p, i) {
          var prioIcon = p.priority === 'URGENT' ? '⚡' :
                         p.priority === 'OPPORTUNITY' ? '💡' :
                         p.priority === 'RECOVERY' ? '🔄' : '•';
          lines.push(
            (i + 1) + '. ' + p.eczane + ' [' + p.brick + ']' +
            ' ' + prioIcon + ' ' + p.priority +
            ' | Sipariş %: ' + p.reorderProbability +
            ' | Beklenen: ' + p.expectedOrderBoxes + ' kutu' +
            ' | ' + p.expectedOrderValue.toLocaleString('tr-TR') + '₺'
          );
        });
      }

      // Haftalık özet
      if (ro.weeklyRoutes && ro.weeklyRoutes.length) {
        lines.push('');
        lines.push('HAFTALIK ROTA ÖZETI');
        ro.weeklyRoutes.forEach(function (d) {
          lines.push(
            d.day + ': ' + d.pharmacyCount + ' eczane | ' +
            d.brick + ' | ' +
            d.expectedBoxes + ' kutu | ' +
            d.expectedRevenue.toLocaleString('tr-TR') + '₺' +
            (d.urgentCount ? ' ⚡' + d.urgentCount : '')
          );
        });

        var weekTotal = ro.weeklyRoutes.reduce(function (s, d) { return s + d.expectedRevenue; }, 0);
        var weekBoxes = ro.weeklyRoutes.reduce(function (s, d) { return s + d.expectedBoxes; }, 0);
        lines.push('');
        lines.push('Haftalık Toplam: ' + weekBoxes + ' kutu | ' + weekTotal.toLocaleString('tr-TR') + '₺');
      }

      return lines.join('\n');

    } catch (err) {
      console.warn('[RouteOptimizer] buildRouteContext hata:', err.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 11: Dashboard — Bugünkü Akıllı Rota Kartı
  // ══════════════════════════════════════════════════════════════════════

  function renderTodayRouteCard(containerId, tttFilter) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var ok = runRouteOptimizer(tttFilter);
    var ro = window.ROUTE_OPTIMIZER;

    if (!ok || !ro || !ro.todayRoute || !ro.todayRoute.pharmacies.length) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim)">⏳ Rota verisi hazırlanıyor…</div>';
      return;
    }

    var t = ro.todayRoute;

    // FAZ 14.2 — Hafta sonu bildirimi: Cumartesi/Pazar iş günü değil,
    // bu yüzden "bugün" için değil bir sonraki iş günü (Pazartesi) için
    // öneri gösteriliyor — kullanıcıyı yanıltmamak için açıkça belirtiyoruz.
    var weekendNotice = t.isWeekend
      ? '<div style="padding:10px 14px;margin-bottom:10px;background:rgba(217,119,6,.08);' +
        'border:1px solid rgba(217,119,6,.25);border-radius:10px;font-size:11px;color:#92400E;font-weight:600">' +
        '📅 Bugün hafta sonu — aşağıda <b>Pazartesi</b> için önerilen ziyaret planı gösteriliyor.' +
        '</div>'
      : '';

    // Yardımcılar
    var _prioBadge = function (priority) {
      var m = {
        URGENT:      { bg: '#FEE2E2', c: '#DC2626', l: '⚡ ACİL'    },
        OPPORTUNITY: { bg: '#DCFCE7', c: '#15803D', l: '💡 FIRSAT'  },
        RECOVERY:    { bg: '#F3E8FF', c: '#7C3AED', l: '🔄 KAZANİM' },
        NORMAL:      { bg: '#F1F5F9', c: '#64748B', l: 'Normal'      }
      };
      var x = m[priority] || m['NORMAL'];
      return '<span style="font-size:9px;font-weight:700;background:' + x.bg +
             ';color:' + x.c + ';border-radius:4px;padding:2px 6px">' + x.l + '</span>';
    };

    var _clsBadge = function (cls) {
      var m = {
        REGULAR_BUYER:  { bg: '#EFF6FF', c: '#1D4ED8', l: '✓ Düzenli'  },
        GROWING:        { bg: '#DCFCE7', c: '#15803D', l: '↑ Büyüyen'  },
        AT_RISK:        { bg: '#FEE2E2', c: '#DC2626', l: '⚠ Risk'     },
        REACTIVATION:   { bg: '#F3E8FF', c: '#7C3AED', l: '🔄 Kazanım' },
        OTHER:          { bg: '#F1F5F9', c: '#64748B', l: 'Diğer'      }
      };
      var x = m[cls] || m['OTHER'];
      return '<span style="font-size:9px;background:' + x.bg + ';color:' + x.c +
             ';border-radius:4px;padding:1px 5px">' + x.l + '</span>';
    };

    var _probBar = function (p) {
      var bg = p >= 70 ? '#16A34A' : p >= 45 ? '#D97706' : '#DC2626';
      return '<div style="display:flex;align-items:center;gap:4px;justify-content:center">' +
        '<div style="width:38px;height:5px;border-radius:3px;background:#E2E8F0;overflow:hidden">' +
          '<div style="height:100%;width:' + p + '%;background:' + bg + ';border-radius:3px"></div>' +
        '</div>' +
        '<span style="font-size:10px;font-weight:800">%' + p + '</span>' +
      '</div>';
    };

    var _scoreColor = function (s) {
      return s >= 70 ? '#521FD1' : s >= 40 ? '#0891B2' : '#64748B';
    };

    var rows = t.pharmacies.map(function (p) {
      var orderIn = p.daysToNextOrder <= 0
        ? '<span style="color:#DC2626;font-weight:800;font-size:10px">⚡ Bugün!</span>'
        : p.daysToNextOrder <= 7
          ? '<span style="color:#D97706;font-weight:700;font-size:10px">' + p.daysToNextOrder + ' gün</span>'
          : '<span style="color:var(--dim);font-size:10px">' + p.daysToNextOrder + ' gün</span>';

      return '<tr>' +
        '<td style="font-weight:800;color:var(--c1);text-align:center;font-size:13px">' + p.rank + '</td>' +
        '<td style="font-weight:600;font-size:11px">' + p.eczane + '</td>' +
        '<td style="font-size:10px;color:var(--dim)">' + p.brick + '</td>' +
        '<td style="text-align:center">' + _prioBadge(p.priority) + '</td>' +
        '<td style="text-align:center">' + _clsBadge(p.classification) + '</td>' +
        '<td style="text-align:center">' + (typeof window.renderConfidenceMeter === 'function' ? window.renderConfidenceMeter(p.reorderProbability) : _probBar(p.reorderProbability)) + '</td>' +
        '<td style="text-align:center;font-weight:700;color:#0891B2;font-size:12px">' + p.expectedOrderBoxes + '</td>' +
        '<td style="text-align:center;font-weight:800;font-size:12px;color:' + _scoreColor(p.visitScore) + '">' + p.visitScore + '</td>' +
        '<td style="text-align:center;font-weight:800;font-size:11px;color:#15803D">' +
          (p.expectedOrderValue > 0 ? p.expectedOrderValue.toLocaleString('tr-TR') + '₺' : '—') + '</td>' +
        '<td style="text-align:center">' + orderIn + '</td>' +
        '<td style="position:relative;min-width:180px">' +
          (typeof window.renderNedenButton === 'function'
            ? window.renderNedenButton(null, p.neden || null)
            : (p.neden ? '<span style="font-size:10px;color:var(--dim)">' + p.neden + '</span>' : '—')) +
          (typeof window.renderManualFeedbackButtons === 'function'
            ? window.renderManualFeedbackButtons({ eczane: p.eczane, brick: p.brick, ttt: (typeof tttFilter !== 'undefined' ? tttFilter : null) })
            : '') +
        '</td>' +
      '</tr>';
    }).join('');

    // Brick özet badge'leri
    var brickBadges = (t.bricks || []).map(function (b) {
      return '<span class="card-badge" style="background:#EFF6FF;color:#1D4ED8">' +
        b.name + ' (' + b.count + ')</span>';
    }).join('');

    container.innerHTML =
      weekendNotice +
      '<div class="card">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-badge">' + t.pharmacyCount + ' ziyaret</span>' +
          '<span class="card-badge" style="background:#DCFCE7;color:#15803D">' +
            '📦 ' + t.expectedBoxes + ' kutu</span>' +
          '<span class="card-badge" style="background:#F0FDF4;color:#166534">' +
            '💰 ' + t.expectedRevenue.toLocaleString('tr-TR') + '₺</span>' +
          (t.urgentCount > 0 ? '<span class="card-badge" style="background:#FEE2E2;color:#DC2626">⚡ ' + t.urgentCount + ' ACİL</span>' : '') +
          (t.opportunityCount > 0 ? '<span class="card-badge" style="background:#DCFCE7;color:#15803D">💡 ' + t.opportunityCount + ' FIRSAT</span>' : '') +
          (t.recoveryCount > 0 ? '<span class="card-badge" style="background:#F3E8FF;color:#7C3AED">🔄 ' + t.recoveryCount + ' KAZANİM</span>' : '') +
          brickBadges +
        '</div>' +
        '<div class="card-body-0 scroll-x">' +
          '<table class="tbl" style="min-width:960px">' +
            '<thead><tr>' +
              '<th style="text-align:center;width:32px">#</th>' +
              '<th>Eczane</th>' +
              '<th>Brick</th>' +
              '<th style="text-align:center">Öncelik</th>' +
              '<th style="text-align:center">Sınıf</th>' +
              '<th style="text-align:center">Güven</th>' +
              '<th style="text-align:center">Beklenen Kutu</th>' +
              '<th style="text-align:center">Visit Skoru</th>' +
              '<th style="text-align:center">Beklenen TL</th>' +
              '<th style="text-align:center">Sipariş Ne Zaman</th>' +
              '<th style="text-align:center">Neden?</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 12: Dashboard — Haftalık Rota Planı Kartı
  // ══════════════════════════════════════════════════════════════════════

  function renderWeeklyRouteCard(containerId, tttFilter) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var ro = window.ROUTE_OPTIMIZER;
    if (!ro || !ro.weeklyRoutes || !ro.weeklyRoutes.length) {
      runRouteOptimizer(tttFilter);
      ro = window.ROUTE_OPTIMIZER;
    }

    if (!ro || !ro.weeklyRoutes || !ro.weeklyRoutes.length) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim)">⏳ Haftalık plan hazırlanıyor…</div>';
      return;
    }

    var weekTotal  = ro.weeklyRoutes.reduce(function (s, d) { return s + d.expectedRevenue; }, 0);
    var weekBoxes  = ro.weeklyRoutes.reduce(function (s, d) { return s + d.expectedBoxes; }, 0);
    var weekVisits = ro.weeklyRoutes.reduce(function (s, d) { return s + d.pharmacyCount; }, 0);

    var _dayColor = function (idx) {
      var colors = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'];
      return colors[idx] || '#64748B';
    };

    // Haftalık tab görünümü
    var dayCards = ro.weeklyRoutes.map(function (d, idx) {
      var pharmacyRows = d.pharmacies.slice(0, 6).map(function (p, pi) {
        var prioIcon = p.priority === 'URGENT' ? '⚡' :
                       p.priority === 'OPPORTUNITY' ? '💡' :
                       p.priority === 'RECOVERY' ? '🔄' : '•';
        return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border)">' +
          '<span style="font-size:10px;font-weight:800;color:var(--c1);min-width:16px">' + (pi + 1) + '</span>' +
          '<span style="font-size:10px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + p.eczane + '</span>' +
          '<span style="font-size:9px">' + prioIcon + '</span>' +
          '<span style="font-size:10px;color:#0891B2;font-weight:700;min-width:28px;text-align:right">' + p.expectedOrderBoxes + '</span>' +
        '</div>';
      }).join('');

      var moreCount = Math.max(0, d.pharmacyCount - 6);

      return '<div style="flex:1;min-width:140px;background:var(--bg);border:2px solid ' + _dayColor(idx) + ';' +
             'border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:4px">' +
        '<div style="font-weight:800;font-size:12px;color:' + _dayColor(idx) + '">' + d.day + '</div>' +
        '<div style="font-size:9px;color:var(--dim);font-weight:600">' + d.brick + '</div>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:2px 0">' +
          '<span style="font-size:9px;background:#EFF6FF;color:#1D4ED8;border-radius:3px;padding:1px 5px">' +
            d.pharmacyCount + ' eczane</span>' +
          '<span style="font-size:9px;background:#F0FDF4;color:#166534;border-radius:3px;padding:1px 5px">' +
            d.expectedBoxes + ' kutu</span>' +
          (d.urgentCount ? '<span style="font-size:9px;background:#FEE2E2;color:#DC2626;border-radius:3px;padding:1px 5px">⚡' + d.urgentCount + '</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;font-weight:800;color:#15803D">' +
          d.expectedRevenue.toLocaleString('tr-TR') + '₺</div>' +
        '<div style="margin-top:4px;flex:1">' + pharmacyRows + '</div>' +
        (moreCount > 0 ? '<div style="font-size:9px;color:var(--dim);text-align:center;margin-top:2px">+' + moreCount + ' daha…</div>' : '') +
      '</div>';
    }).join('');

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-title">📅 Haftalık Rota Planı</span>' +
          '<span class="card-badge">' + weekVisits + ' toplam ziyaret</span>' +
          '<span class="card-badge" style="background:#DCFCE7;color:#15803D">📦 ' + weekBoxes + ' kutu</span>' +
          '<span class="card-badge" style="background:#F0FDF4;color:#166534">💰 ' + weekTotal.toLocaleString('tr-TR') + '₺</span>' +
        '</div>' +
        '<div class="card-body-0">' +
          '<div style="display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding:4px 0">' +
            dayCards +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════

  window.runRouteOptimizer      = runRouteOptimizer;
  window.buildTodayRoute        = buildTodayRoute;
  window.buildWeeklyRoutes      = buildWeeklyRoutes;
  window.buildRouteContext      = buildRouteContext;
  window.renderTodayRouteCard   = renderTodayRouteCard;
  window.renderWeeklyRouteCard  = renderWeeklyRouteCard;

  window._ROUTE_OPTIMIZER_LOADED = true;
  window._ROUTE_OPTIMIZER_READY  = true;

  console.log('[RouteOptimizer] ✅ Phase 4.7 yüklendi');

})();
