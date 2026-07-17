// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/pharmacy-intelligence.js — PHASE 4.6.4
//  Advanced Pharmacy Intelligence Engine
//
//  Sorumluluk:
//    • buildPharmacyProfiles(ttt)             → tüm aylar kullanılarak tam profil
//    • buildTop30Pharmacies(ttt)              → visitPriorityScore'a göre Top30
//    • runPharmacyIntelligence(ttt)           → PHARMACY_INTELLIGENCE state'ini güncelle
//    • buildPharmacyContext(ttt)              → AI context metni
//    • buildPharmacyIntelligenceContext(ttt)  → genişletilmiş AI context (4.6.4)
//    • renderPharmacyIntelligenceCard(id,ttt) → "İlk 30 Ziyaret Önceliği" kartı
//
//  Çıktı metrikleri (her eczane):
//    eczane, brick, ttt, gln
//    totalBoxes, avgMonthlyBoxes
//    historicalMaxBoxes, historicalMinBoxes
//    activeMonths, inactiveMonths
//    growthRate, trendSlope
//    consecutiveGrowthMonths, consecutiveDeclineMonths, consecutiveZeroMonths
//    reorderProbability
//    expectedOrderBoxes, expectedOrderValue
//    opportunityScore, visitPriorityScore
//    classification
//    productAffinityScore  { PANOCER, ACİDPASS, GRİPORT COLD, MOKSEFEN, FAMTREC }
//    daysSinceLastOrder, avgOrderCycle, daysToNextOrder, expectedOrderDate
//
//  Sınıflandırmalar:
//    GROWING | REGULAR_BUYER | REACTIVATION | CAMPAIGN_BUYER | AT_RISK | OTHER
//
//  Global bağımlılıklar:
//    ECZANE_RAW, eczaneLoaded, IMS_TL_MAP, URUN_ORDER (constants.js)
//
//  Yükleme sırası: data-state.js SONRASI, ai-context.js ÖNCESI
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── Guard ────────────────────────────────────────────────────────────
  if (window._PI464_LOADED) {
    console.warn('[PharmacyIntelligence] Zaten yüklü — atlandı');
    return;
  }

  // ── Sabitler ─────────────────────────────────────────────────────────
  var PRODUCTS = ['PANOCER', 'ACİDPASS', 'GRİPORT COLD', 'MOKSEFEN', 'FAMTREC'];

  // IMS_TL_MAP'ten ya da fallback
  function _boxPrice(urun) {
    if (typeof IMS_TL_MAP !== 'undefined' && IMS_TL_MAP[urun]) return IMS_TL_MAP[urun];
    var fb = { 'PANOCER': 105, 'ACİDPASS': 112, 'GRİPORT COLD': 84, 'MOKSEFEN': 149, 'FAMTREC': 95 };
    return fb[urun] || 100;
  }

  var AVG_BOX_PRICE = 109; // genel ağırlıklı ortalama (sabit) — sadece fallback

  // BUG DÜZELTMESİ: _boxPrice(urun) (gerçek IMS_TL_MAP birim fiyatı) daha
  // önce hiçbir yerde ÇAĞRILMIYORDU — expectedOrderValue ve opportunityScore
  // her eczane için, o eczanenin gerçek ürün karmasına bakılmaksızın hep aynı
  // düz AVG_BOX_PRICE=109 ile hesaplanıyordu. Halbuki her eczanenin hangi
  // üründen ne kadar aldığı zaten urunAyMap'te toplanıyor (productAffinityScore
  // için kullanılıyor) — sadece fiyat hesabına hiç bağlanmamıştı. Örneğin
  // ağırlıklı olarak MOKSEFEN (₺149/kutu) satan bir eczane ile GRİPORT COLD
  // (₺84/kutu) satan bir eczane aynı kutu adedi için aynı TL göstermemeli.
  // Bu fonksiyon eczanenin GERÇEK geçmiş ürün karmasına göre ağırlıklı
  // ortalama kutu fiyatı hesaplar; ürün kırılımı yoksa (nadiren) düz
  // AVG_BOX_PRICE'a geri düşer.
  function _weightedBoxPrice(urunAyMap) {
    var totalBoxes = 0, totalValue = 0;
    Object.keys(urunAyMap || {}).forEach(function (urun) {
      var ayMap = urunAyMap[urun] || {};
      var urunBoxes = Object.keys(ayMap).reduce(function (s, ay) { return s + (ayMap[ay] || 0); }, 0);
      totalBoxes += urunBoxes;
      totalValue += urunBoxes * _boxPrice(urun);
    });
    return totalBoxes > 0 ? (totalValue / totalBoxes) : AVG_BOX_PRICE;
  }

  // ── Global State ─────────────────────────────────────────────────────
  window.PHARMACY_INTELLIGENCE = {
    profiles:      [],
    top30:         [],
    opportunities: [],
    risks:         [],
    generatedAt:   null,
    tttFilter:     null
  };

  // ── Yardımcı: Ay string → sıralama sayısı ───────────────────────────
  function _monthNum(ayStr) {
    if (!ayStr) return 0;
    var p = String(ayStr).split('/');
    if (p.length < 2) return 0;
    return parseInt(p[1], 10) * 100 + parseInt(p[0], 10);
  }

  // ── Yardımcı: Standart sapma ─────────────────────────────────────────
  function _stdDev(arr) {
    if (!arr || arr.length < 2) return 0;
    var mean = arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
    var v    = arr.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0) / arr.length;
    return Math.sqrt(v);
  }

  // ── Yardımcı: Gün farkı (son sipariş ayının ortasından bugüne) ───────
  function _daysSince(ayStr) {
    if (!ayStr) return 999;
    try {
      var p = String(ayStr).split('/');
      var d = new Date(parseInt(p[1], 10), parseInt(p[0], 10) - 1, 15);
      return Math.max(0, Math.round((new Date() - d) / 86400000));
    } catch (_) { return 999; }
  }

  // ── Yardımcı: Tarih stringi (gün sonra) ─────────────────────────────
  function _dateAfterDays(days) {
    if (days < 0) return 'geçmiş';
    var d = new Date();
    d.setDate(d.getDate() + Math.round(days));
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 1: Sınıflandırma (tüm ayları kullan)
  // ══════════════════════════════════════════════════════════════════════

  function _classify(sales) {
    var len = sales.length;
    if (!len) return 'OTHER';

    var last  = sales[len - 1];
    var prev  = len >= 2 ? sales[len - 2] : 0;

    // ── CAMPAIGN_BUYER: son ay > önceki ort. × 3 ─────────────────────
    if (len >= 3) {
      var prevMonths = sales.slice(0, len - 1).filter(function (v) { return v > 0; });
      if (prevMonths.length > 0) {
        var pAvg = prevMonths.reduce(function (s, v) { return s + v; }, 0) / prevMonths.length;
        if (pAvg > 0 && last >= pAvg * 3) return 'CAMPAIGN_BUYER';
      }
    }

    // ── REACTIVATION: consecutiveZeroMonths >= 2, öncesinde aktivite ─
    if (len >= 3) {
      var last2Zero = last <= 2 && prev <= 2;
      var hadActivity = sales.slice(0, len - 2).some(function (v) { return v >= 30; });
      if (last2Zero && hadActivity) return 'REACTIVATION';
    }

    // ── GROWING: son 3 ay sürekli artış ──────────────────────────────
    if (len >= 3) {
      var g = sales.slice(Math.max(0, len - 3));
      var rising = true;
      for (var i = 1; i < g.length; i++) {
        if (g[i] < g[i - 1] * 0.88) { rising = false; break; }
      }
      if (rising && g[g.length - 1] > g[0]) return 'GROWING';
    }

    // ── AT_RISK: son 3 ay sürekli düşüş ──────────────────────────────
    if (len >= 3) {
      var d3 = sales.slice(Math.max(0, len - 3));
      var falling = true;
      for (var j = 1; j < d3.length; j++) {
        if (d3[j] > d3[j - 1] * 1.05) { falling = false; break; }
      }
      if (falling && d3[d3.length - 1] < d3[0]) return 'AT_RISK';
    }

    // ── REGULAR_BUYER: son 4 ay CV < 0.30, yeterli aktiflik ─────────
    var last4 = sales.slice(Math.max(0, len - 4)).filter(function (v) { return v > 0; });
    if (last4.length >= 3) {
      var mean4 = last4.reduce(function (s, v) { return s + v; }, 0) / last4.length;
      if (mean4 > 0 && _stdDev(last4) / mean4 < 0.30) return 'REGULAR_BUYER';
    }

    return 'OTHER';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 2: Trend analizi (lineer regresyon)
  // ══════════════════════════════════════════════════════════════════════

  function _trendSlope(sales) {
    var n = sales.length;
    if (n < 2) return 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
      sumX  += i; sumY += sales[i];
      sumXY += i * sales[i]; sumX2 += i * i;
    }
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  function _growthRate(sales) {
    var nonZero = sales.filter(function (v) { return v > 0; });
    if (nonZero.length < 2) return 0;
    var first = nonZero[0], last = nonZero[nonZero.length - 1];
    if (first === 0) return 100;
    return Math.round(((last - first) / first) * 100);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 3: Consecutive months
  // ══════════════════════════════════════════════════════════════════════

  function _consecutiveGrowth(sales) {
    var count = 0;
    for (var i = sales.length - 1; i >= 1; i--) {
      if (sales[i] > sales[i - 1]) count++;
      else break;
    }
    return count;
  }

  function _consecutiveDecline(sales) {
    var count = 0;
    for (var i = sales.length - 1; i >= 1; i--) {
      if (sales[i] < sales[i - 1]) count++;
      else break;
    }
    return count;
  }

  function _consecutiveZero(sales) {
    var count = 0;
    for (var i = sales.length - 1; i >= 0; i--) {
      if (sales[i] === 0) count++;
      else break;
    }
    return count;
  }

  // ── FAZ 10.0: Stock Build (kampanya ayı) işaretleme ─────────────────
  // Girdi: aylık satış dizisi (sıfır dahil). Çıktı: boolean flag dizisi
  // (true = kampanya spike — stock build ayı, hesaplamadan çıkarılmalı).
  // Eşik: nonZero ortalama × 2.5 (FAZ 9.1 SalesMemoryEngine ile tutarlı).
  // Kural: son ay > ortalama×3 (reorder-classifier CAMPAIGN_BUYER) ÜZERİNE
  // 2.5× eşikle genişletildi — daha erken tespite izin verir.
  function flagStockBuildMonths(sales) {
    var nonZero = (sales || []).filter(function (v) { return v > 0; });
    if (nonZero.length < 2) return (sales || []).map(function () { return false; });
    var mean = nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length;
    var threshold = mean * 2.5;
    return (sales || []).map(function (v) { return v > threshold; });
  }

  // ── FAZ 10.0: Boş-ay + kampanya spike düzeltmeli aylık ortalama ─────
  // FAZ 9.1 SalesMemoryEngine._avgConsumptionAdjusted() ile tutarlı —
  // sadece normalizasyon şemasına eklemek için burada da tanımlandı.
  function _avgMonthlyBoxesAdjusted(sales) {
    var flags = flagStockBuildMonths(sales);
    var filtered = sales.filter(function (v, i) { return v > 0 && !flags[i]; });
    if (!filtered.length) {
      // Tüm aktif aylar spike ise (stokçu eczane), en azından non-zero ortalaması al
      var nonZero = sales.filter(function (v) { return v > 0; });
      return nonZero.length ? Math.round(nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length * 10) / 10 : 0;
    }
    return Math.round(filtered.reduce(function (s, v) { return s + v; }, 0) / filtered.length * 10) / 10;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 4: Forecast (lineer + limiter)
  // ══════════════════════════════════════════════════════════════════════

  function _forecast(sales, historicalMax) {
    var n = sales.length;
    if (!n) return 0;
    if (n === 1) return sales[0];

    // Lineer projeksiyon
    var slope    = _trendSlope(sales);
    var intercept = (sales.reduce(function (s, v) { return s + v; }, 0) / n) - slope * (n - 1) / 2;
    var raw = Math.max(0, Math.round(intercept + slope * n));

    // Forecast limiter: historicalMax × 1.5
    var limit = Math.round((historicalMax || raw) * 1.5);
    return Math.min(raw, limit);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 5: Reorder Probability (5 bileşenli ağırlıklı)
  // ══════════════════════════════════════════════════════════════════════

  function _reorderProb(p) {
    var slope      = p.trendSlope;
    var sales      = p.sales;
    var activeM    = p.activeMonths;
    var totalM     = p.totalMonths;
    var growthRate = p.growthRate;
    var daysSince  = p.daysSinceLastOrder;
    var cls        = p.classification;

    // 1. trendSlope (25%) — normalize: +5 kutuluk artış/ay → 100
    var slopeScore = Math.min(100, Math.max(0, 50 + slope * 10));

    // 2. regularity / CV (25%)
    var nonZero = sales.filter(function (v) { return v > 0; });
    var cv = nonZero.length >= 2
      ? _stdDev(nonZero) / (nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length)
      : 1;
    var regularityScore = Math.max(0, Math.min(100, (1 - cv) * 100));

    // 3. lastOrderRecency (20%) — 30 gün ideal, 90+ kötü
    var recencyScore = daysSince <= 20  ? 100
                     : daysSince <= 35  ? 80
                     : daysSince <= 50  ? 60
                     : daysSince <= 70  ? 40
                     : daysSince <= 90  ? 20
                     : 5;

    // 4. activeMonths (15%) — toplam ay içindeki aktif ay oranı
    var activeScore = totalM > 0 ? Math.min(100, (activeM / totalM) * 100) : 0;

    // 5. growthRate (15%) — pozitif büyüme iyi, negatif kötü
    var grScore = Math.min(100, Math.max(0, 50 + growthRate * 0.5));

    var raw = slopeScore * 0.25
            + regularityScore * 0.25
            + recencyScore * 0.20
            + activeScore * 0.15
            + grScore * 0.15;

    // Sınıf düzeltmeleri
    if (cls === 'REGULAR_BUYER')  raw += 10;
    if (cls === 'GROWING')        raw += 8;
    if (cls === 'AT_RISK')        raw -= 20;
    if (cls === 'REACTIVATION')   raw -= 15;
    if (cls === 'CAMPAIGN_BUYER') raw -= 25;

    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 6: Opportunity Score
  // ══════════════════════════════════════════════════════════════════════

  // opportunityScore = reorderProbability × expectedOrderBoxes × avgBoxPrice → normalize 0-100
  // normalize için maxOpportunity gerekli (dışarıdan verilir)
  function _opportunityRaw(reorderProb, expectedBoxes, boxPrice) {
    return (reorderProb / 100) * expectedBoxes * (boxPrice || AVG_BOX_PRICE);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 7: Visit Priority Score
  // ══════════════════════════════════════════════════════════════════════

  function _visitPriority(opportunityScore, reorderProb, daysSince, avgOrderCycle) {
    var gap = avgOrderCycle > 0 ? daysSince / avgOrderCycle : 1;
    var gapContribution = Math.min(100, gap * 50); // gap > 2 → 100

    return Math.max(0, Math.min(100, Math.round(
      opportunityScore * 0.5 +
      reorderProb      * 0.3 +
      gapContribution  * 0.2
    )));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 8: Product Affinity
  // ══════════════════════════════════════════════════════════════════════

  // Her ürün için son aydaki aylık satış payına göre 0-100 affinity skoru
  // ══════════════════════════════════════════════════════════════════════
  //  PER-ÜRÜN SİPARİŞ YAKINALIK HESABI
  //  Döndürür: [ { urun, daysLeft, label, urgent, kutu, affinityPct } ]
  //  daysLeft=0  → bugün sipariş bekleniyor
  //  daysLeft<0  → gecikmiş
  // ══════════════════════════════════════════════════════════════════════
  function _nextOrderProducts(urunAyMap, allMonths) {
    var today  = new Date();
    var result = [];

    PRODUCTS.forEach(function (urun) {
      var urunSales = urunAyMap[urun] || {};

      // Bu üründen satış olan aylar (sıralı)
      var activeAyKeys = allMonths.filter(function (ay) {
        return (urunSales[ay] || 0) > 0;
      });

      if (!activeAyKeys.length) return; // hiç satış yok, atla

      // Son satış ayı
      var lastAy   = activeAyKeys[activeAyKeys.length - 1];
      var parts    = lastAy.split('/');
      var lastDate = new Date(parseInt(parts[1], 10), parseInt(parts[0], 10) - 1, 15);
      var daysSince = Math.round((today - lastDate) / 86400000);

      // Ortalama sipariş döngüsü (ürün bazında)
      var cycle = 30; // default
      if (activeAyKeys.length >= 2) {
        var diffs = [];
        for (var i = 1; i < activeAyKeys.length; i++) {
          var p0 = activeAyKeys[i-1].split('/');
          var p1 = activeAyKeys[i].split('/');
          var d0 = new Date(parseInt(p0[1],10), parseInt(p0[0],10)-1, 15);
          var d1 = new Date(parseInt(p1[1],10), parseInt(p1[0],10)-1, 15);
          var diff = Math.round((d1 - d0) / 86400000);
          if (diff > 0 && diff < 200) diffs.push(diff);
        }
        if (diffs.length) {
          cycle = Math.round(diffs.reduce(function(s,v){return s+v;},0) / diffs.length);
        }
      }

      var daysLeft = cycle - daysSince;

      // Son 3 aydaki ortalama kutu (tahmin)
      var last3 = allMonths.slice(-3);
      var kutu  = 0;
      last3.forEach(function(ay){ kutu += urunSales[ay] || 0; });
      kutu = Math.round(kutu / (last3.length || 1));

      // Affinity % (basit)
      var last3Active = last3.filter(function(ay){ return (urunSales[ay]||0) > 0; }).length;
      var affinityPct = last3.length > 0 ? Math.round((last3Active / last3.length) * 100) : 0;

      // Label
      var label;
      if (daysLeft <= 0)  label = 'Bugün';
      else if (daysLeft <= 7) label = daysLeft + 'g';
      else label = daysLeft + 'g';

      result.push({
        urun:       urun,
        daysLeft:   daysLeft,
        label:      label,
        urgent:     daysLeft <= 7,
        overdue:    daysLeft < 0,
        kutu:       kutu,
        affinityPct:affinityPct,
        cycle:      cycle
      });
    });

    // Yakınlık sırasına göre sırala (en acil önce)
    result.sort(function(a, b) { return a.daysLeft - b.daysLeft; });
    return result;
  }

  function _productAffinity(urunAyMap, allMonths) {
    var result = {};
    var last3Months = allMonths.slice(-3);

    PRODUCTS.forEach(function (urun) {
      var urunSales = urunAyMap[urun] || {};
      var total = 0, monthCount = 0;
      last3Months.forEach(function (ay) {
        var v = urunSales[ay] || 0;
        total += v;
        if (v > 0) monthCount++;
      });
      // Affinity: hem satış hacmi hem aktiflik
      var volumeScore   = Math.min(100, total * 2);          // 50 kutu → 100
      var activityScore = last3Months.length > 0 ? (monthCount / last3Months.length) * 100 : 0;
      result[urun] = Math.round(volumeScore * 0.7 + activityScore * 0.3);
    });

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BÖLÜM 9: Expected Order Date
  // ══════════════════════════════════════════════════════════════════════

  function _orderCycle(ayKeys) {
    // Aktif aylar arasındaki ortalama gün farkı
    if (!ayKeys || ayKeys.length < 2) return 30; // default
    var diffs = [];
    for (var i = 1; i < ayKeys.length; i++) {
      var p0 = ayKeys[i-1].split('/'); var p1 = ayKeys[i].split('/');
      var d0 = new Date(parseInt(p0[1],10), parseInt(p0[0],10)-1, 15);
      var d1 = new Date(parseInt(p1[1],10), parseInt(p1[0],10)-1, 15);
      var diff = Math.round((d1 - d0) / 86400000);
      if (diff > 0 && diff < 200) diffs.push(diff);
    }
    if (!diffs.length) return 30;
    return Math.round(diffs.reduce(function (s, v) { return s + v; }, 0) / diffs.length);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  ANA PROFIL OLUŞTURMA — FAZ 6.1.5 WRAPPER
  //  PharmacyBehaviorEngine (FAZ 6.1) varsa ona delege eder ve çıktısını
  //  bu dosyanın ORİJİNAL şemasına (ttt, expectedOrderBoxes/Value alan
  //  adları) çevirir — hesap mantığı artık TEK YERDE (behavior-engine),
  //  ama bu fonksiyonun İMZASI ve DÖNÜŞ ŞEMASI hiç değişmedi.
  //  PharmacyBehaviorEngine yüklü değilse (rollback / FAZ 6.1 öncesi
  //  durum), ORİJİNAL Phase 4.6.4 hesaplama mantığına (_legacyBuildPharmacyProfiles)
  //  otomatik düşer — davranış asla bozulmaz.
  // ══════════════════════════════════════════════════════════════════════

  // behavior-engine profilini bu dosyanın orijinal alan adlarına çevirir
  function _fromBehaviorProfile(p) {
    return {
      gln: p.gln, eczane: p.eczane, brick: p.brick, ttt: p.representative,
      totalBoxes: p.totalBoxes, avgMonthlyBoxes: p.avgMonthlyBoxes,
      historicalMaxBoxes: p.historicalMaxBoxes, historicalMinBoxes: p.historicalMinBoxes,
      activeMonths: p.activeMonths, inactiveMonths: p.inactiveMonths,
      growthRate: p.growthRate, trendSlope: p.trendSlope,
      consecutiveGrowthMonths: p.consecutiveGrowthMonths,
      consecutiveDeclineMonths: p.consecutiveDeclineMonths,
      consecutiveZeroMonths: p.consecutiveZeroMonths,
      reorderProbability: p.reorderProbability,
      expectedOrderBoxes: p.forecastBoxes,
      expectedOrderValue: p.forecastValue,
      opportunityScore: p.opportunityScore,
      visitPriorityScore: p.visitPriorityScore,
      classification: p.classification,
      productAffinityScore: p.productAffinityScore,
      nextOrderProducts: p.nextOrderProducts,
      daysSinceLastOrder: p.daysSinceLastOrder,
      avgOrderCycle: p.avgOrderCycle,
      daysToNextOrder: p.daysToNextOrder,
      expectedOrderDate: p.expectedOrderDate
    };
  }

  function buildPharmacyProfiles(tttFilter) {
    if (window.PharmacyBehaviorEngine) {
      try {
        var behaviorProfiles = window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter);
        return behaviorProfiles.map(_fromBehaviorProfile);
      } catch (_delegateErr) {
        console.warn('[PharmacyIntelligence] PharmacyBehaviorEngine delege hata, legacy hesaba düşülüyor:', _delegateErr.message);
        // aşağı düş — legacy hesaba devam
      }
    }
    return _legacyBuildPharmacyProfiles(tttFilter);
  }

  function _legacyBuildPharmacyProfiles(tttFilter) {
    // pharmacyActiveData öncelikli (PDM multi-select), yoksa ECZANE_RAW fallback
    var _piBase = (window.pharmacyActiveData && window.pharmacyActiveData.length > 0)
      ? window.pharmacyActiveData
      : (typeof ECZANE_RAW !== 'undefined' ? ECZANE_RAW : []);
    if (!_piBase || !Array.isArray(_piBase) || !_piBase.length) {
      console.warn('[PharmacyIntelligence] veri yok (pharmacyActiveData ve ECZANE_RAW boş)');
      return [];
    }

    var source = tttFilter
      ? _piBase.filter(function (r) { return r.ttt === tttFilter; })
      : _piBase;

    if (!source.length) return [];

    // ── Eczane × Ay × Ürün agregasyonu ─────────────────────────────────
    var eczMap = {};

    source.forEach(function (r) {
      var key = r.gln || r.ad;
      if (!key) return;
      var adet = parseInt(r.adet, 10) || 0;

      if (!eczMap[key]) {
        eczMap[key] = {
          gln: r.gln || '', eczane: r.ad || '',
          brick: r.brick || '', ttt: r.ttt || '',
          ayToplam: {},      // ay → toplam kutu
          urunAyMap: {}      // urun → { ay → kutu }
        };
      }
      var e = eczMap[key];
      if (r.brick) e.brick = r.brick;
      if (r.ttt)   e.ttt   = r.ttt;
      if (r.ay) {
        e.ayToplam[r.ay] = (e.ayToplam[r.ay] || 0) + adet;
        if (r.urun) {
          if (!e.urunAyMap[r.urun]) e.urunAyMap[r.urun] = {};
          e.urunAyMap[r.urun][r.ay] = (e.urunAyMap[r.urun][r.ay] || 0) + adet;
        }
      }
    });

    var profiles = [];

    Object.keys(eczMap).forEach(function (key) {
      try {
        var e = eczMap[key];

        // Sıralı ay listesi (TÜM AYLAR)
        var allMonths = Object.keys(e.ayToplam).sort(function (a, b) {
          return _monthNum(a) - _monthNum(b);
        });
        if (!allMonths.length) return;

        var sales = allMonths.map(function (ay) { return e.ayToplam[ay] || 0; });

        // Temel istatistikler
        var totalBoxes    = sales.reduce(function (s, v) { return s + v; }, 0);
        var activeMonths  = sales.filter(function (v) { return v > 0; }).length;
        var inactiveMonths= sales.length - activeMonths;
        var nonZeroSales  = sales.filter(function (v) { return v > 0; });
        var avgMonthlyBoxes = activeMonths > 0 ? totalBoxes / activeMonths : 0;
        // FAZ 10.0: kampanya spike'ları çıkarılmış düzeltmeli ortalama (additive)
        var avgMonthlyBoxesAdj = _avgMonthlyBoxesAdjusted(sales);
        var historicalMax = nonZeroSales.length ? Math.max.apply(null, nonZeroSales) : 0;
        var historicalMin = nonZeroSales.length ? Math.min.apply(null, nonZeroSales) : 0;

        // Trend
        var trendSlope  = Math.round(_trendSlope(sales) * 100) / 100;
        var growthRate  = _growthRate(sales);

        // Consecutive
        var consecutiveGrowthMonths  = _consecutiveGrowth(sales);
        var consecutiveDeclineMonths = _consecutiveDecline(sales);
        var consecutiveZeroMonths    = _consecutiveZero(sales);

        // Classification
        var classification = _classify(sales);

        // Forecast + limiter
        var expectedOrderBoxes = _forecast(sales, historicalMax);
        var weightedBoxPrice = _weightedBoxPrice(e.urunAyMap);
        var expectedOrderValue = Math.round(expectedOrderBoxes * weightedBoxPrice);

        // Sipariş tarihi metrikleri
        var lastAy         = allMonths[allMonths.length - 1];
        var daysSince      = _daysSince(lastAy);
        var activeAyKeys   = allMonths.filter(function (ay) { return e.ayToplam[ay] > 0; });
        var avgOrderCycle  = _orderCycle(activeAyKeys);
        var daysToNextOrder= Math.max(0, avgOrderCycle - daysSince);
        var expectedOrderDate = _dateAfterDays(daysToNextOrder);

        // Reorder Probability
        var reorderProbability = _reorderProb({
          trendSlope:     trendSlope,
          sales:          sales,
          activeMonths:   activeMonths,
          totalMonths:    allMonths.length,
          growthRate:     growthRate,
          daysSinceLastOrder: daysSince,
          classification: classification
        });

        // Product affinity
        var productAffinityScore = _productAffinity(e.urunAyMap, allMonths);

        profiles.push({
          gln:                   e.gln,
          eczane:                e.eczane,
          brick:                 e.brick,
          ttt:                   e.ttt,
          totalBoxes:            totalBoxes,
          avgMonthlyBoxes:       Math.round(avgMonthlyBoxes * 10) / 10,
          avgMonthlyBoxesAdjusted: avgMonthlyBoxesAdj, // FAZ 10.0: spike-filtered
          historicalMaxBoxes:    historicalMax,
          historicalMinBoxes:    historicalMin,
          activeMonths:          activeMonths,
          inactiveMonths:        inactiveMonths,
          growthRate:            growthRate,
          trendSlope:            trendSlope,
          consecutiveGrowthMonths:  consecutiveGrowthMonths,
          consecutiveDeclineMonths: consecutiveDeclineMonths,
          consecutiveZeroMonths:    consecutiveZeroMonths,
          reorderProbability:    reorderProbability,
          expectedOrderBoxes:    expectedOrderBoxes,
          expectedOrderValue:    expectedOrderValue,
          opportunityScore:      0,    // normalizasyon sonrası doldurulur
          visitPriorityScore:    0,    // normalizasyon sonrası doldurulur
          classification:        classification,
          productAffinityScore:  productAffinityScore,
          nextOrderProducts:     _nextOrderProducts(e.urunAyMap, allMonths),
          daysSinceLastOrder:    daysSince,
          avgOrderCycle:         avgOrderCycle,
          daysToNextOrder:       daysToNextOrder,
          expectedOrderDate:     expectedOrderDate,
          // iç kullanım için ham değer
          _opportunityRaw:       _opportunityRaw(reorderProbability, expectedOrderBoxes, weightedBoxPrice)
        });
      } catch (_err) { /* null-safe */ }
    });

    // ── Normalize: opportunityScore (0-100) ────────────────────────────
    var maxOpp = profiles.reduce(function (m, p) { return Math.max(m, p._opportunityRaw); }, 1);
    profiles.forEach(function (p) {
      p.opportunityScore  = Math.round((p._opportunityRaw / maxOpp) * 100);
      p.visitPriorityScore = _visitPriority(
        p.opportunityScore,
        p.reorderProbability,
        p.daysSinceLastOrder,
        p.avgOrderCycle
      );
      delete p._opportunityRaw;
    });

    return profiles;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  TOP 30 — visitPriorityScore'a göre, CAMPAIGN_BUYER hariç
  // ══════════════════════════════════════════════════════════════════════

  function buildTop30Pharmacies(tttFilter) {
    // FAZ 8.1 — kanonik sıralama delegasyonu (PharmacyRanking yüklüyse)
    if (window.PharmacyRanking && typeof window.PharmacyRanking.rankPharmacies === 'function') {
      try {
        var ranked = window.PharmacyRanking.rankPharmacies(tttFilter);
        var candidates81 = ranked.filter(function (r) { return r.classification !== 'CAMPAIGN_BUYER'; });
        return candidates81.slice(0, 30).map(function (p, i) {
          return {
            rank: i + 1,
            gln: p.gln, eczane: p.eczane, brick: p.brick, ttt: p.representative,
            classification: p.classification,
            reorderProbability: p.reorderProbability,
            expectedOrderBoxes: p.forecastBoxes,
            expectedOrderValue: p.forecastValue,
            opportunityScore:   p.opportunityScore,
            visitPriorityScore: p.canonicalScore,
            expectedOrderDate:  p.expectedOrderDate,
            daysToNextOrder:    p.daysToNextOrder,
            daysSinceLastOrder: p.daysSinceLastOrder,
            avgMonthlyBoxes:    p.avgMonthlyBoxes,
            trendSlope:         p.trendSlope,
            growthRate:         p.growthRate,
            productAffinityScore: p.productAffinityScore,
            score:              p.canonicalScore,
            forecastBoxes:      p.forecastBoxes,
            momentum:           p.growthRate > 10 ? 'yükselen' : p.growthRate < -10 ? 'düşüş' : 'stabil',
            lostRisk:           (p.consecutiveZeroMonths || 0) >= 2,
            spikeFlag:          p.classification === 'CAMPAIGN_BUYER',
            reason:             _buildReason(p)
          };
        });
      } catch (_e) {
        console.warn('[PharmacyIntelligence] PharmacyRanking delege hata, legacy hesaba düşülüyor:', _e.message);
      }
    }
    var all = buildPharmacyProfiles(tttFilter);
    var candidates = all.filter(function (p) {
      return p.classification !== 'CAMPAIGN_BUYER' && p.totalBoxes > 0;
    });
    candidates.sort(function (a, b) { return b.visitPriorityScore - a.visitPriorityScore; });
    return candidates.slice(0, 30).map(function (p, i) {
      return {
        rank:               i + 1,
        gln:                p.gln,
        eczane:             p.eczane,
        brick:              p.brick,
        ttt:                p.ttt,
        classification:     p.classification,
        reorderProbability: p.reorderProbability,
        expectedOrderBoxes: p.expectedOrderBoxes,
        expectedOrderValue: p.expectedOrderValue,
        opportunityScore:   p.opportunityScore,
        visitPriorityScore: p.visitPriorityScore,
        expectedOrderDate:  p.expectedOrderDate,
        daysToNextOrder:    p.daysToNextOrder,
        daysSinceLastOrder: p.daysSinceLastOrder,
        avgMonthlyBoxes:    p.avgMonthlyBoxes,
        trendSlope:         p.trendSlope,
        growthRate:         p.growthRate,
        productAffinityScore: p.productAffinityScore,
        // eski alanlarla geriye dönük uyumluluk
        score:              p.visitPriorityScore,
        forecastBoxes:      p.expectedOrderBoxes,
        momentum:           p.trendSlope > 1 ? 'yükselen' : p.trendSlope < -1 ? 'düşüş' : 'stabil',
        lostRisk:           p.consecutiveZeroMonths >= 2,
        spikeFlag:          p.classification === 'CAMPAIGN_BUYER',
        reason:             _buildReason(p)
      };
    });
  }

  function _buildReason(p) {
    if (p.classification === 'GROWING')        return 'Son ' + p.consecutiveGrowthMonths + ' ay büyüme';
    if (p.classification === 'REGULAR_BUYER')  return 'Düzenli alış — sipariş zamanı yakın';
    if (p.classification === 'REACTIVATION')   return p.consecutiveZeroMonths + ' aydır sipariş yok — kazanım fırsatı';
    if (p.classification === 'AT_RISK')        return 'Son ' + p.consecutiveDeclineMonths + ' ay düşüş';
    if (p.trendSlope > 2)                      return 'Güçlü artış trendi (' + p.trendSlope + ' kutu/ay)';
    if (p.daysToNextOrder <= 7)                return 'Sipariş zamanı yaklaşıyor (' + p.daysToNextOrder + ' gün)';
    return 'Potansiyel fırsat';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  ANA ORKESTRASYON
  // ══════════════════════════════════════════════════════════════════════

  function runPharmacyIntelligence(tttFilter) {
    try {
      var _piCheck = (window.pharmacyActiveData && window.pharmacyActiveData.length > 0)
        ? window.pharmacyActiveData
        : (typeof ECZANE_RAW !== 'undefined' ? ECZANE_RAW : []);
      if (!_piCheck || !_piCheck.length) {
        console.warn('[PharmacyIntelligence] veri henüz yüklenmedi');
        return false;
      }

      var all   = buildPharmacyProfiles(tttFilter);
      var top30 = buildTop30Pharmacies(tttFilter);

      // PHASE 5.4: Visit tahminlerini LearningEngine'e kaydet
      if (window.LearningEngine && top30 && top30.length) {
        var _ayK = (function(){ var d=new Date(); return String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); })();
        top30.forEach(function(e) {
          var _topProd = (e.nextOrderProducts && e.nextOrderProducts.length)
            ? e.nextOrderProducts[0].urun : null;
          window.LearningEngine.recordPrediction({
            type:'visit', engine:'visit',
            pharmacy:e.eczane, product:_topProd, brick:e.brick, ttt:e.ttt,
            predictedQty:e.forecastBoxes||0,
            confidence:e.reorderProbability||75,
            meta:{ targetMonth:_ayK, rank:e.rank }
          });
        });
      }

      var risks = all
        .filter(function (p) { return p.consecutiveZeroMonths >= 2 || p.classification === 'AT_RISK'; })
        .sort(function (a, b) { return b.daysSinceLastOrder - a.daysSinceLastOrder; })
        .slice(0, 10);

      var opportunities = all
        .filter(function (p) { return p.classification === 'GROWING' || (p.reorderProbability >= 70 && p.daysToNextOrder <= 14); })
        .sort(function (a, b) { return b.opportunityScore - a.opportunityScore; })
        .slice(0, 10);

      window.PHARMACY_INTELLIGENCE = {
        profiles:      all,
        top30:         top30,
        risks:         risks,
        opportunities: opportunities,
        generatedAt:   new Date().toISOString(),
        tttFilter:     tttFilter || 'TÜMÜ'
      };

      console.log(
        '[PharmacyIntelligence] ✅ Phase 4.6.4:',
        all.length, 'profil |', top30.length, 'top30 |',
        risks.length, 'risk |', opportunities.length, 'fırsat'
      );
      return true;
    } catch (err) {
      console.error('[PharmacyIntelligence] Hata:', err);
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  AI CONTEXT — iki fonksiyon (geriye dönük + genişletilmiş)
  // ══════════════════════════════════════════════════════════════════════

  // Orijinal (geriye dönük uyumluluk — ai-context.js Phase 4.5 bloğu çağırır)
  function buildPharmacyContext(tttFilter) {
    return buildPharmacyIntelligenceContext(tttFilter);
  }

  // Genişletilmiş (Phase 4.6.4)
  function buildPharmacyIntelligenceContext(tttFilter) {
    try {
      var pi = window.PHARMACY_INTELLIGENCE;

      if (!pi || !pi.top30 || !pi.top30.length || pi.tttFilter !== (tttFilter || 'TÜMÜ')) {
        runPharmacyIntelligence(tttFilter);
        pi = window.PHARMACY_INTELLIGENCE;
      }

      if (!pi || !pi.top30 || !pi.top30.length) {
        return '\n\n--- PHARMACY INTELLIGENCE (4.6.4) ---\n(Veri yok)';
      }

      var lines = [
        '',
        '--- PHARMACY INTELLIGENCE (Phase 4.6.4) ---',
        'Üretim: ' + (pi.generatedAt ? pi.generatedAt.slice(0, 10) : '—'),
        'Toplam profil: ' + pi.profiles.length,
        '',
        'İLK 30 ZİYARET ÖNCELİĞİ'
      ];

      pi.top30.forEach(function (e) {
        // Sadece affinity skoru yüksek ürünleri göster
        var highAffinity = [];
        if (e.productAffinityScore) {
          PRODUCTS.forEach(function (u) {
            if ((e.productAffinityScore[u] || 0) >= 50) highAffinity.push(u + ':' + e.productAffinityScore[u]);
          });
        }

        lines.push(
          '#' + e.rank + ' ' + e.eczane + ' [' + e.brick + ']' +
          '\n  Sınıf: '         + e.classification +
          ' | Visit Öncelik: ' + e.visitPriorityScore +
          ' | Sipariş %: '     + e.reorderProbability +
          '\n  Beklenen kutu: ' + e.expectedOrderBoxes +
          ' | Fırsat skoru: '  + e.opportunityScore +
          ' | Beklenen tarih: '+ e.expectedOrderDate +
          (highAffinity.length ? '\n  Ürün affinitesi: ' + highAffinity.join(', ') : '')
        );
      });

      var totalForecast = pi.top30.reduce(function (s, e) { return s + (e.expectedOrderBoxes || 0); }, 0);
      lines.push('');
      lines.push('TOP 30 Toplam Potansiyel: ' + totalForecast + ' kutu');

      if (pi.risks && pi.risks.length) {
        lines.push('');
        lines.push('⚠ KAYIP RİSKİ (' + pi.risks.length + ' eczane):');
        pi.risks.slice(0, 5).forEach(function (r) {
          lines.push('  ' + r.eczane + ' [' + r.brick + '] — ' + r.daysSinceLastOrder + ' gündür sipariş yok');
        });
      }

      if (pi.opportunities && pi.opportunities.length) {
        lines.push('');
        lines.push('💡 FIRSATLAR (' + pi.opportunities.length + '):');
        pi.opportunities.slice(0, 5).forEach(function (o) {
          lines.push('  ' + o.eczane + ' [' + o.brick + '] — ' + o.expectedOrderBoxes + ' kutu / Opp: ' + o.opportunityScore);
        });
      }

      return lines.join('\n');

    } catch (err) {
      console.warn('[PharmacyIntelligence] context hata:', err.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  DASHBOARD KARTI — "İlk 30 Ziyaret Önceliği"
  // ══════════════════════════════════════════════════════════════════════

  function renderPharmacyIntelligenceCard(containerId, tttFilter) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var ok = runPharmacyIntelligence(tttFilter);
    var pi = window.PHARMACY_INTELLIGENCE;

    if (!ok || !pi || !pi.top30 || !pi.top30.length) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim)">⏳ Veri yükleniyor…</div>';
      return;
    }

    var totalForecast = pi.top30.reduce(function (s, e) { return s + (e.expectedOrderBoxes || 0); }, 0);
    var avgVisit      = Math.round(pi.top30.reduce(function (s, e) { return s + e.visitPriorityScore; }, 0) / pi.top30.length);

    var _clsBadge = function (cls) {
      var m = {
        REGULAR_BUYER:  { bg: '#EFF6FF', c: '#1D4ED8', l: '✓ Düzenli'   },
        GROWING:        { bg: '#DCFCE7', c: '#15803D', l: '↑ Büyüyen'   },
        AT_RISK:        { bg: '#FEE2E2', c: '#DC2626', l: '⚠ Risk'      },
        REACTIVATION:   { bg: '#F3E8FF', c: '#7C3AED', l: '🔄 Kazanım'  },
        CAMPAIGN_BUYER: { bg: '#FEF3C7', c: '#D97706', l: '⚡ Kampanya' },
        OTHER:          { bg: '#F1F5F9', c: '#64748B', l: 'Diğer'       }
      };
      var x = m[cls] || m['OTHER'];
      return '<span style="font-size:9px;font-weight:700;background:' + x.bg +
             ';color:' + x.c + ';border-radius:4px;padding:1px 6px">' + x.l + '</span>';
    };

    var _probBar = function (p) {
      var bg = p >= 70 ? '#16A34A' : p >= 45 ? '#D97706' : '#DC2626';
      return '<div style="display:flex;align-items:center;gap:4px;justify-content:center">' +
        '<div style="width:40px;height:5px;border-radius:3px;background:#E2E8F0;overflow:hidden">' +
          '<div style="height:100%;width:' + p + '%;background:' + bg + ';border-radius:3px"></div>' +
        '</div>' +
        '<span style="font-size:10px;font-weight:800">%' + p + '</span>' +
      '</div>';
    };

    var _oppColor = function (s) { return s >= 70 ? '#521FD1' : s >= 40 ? '#0891B2' : '#64748B'; };

    // Ürün sipariş yakınlık badge'i
    var _productOrderBadge = function (nextProds) {
      if (!nextProds || !nextProds.length) return '';
      // En yakın 3 ürünü göster
      return nextProds.slice(0, 3).map(function (p) {
        var sn = p.urun.replace('GRİPORT COLD','GRP').replace('ACİDPASS','ACP')
                       .replace('PANOCER','PAN').replace('MOKSEFEN','MKS').replace('FAMTREC','FAM');
        var bg, col;
        if (p.overdue)       { bg = '#FEE2E2'; col = '#DC2626'; }
        else if (p.urgent)   { bg = '#FEF3C7'; col = '#B45309'; }
        else                 { bg = '#F1F5F9'; col = '#475569'; }
        return '<span style="font-size:8px;font-weight:700;background:' + bg + ';color:' + col +
               ';border-radius:3px;padding:1px 5px;white-space:nowrap">' +
               sn + ' ' + (p.overdue ? '⚡' : '') + p.label + (p.kutu ? ' ~' + p.kutu + 'K' : '') +
               '</span>';
      }).join(' ');
    };
    // Affinity badge (eski — yedek)
    var _affinityBadge = function (aff) {
      if (!aff) return '';
      var sorted = PRODUCTS
        .map(function (u) { return { u: u, s: aff[u] || 0 }; })
        .filter(function (x) { return x.s >= 40; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 2);
      return sorted.map(function (x) {
        var shortName = x.u.replace('GRİPORT COLD', 'GRP').replace('ACİDPASS', 'ACP')
                          .replace('PANOCER', 'PAN').replace('MOKSEFEN', 'MKS').replace('FAMTREC', 'FAM');
        return '<span style="font-size:8px;background:#F1F5F9;color:#475569;border-radius:3px;padding:1px 4px">' + shortName + ':' + x.s + '</span>';
      }).join(' ');
    };

    var rows = pi.top30.map(function (e) {
      var orderIn = e.daysToNextOrder <= 0
        ? '<span style="color:#DC2626;font-weight:800;font-size:10px">⚡ Bugün!</span>'
        : e.daysToNextOrder <= 7
          ? '<span style="color:#D97706;font-weight:700;font-size:10px">' + e.daysToNextOrder + ' gün</span>'
          : '<span style="color:var(--dim);font-size:10px">' + e.daysToNextOrder + ' gün</span>';

      return '<tr>' +
        '<td style="font-weight:800;color:var(--c1);text-align:center;font-size:12px">' + e.rank + '</td>' +
        '<td style="font-weight:600;font-size:11px">' + e.eczane + '<br>' +
          _productOrderBadge(e.nextOrderProducts) + '</td>' +
        '<td style="font-size:10px;color:var(--dim)">' + e.brick + '</td>' +
        '<td style="text-align:center">' + _clsBadge(e.classification) + '</td>' +
        '<td style="text-align:center">' + _probBar(e.reorderProbability) + '</td>' +
        '<td style="text-align:center;font-weight:700;color:#0891B2;font-size:12px">' + e.expectedOrderBoxes + '</td>' +
        '<td style="text-align:center;font-weight:800;font-size:13px;color:' + _oppColor(e.opportunityScore) + '">' + e.opportunityScore + '</td>' +
        '<td style="text-align:center;font-weight:800;font-size:13px;color:var(--c1)">' + e.visitPriorityScore + '</td>' +
        '<td style="text-align:center">' + orderIn + '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-badge">' + pi.top30.length + ' eczane</span>' +
          '<span class="card-badge" style="background:#EFF6FF;color:#1D4ED8">' +
            '📦 Tahmin: ' + totalForecast + ' kutu</span>' +
          '<span class="card-badge" style="background:#F0FDF4;color:#15803D">' +
            'Ort. öncelik: ' + avgVisit + '</span>' +
        '</div>' +
        '<div class="card-body-0 scroll-x">' +
          '<table class="tbl" style="min-width:860px">' +
            '<thead><tr>' +
              '<th style="text-align:center;width:32px">#</th>' +
              '<th>Eczane</th>' +
              '<th>Brick</th>' +
              '<th style="text-align:center">Sınıf</th>' +
              '<th style="text-align:center">Reorder %</th>' +
              '<th style="text-align:center">Beklenen Kutu</th>' +
              '<th style="text-align:center">Fırsat</th>' +
              '<th style="text-align:center">Ziyaret Önc.</th>' +
              '<th style="text-align:center">Sipariş Ne Zaman</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════

  window.buildPharmacyProfiles              = buildPharmacyProfiles;
  window.buildTop30Pharmacies               = buildTop30Pharmacies;
  window.runPharmacyIntelligence            = runPharmacyIntelligence;
  window.buildPharmacyContext               = buildPharmacyContext;
  window.buildPharmacyIntelligenceContext   = buildPharmacyIntelligenceContext;
  window.renderPharmacyIntelligenceCard     = renderPharmacyIntelligenceCard;
  // FAZ 10.0: kampanya spike işaretleme (public — FAZ 9.4 Digital Twin'de de kullanılabilir)
  window.flagStockBuildMonths               = flagStockBuildMonths;

  window._PI464_LOADED             = true;
  window._PHARMACY_INTELLIGENCE_READY = true;

  console.log('[PharmacyIntelligence] ✅ Phase 4.6.4 yüklendi');

})();
