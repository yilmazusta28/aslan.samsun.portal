// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/pharmacy-behavior-engine.js
//  FAZ 6.1 — Pharmacy Behavior Engine
//  FAZ 8.0 — Kırık referans düzeltmesi: js/pharmacy-behavior/ → js/ai/core/
//  FAZ 9.0 — 9 Davranış Tipi tam implementasyon (iskelet genişletildi)
//
//  Sorumluluk: Eczane satın alma davranışını öğrenir ve 9 tiple sınıflandırır.
//
//  9 DAVRANIŞ TİPİ (ÖZEL MASTER PROMPT §7):
//    1. RUTIN_SIPARIS     — Rutin Siparişçi      (≈REGULAR_BUYER) low-variance
//    2. KAMPANYA_ODAKLI   — Kampanya Odaklı       (≈CAMPAIGN_BUYER) promo spikes
//    3. STOKCU            — Stokçu               (YENİ) az-sıklık, yüksek-miktar
//    4. FIRSATCI          — Fırsatçı             (YENİ) yalnızca promo dönemde
//    5. MEVSIMSEL         — Mevsimsel            (YENİ) belirli aylarda tekrar sıçrama
//    6. YENI_MUSTERI      — Yeni Müşteri          (YENİ) activeMonths <= 3
//    7. DUSUK_HACIMLI     — Düşük Hacimli Sürekli (YENİ) düşük avg + düşük varyans
//    8. TEMSILCI_BAGIMLI  — Temsilci Bağımlı      (YENİ) FAZ 9.2 verisine bağımlı
//    9. TEMSILCISIZ_DUZENLI — Temsilcisiz Düzenli (YENİ) FAZ 9.2 verisine bağımlı
//
//  Mevcut 5 sınıf (reorder-classifier.js ile uyumlu — geriye dönük):
//    REGULAR_BUYER, GROWING, AT_RISK, REACTIVATION, CAMPAIGN_BUYER
//  → `classification` alanında korunuyor, `behaviorType` yeni alandır.
//
//  Public API:
//    buildBehaviorProfiles(tttFilter) → BehaviorProfile[]
//    classifyBehavior(eczaneRecord)   → { behaviorType, confidence, secondaryType, evidenceFields }
//    clearCache()
//
//  Veri yoksa (mevsimsellik 12 ay gerektirir vs) HATA değil "veri yetersiz" döner.
//  FAZ 9.2 Coverage Selection verisi olmadan TEMSILCI_BAGIMLI/TEMSILCISIZ_DUZENLI
//  tipleri BELİRSİZ döner — hata fırlatmaz.
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._PHARMACY_BEHAVIOR_ENGINE_LOADED) {
    console.warn('[pharmacy-behavior-engine] Zaten yüklü — atlandı');
    return;
  }
  window._PHARMACY_BEHAVIOR_ENGINE_LOADED = true;

  // ── Sabitler ──────────────────────────────────────────────────────────
  var BEHAVIOR_TYPES = {
    RUTIN_SIPARIS:        'RUTIN_SIPARIS',
    KAMPANYA_ODAKLI:      'KAMPANYA_ODAKLI',
    STOKCU:               'STOKCU',
    FIRSATCI:             'FIRSATCI',
    MEVSIMSEL:            'MEVSIMSEL',
    YENI_MUSTERI:         'YENI_MUSTERI',
    DUSUK_HACIMLI:        'DUSUK_HACIMLI',
    TEMSILCI_BAGIMLI:     'TEMSILCI_BAGIMLI',
    TEMSILCISIZ_DUZENLI:  'TEMSILCISIZ_DUZENLI',
    BELIRSIZ:             'BELIRSIZ',
    VERI_YETERSIZ:        'VERI_YETERSIZ'
  };

  // 9 tip → 5 eski sınıf eşlemesi (geriye dönük uyumluluk)
  var BEHAVIOR_TO_LEGACY = {
    RUTIN_SIPARIS:        'REGULAR_BUYER',
    KAMPANYA_ODAKLI:      'CAMPAIGN_BUYER',
    STOKCU:               'CAMPAIGN_BUYER',
    FIRSATCI:             'CAMPAIGN_BUYER',
    MEVSIMSEL:            'REGULAR_BUYER',
    YENI_MUSTERI:         'GROWING',
    DUSUK_HACIMLI:        'REGULAR_BUYER',
    TEMSILCI_BAGIMLI:     'REGULAR_BUYER',
    TEMSILCISIZ_DUZENLI:  'REGULAR_BUYER',
    BELIRSIZ:             'REGULAR_BUYER',
    VERI_YETERSIZ:        'AT_RISK'
  };

  var _cache = {};

  // ── Yardımcı: Varyasyon Katsayısı (CV) ────────────────────────────────
  function _cv(vals) {
    var nonZero = vals.filter(function (v) { return v > 0; });
    if (nonZero.length < 2) return 0;
    var mean = nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length;
    if (mean === 0) return 0;
    var variance = nonZero.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0) / nonZero.length;
    return Math.sqrt(variance) / mean;
  }

  // ── Yardımcı: Trend eğimi ──────────────────────────────────────────────
  function _trendSlope(vals) {
    var n = vals.length;
    if (n < 2) return 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    vals.forEach(function (v, i) { sumX += i; sumY += v; sumXY += i * v; sumX2 += i * i; });
    var denom = n * sumX2 - sumX * sumX;
    return denom ? (n * sumXY - sumX * sumY) / denom : 0;
  }

  // ── Yardımcı: Ay farkı (sipariş döngüsü) ─────────────────────────────
  function _daysSinceMonth(monthStr) {
    try {
      if (monthStr && monthStr.indexOf('/') !== -1) {
        var parts = monthStr.split('/');
        var d = new Date(parseInt(parts[1], 10), parseInt(parts[0], 10) - 1, 28);
        return Math.round((Date.now() - d.getTime()) / 86400000);
      }
    } catch (e) { /* ignore */ }
    return 60;
  }

  // ── Yardımcı: Mevsimsel sıçrama tespiti ──────────────────────────────
  // 12+ aylık veri olmalı. Aynı takvim ayının birden fazla yıldaki değeri
  // diğer aylara göre tutarlı yüksekse mevsimsel kabul edilir.
  function _detectSeasonality(monthsObj, sortedMonths) {
    if (!sortedMonths || sortedMonths.length < 12) return { seasonal: false, reason: 'veri_yetersiz' };
    var byCalMonth = {}; // 1-12 → values[]
    sortedMonths.forEach(function (mk) {
      var v = monthsObj[mk] || 0;
      var mo = parseInt(mk.split('/')[0], 10);
      if (!byCalMonth[mo]) byCalMonth[mo] = [];
      byCalMonth[mo].push(v);
    });
    var allVals = sortedMonths.map(function (mk) { return monthsObj[mk] || 0; });
    var globalMean = allVals.reduce(function (s, v) { return s + v; }, 0) / (allVals.length || 1);
    if (globalMean === 0) return { seasonal: false, reason: 'veri_yetersiz' };
    var peakMonths = [];
    Object.keys(byCalMonth).forEach(function (mo) {
      var monthVals = byCalMonth[mo];
      var monthMean = monthVals.reduce(function (s, v) { return s + v; }, 0) / monthVals.length;
      if (monthMean > globalMean * 1.5 && monthVals.length >= 2) {
        peakMonths.push(parseInt(mo, 10));
      }
    });
    return { seasonal: peakMonths.length > 0, peakMonths: peakMonths, reason: peakMonths.length ? 'peak_detected' : 'no_peak' };
  }

  // ── Yardımcı: Büyük sipariş aralığı tespiti (Stokçu) ─────────────────
  // Düşük frekans (az aktif ay) + yüksek miktarlı siparişler
  function _isStokcu(vals) {
    var nonZero = vals.filter(function (v) { return v > 0; });
    if (nonZero.length < 2) return false;
    var freq = nonZero.length / vals.length; // 0-1 (düşük = nadir sipariş)
    var meanNZ = nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length;
    var cv = _cv(vals);
    // Düşük sıklık (<%50 aktif ay) + yüksek ortalama + düşük varyans içi
    return freq < 0.5 && meanNZ > 50 && cv < 0.8;
  }

  // ── Yardımcı: Fırsatçı tespiti ────────────────────────────────────────
  // Sadece rakip kampanya dönemlerinde sipariş veriyor.
  // CompetitiveAdapter yüklüyse kampanya dönemlerini çapraz kontrol et.
  function _isFirsatci(vals, sortedMonths) {
    if (!window.CompetitiveAdapter || typeof window.CompetitiveAdapter.normalizeCompetitive !== 'function') {
      return false; // veri yok, kesin karar verilemiyor
    }
    try {
      var compData = window.CompetitiveAdapter.normalizeCompetitive();
      var actions  = (compData && compData.competitorActions) || [];
      var campaignMonths = {};
      actions.forEach(function (a) {
        if (a.kampanya && a.ay) campaignMonths[a.ay] = true;
      });
      if (Object.keys(campaignMonths).length === 0) return false;
      // Siparişlerin çoğu kampanya aylarına denk geliyor mu?
      var nonZeroMonths = sortedMonths.filter(function (mk, i) { return vals[i] > 0; });
      var monthNames    = nonZeroMonths.map(function (mk) { return mk.split('/')[0]; });
      var campaignHits  = monthNames.filter(function (m) {
        // Türkçe ay adı → sayı eşlemesi
        var TR_MONTHS = { '01':'OCAK','02':'ŞUBAT','03':'MART','04':'NİSAN','05':'MAYIS','06':'HAZİRAN',
          '07':'TEMMUZ','08':'AĞUSTOS','09':'EYLÜL','10':'EKİM','11':'KASIM','12':'ARALIK' };
        var trName = TR_MONTHS[m] || m;
        return campaignMonths[trName] || campaignMonths[m];
      });
      return monthNames.length > 0 && (campaignHits.length / monthNames.length) > 0.7;
    } catch (e) { return false; }
  }

  // ── Yardımcı: Reorder olasılığı ──────────────────────────────────────
  // BUG DÜZELTMESİ: Bu fonksiyon eskiden 0-1 ölçeğinde (max 0.95) bir
  // değer döndürüyordu — ama projedeki HERKES (route-optimizer.js
  // eşikleri >85/>=50/>=60, reorder-classifier.js, reorder-engine.js,
  // autonomous-planning-engine.js, ai-sales-coach-v2.js, confidence-meter/
  // probBar render fonksiyonları, hatta bu dosyanın kendi legacy ikizi
  // pharmacy-intelligence.js._reorderProb) 0-100 ÖLÇEĞİ bekliyor/üretiyor.
  // PharmacyBehaviorEngine HER ZAMAN yüklü olduğundan bu fonksiyonun
  // çıktısı UYGULAMADA GERÇEKTEN AKTİF OLAN değerdi — yani "Sipariş
  // Olasılığı" her yerde neredeyse sıfır görünüyordu (örn. gerçek %72
  // yerine "0.72" değeri >85 eşiğini hiç geçemiyor, %-bar'ı görünmez
  // kalıyordu). Artık 0-100 tam sayı döndürüyor — projedeki tek gerçek
  // konvansiyona uyumlu.
  function _reorderProb(activeMonths, totalMonths, daysSince, avgCycle, growthRate) {
    if (!totalMonths) return 0;
    var activityRatio = activeMonths / totalMonths;
    var recencyFactor = avgCycle > 0 ? Math.max(0, 1 - daysSince / (avgCycle * 1.5)) : 0.5;
    var growthBonus   = growthRate > 10 ? 0.05 : 0;
    var prob = activityRatio * 0.6 + recencyFactor * 0.4 + growthBonus;
    return Math.min(95, Math.max(0, Math.round(prob * 100)));
  }

  // ── Yardımcı: Legacy 5-sınıf belirleme ─────────────────────────────
  // reorder-classifier.js kurallarıyla uyumlu (geriye dönük compat)
  function _legacyClassify(vals) {
    if (!vals.length) return 'AT_RISK';
    var nonZero = vals.filter(function (v) { return v > 0; });
    if (!nonZero.length) return 'AT_RISK';
    var last = vals[vals.length - 1] || 0;
    var mean = nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length;

    // CAMPAIGN_BUYER: son ay > önceki ort × 3
    if (vals.length >= 2) {
      var prevMean = nonZero.slice(0, -1).reduce(function (s, v) { return s + v; }, 0) / (nonZero.length - 1 || 1);
      if (last > prevMean * 3) return 'CAMPAIGN_BUYER';
    }
    // REACTIVATION: geçmişte yüksek (≥50), son 2 ay sıfır/düşük
    if (mean >= 50) {
      var last2 = vals.slice(-2);
      if (last2.every(function (v) { return v < 10; })) return 'REACTIVATION';
    }
    // AT_RISK: son 3 ay sürekli düşüş
    if (vals.length >= 3) {
      var last3 = vals.slice(-3);
      if (last3[2] < last3[1] && last3[1] < last3[0] && last3[0] > 0) return 'AT_RISK';
    }
    // GROWING: son 3 ay sürekli artış
    if (vals.length >= 3) {
      var l3 = vals.slice(-3);
      if (l3[2] >= l3[1] * 0.9 && l3[1] >= l3[0] * 0.9 && l3[0] > 0) return 'GROWING';
    }
    return 'REGULAR_BUYER';
  }

  // ── TEMEL SINIFLANDIRMA FONKSİYONU ───────────────────────────────────
  // @param {object} r — { vals, activeMonths, totalMonths, sortedMonths, monthsObj,
  //                       growthRate, avgCycle, daysSince, avgMonthlyBoxes }
  // @returns {{ behaviorType, confidence, secondaryType, evidenceFields }}
  function classifyBehavior(r) {
    var vals         = r.vals || [];
    var active       = r.activeMonths || 0;
    var total        = r.totalMonths  || vals.length;
    var sortedMonths = r.sortedMonths || [];
    var monthsObj    = r.monthsObj    || {};
    var growthRate   = r.growthRate   || 0;
    var avgCycle     = r.avgCycle     || 30;
    var daysSince    = r.daysSince    || 60;
    var avg          = r.avgMonthlyBoxes || 0;

    if (!vals.length || active === 0) {
      return { behaviorType: BEHAVIOR_TYPES.VERI_YETERSIZ, confidence: 0,
        secondaryType: null, evidenceFields: ['vals_empty'] };
    }

    var cv        = _cv(vals);
    var slope     = _trendSlope(vals);
    var legacyClass = _legacyClassify(vals);
    var evidence  = [];

    // ── 1. Yeni Müşteri (öncelikli — az veri) ─────────────────────────
    if (active <= 3) {
      evidence.push('activeMonths=' + active);
      return { behaviorType: BEHAVIOR_TYPES.YENI_MUSTERI, confidence: 0.85,
        secondaryType: legacyClass, evidenceFields: evidence };
    }

    // ── 2. Stokçu (düşük frekans + yüksek miktar) ──────────────────────
    if (_isStokcu(vals)) {
      evidence.push('freq=' + Math.round(active / total * 100) + '%', 'avg=' + Math.round(avg));
      return { behaviorType: BEHAVIOR_TYPES.STOKCU, confidence: 0.75,
        secondaryType: legacyClass, evidenceFields: evidence };
    }

    // ── 3. Fırsatçı (yalnızca kampanya dönemlerinde) ────────────────────
    if (_isFirsatci(vals, sortedMonths)) {
      evidence.push('kampanya_eslesme>%70');
      return { behaviorType: BEHAVIOR_TYPES.FIRSATCI, confidence: 0.70,
        secondaryType: 'CAMPAIGN_BUYER', evidenceFields: evidence };
    }

    // ── 4. Kampanya Odaklı ──────────────────────────────────────────────
    if (legacyClass === 'CAMPAIGN_BUYER') {
      evidence.push('son_ay_sıçrama');
      return { behaviorType: BEHAVIOR_TYPES.KAMPANYA_ODAKLI, confidence: 0.80,
        secondaryType: 'CAMPAIGN_BUYER', evidenceFields: evidence };
    }

    // ── 5. Mevsimsel (12+ ay gerekli) ──────────────────────────────────
    if (sortedMonths.length >= 12) {
      var seasonal = _detectSeasonality(monthsObj, sortedMonths);
      if (seasonal.seasonal) {
        evidence.push('peak_months=' + (seasonal.peakMonths || []).join(','));
        return { behaviorType: BEHAVIOR_TYPES.MEVSIMSEL, confidence: 0.72,
          secondaryType: legacyClass, evidenceFields: evidence };
      }
    } else if (sortedMonths.length < 12) {
      // Mevsimsellik için veri yetersiz — işaretlenmiş ama kesin karar verilemiyor
      evidence.push('mevsimsel_veri_yetersiz=' + sortedMonths.length + '_ay');
    }

    // ── 6. Düşük Hacimli Sürekli Alıcı ─────────────────────────────────
    if (avg < 20 && cv < 0.5 && active > 3) {
      evidence.push('avg=' + Math.round(avg), 'cv=' + cv.toFixed(2));
      return { behaviorType: BEHAVIOR_TYPES.DUSUK_HACIMLI, confidence: 0.75,
        secondaryType: 'REGULAR_BUYER', evidenceFields: evidence };
    }

    // ── 7. Temsilci Bağımlı / Temsilcisiz — FAZ 9.2 verisine bağlı ────
    // CoverageSelection yüklüyse kontrol et, yoksa BELİRSİZ dön
    if (window.CoverageSelection && typeof window.CoverageSelection.getSelection === 'function') {
      try {
        var sel = window.CoverageSelection.getSelection(r.eczane);
        if (sel !== null && sel !== undefined) {
          var repDep = sel.selectedForVisit;
          evidence.push('coverage_selected=' + repDep);
          var type = repDep ? BEHAVIOR_TYPES.TEMSILCI_BAGIMLI : BEHAVIOR_TYPES.TEMSILCISIZ_DUZENLI;
          return { behaviorType: type, confidence: 0.65,
            secondaryType: legacyClass, evidenceFields: evidence };
        }
      } catch (e) { /* CoverageSelection hata — aşağıya düş */ }
    } else {
      evidence.push('faz9.2_bekleniyor=BELİRSİZ');
    }

    // ── 8. AT_RISK / REACTIVATION (legacy geçiş) ────────────────────────
    if (legacyClass === 'AT_RISK') {
      evidence.push('son3ay_düşüş');
      return { behaviorType: BEHAVIOR_TYPES.BELIRSIZ, confidence: 0.60,
        secondaryType: 'AT_RISK', evidenceFields: evidence };
    }
    if (legacyClass === 'REACTIVATION') {
      evidence.push('reaktivasyon_hedef');
      return { behaviorType: BEHAVIOR_TYPES.BELIRSIZ, confidence: 0.60,
        secondaryType: 'REACTIVATION', evidenceFields: evidence };
    }

    // ── 9. Rutin Siparişçi (varsayılan — düşük varyans, düzenli) ───────
    evidence.push('cv=' + cv.toFixed(2), 'slope=' + slope.toFixed(2));
    return { behaviorType: BEHAVIOR_TYPES.RUTIN_SIPARIS, confidence: 0.78,
      secondaryType: 'REGULAR_BUYER', evidenceFields: evidence };
  }

  var _FALLBACK_AVG_BOX_PRICE = 109; // pharmacy-intelligence.js AVG_BOX_PRICE ile TUTARLI

  // ── _bestBoxPrice — bir eczane için en doğru TL/kutu fiyatını seçer ───
  // BUG DÜZELTMESİ: forecastValue eskiden HER ZAMAN forecastBoxes * 150
  // (elle yazılmış, hiçbir yerde tanımlı olmayan sabit bir fiyat — hem
  // pharmacy-intelligence.js'in kendi AVG_BOX_PRICE'ı olan 109'dan hem de
  // gerçek IMS_TL_MAP fiyatlarından bağımsız) ile hesaplanıyordu. Bu değer
  // buildPharmacyProfiles() → _fromBehaviorProfile() üzerinden UYGULAMANIN
  // GERÇEKTEN KULLANDIĞI expectedOrderValue'ya dönüşüyordu (pharmacy-
  // intelligence.js'in KENDİ _legacyBuildPharmacyProfiles hesaplaması,
  // PharmacyBehaviorEngine her zaman yüklü olduğu için pratikte hiç
  // çalışmıyor — bu dosya asıl aktif yoldu).
  // Öncelik sırası: 1) bu eczane için GERÇEK faturalanmış TL/kutu
  // (PharmacyAdapter.averageUnitPrice — varsa en doğrusu), 2) ürün bazlı
  // IMS_TL_MAP ağırlıklı ortalama (monthsByProduct varsa), 3) düz bölgesel
  // ortalama (tutarlılık için pharmacy-intelligence.js'teki AYNI sabit).
  function _bestBoxPrice(record) {
    // 1) Gerçek faturalanmış ortalama fiyat
    var real = null;
    try {
      if (window.PharmacyAdapter && typeof window.PharmacyAdapter.averageUnitPrice === 'function') {
        real = window.PharmacyAdapter.averageUnitPrice(record);
      }
    } catch (e) { /* ignore */ }
    if (real != null && real > 0) return real;

    // 2) Ürün bazlı IMS_TL_MAP ağırlıklı ortalama
    if (record && record.monthsByProduct && typeof IMS_TL_MAP !== 'undefined') {
      var totalBoxes = 0, totalValue = 0;
      Object.keys(record.monthsByProduct).forEach(function (urun) {
        var ayMap = record.monthsByProduct[urun] || {};
        var urunBoxes = Object.keys(ayMap).reduce(function (s, ay) { return s + (ayMap[ay] || 0); }, 0);
        var price = IMS_TL_MAP[urun] || 0;
        if (price > 0) { totalBoxes += urunBoxes; totalValue += urunBoxes * price; }
      });
      if (totalBoxes > 0) return totalValue / totalBoxes;
    }

    // 3) Düz bölgesel ortalama (fallback)
    return _FALLBACK_AVG_BOX_PRICE;
  }

  // ── _opportunityRaw / _visitPriority ──────────────────────────────────
  // BUG DÜZELTMESİ: opportunityScore ve visitPriorityScore bu dosyada
  // (yani UYGULAMANIN GERÇEKTEN KULLANDIĞI aktif yolda) hep null
  // bırakılıyordu ("FAZ 9.4'te Digital Twin'den gelecek" notuyla — ama o
  // entegrasyon hiç tamamlanmadı, bkz. digital-twin-builder.js incelemesi).
  // Bunun etkisi sanılandan çok daha genişti:
  //   • route-optimizer.js'in ANA visitScore formülü: (vps×0.40)+(rp×0.25)+
  //     (opp×0.20)+(gap×0.15) — vps VE opp hep 0 olduğundan formülün
  //     AĞIRLIĞININ %60'I tamamen ölüydü.
  //   • route-optimizer.js'in "OPPORTUNITY" öncelik etiketi (opp>80) hiç
  //     tetiklenemiyordu.
  //   • autonomous-planning-engine.js'in visitScore'undaki "gap katkısı"
  //     (%25 ağırlık) hep 0'dı.
  //   • ai-sales-coach-v2.js'deki "YÜKSEK_FIRSAT" fırsat tipi hiç
  //     üretilemiyordu (opportunityScore>75 hiç gerçekleşmiyordu).
  // Çözüm: pharmacy-intelligence.js'in legacy (fallback) yolunda ZATEN
  // ÇALIŞAN VE KANITLANMIŞ olan AYNI formülleri buraya (aktif yola) taşıdık.
  function _opportunityRaw(reorderProb, expectedBoxes, boxPrice) {
    return (reorderProb / 100) * expectedBoxes * (boxPrice || _FALLBACK_AVG_BOX_PRICE);
  }

  function _visitPriority(opportunityScore, reorderProb, daysSince, avgOrderCycle) {
    var gap = avgOrderCycle > 0 ? daysSince / avgOrderCycle : 1;
    var gapContribution = Math.min(100, gap * 50);
    return Math.max(0, Math.min(100, Math.round(
      opportunityScore * 0.5 +
      reorderProb      * 0.3 +
      gapContribution  * 0.2
    )));
  }

  // ── buildBehaviorProfiles — PharmacyAdapter → BehaviorProfile[] ──────
  function buildBehaviorProfiles(tttFilter) {
    var cacheKey = tttFilter || '__all__';
    if (_cache[cacheKey]) return _cache[cacheKey];

    if (!window.PharmacyAdapter || typeof window.PharmacyAdapter.normalizePharmacy !== 'function') {
      console.warn('[pharmacy-behavior-engine] PharmacyAdapter yüklü değil');
      return [];
    }

    var records = window.PharmacyAdapter.normalizePharmacy(tttFilter);
    if (!records || !records.length) return [];

    var profiles = records.map(function (r) {
      var vals         = window.PharmacyAdapter.monthValuesArray(r.months, r.sortedMonths);
      var nonZero      = vals.filter(function (v) { return v > 0; });
      var total        = vals.reduce(function (s, v) { return s + v; }, 0);
      var activeMonths = nonZero.length;
      var inactiveMonths = vals.length - activeMonths;
      var avg          = activeMonths > 0 ? total / activeMonths : 0;
      var maxVal       = nonZero.length ? Math.max.apply(null, nonZero) : 0;
      var minVal       = nonZero.length ? Math.min.apply(null, nonZero) : 0;
      var slope        = _trendSlope(vals);

      // Büyüme oranı: ikinci yarı vs birinci yarı
      var halfLen = Math.floor(vals.length / 2);
      var growthRate = 0;
      if (halfLen > 0 && avg > 0) {
        var fh = vals.slice(0, halfLen).reduce(function (s, v) { return s + v; }, 0) / halfLen;
        var sh = vals.slice(halfLen).reduce(function (s, v) { return s + v; }, 0) / (vals.length - halfLen);
        growthRate = fh > 0 ? Math.round((sh - fh) / fh * 100) : 0;
      }

      // Ardışık değişimler
      var consGrowth = 0, consDecline = 0, consZero = 0;
      for (var i = vals.length - 1; i > 0; i--) {
        if (vals[i] === 0) consZero++; else break;
      }
      for (var j = vals.length - 1; j > 0; j--) {
        if (vals[j] > vals[j - 1]) consGrowth++; else break;
      }
      for (var k = vals.length - 1; k > 0; k--) {
        if (vals[k] < vals[k - 1]) consDecline++; else break;
      }

      // Sipariş döngüsü
      var lastMonth  = r.sortedMonths && r.sortedMonths[r.sortedMonths.length - 1];
      var daysSince  = lastMonth ? _daysSinceMonth(lastMonth) : 60;
      var avgCycle   = activeMonths > 1 ? Math.round(30 * (vals.length / activeMonths)) : 30;
      var daysToNext = Math.max(0, avgCycle - daysSince);

      // Reorder olasılığı
      var reorderProb = _reorderProb(activeMonths, vals.length, daysSince, avgCycle, growthRate);

      // 9 tip sınıflandırma
      var bResult = classifyBehavior({
        vals: vals, activeMonths: activeMonths, totalMonths: vals.length,
        sortedMonths: r.sortedMonths || [], monthsObj: r.months || {},
        growthRate: growthRate, avgCycle: avgCycle, daysSince: daysSince,
        avgMonthlyBoxes: avg, eczane: r.eczane
      });

      // Geriye dönük uyumluluk: classification = 5-sınıf
      var legacyCls = BEHAVIOR_TO_LEGACY[bResult.behaviorType] || _legacyClassify(vals);
      // GROWING / AT_RISK / REACTIVATION doğrudan legacy'den gelsin
      var legacyDirect = _legacyClassify(vals);
      if (legacyDirect === 'GROWING' || legacyDirect === 'AT_RISK' || legacyDirect === 'REACTIVATION') {
        legacyCls = legacyDirect;
      }

      var forecastBoxes = Math.max(0, Math.round(avg * 0.9));
      var boxPrice = _bestBoxPrice(r);

      return {
        gln:            r.gln,
        eczane:         r.eczane,
        brick:          r.brick,
        representative: r.representative,
        // Yeni FAZ 9.0 alanları
        behaviorType:   bResult.behaviorType,
        behaviorConfidence: bResult.confidence,
        secondaryType:  bResult.secondaryType,
        evidenceFields: bResult.evidenceFields,
        // Eski 5-sınıf (geriye dönük uyumluluk)
        classification:          legacyCls,
        reorderProbability:      reorderProb,
        forecastBoxes:           forecastBoxes,
        forecastValue:           Math.round(forecastBoxes * boxPrice),
        score:                   Math.round(reorderProb),
        totalBoxes:              total,
        avgMonthlyBoxes:         Math.round(avg * 10) / 10,
        historicalMaxBoxes:      maxVal,
        historicalMinBoxes:      minVal,
        activeMonths:            activeMonths,
        inactiveMonths:          inactiveMonths,
        growthRate:              growthRate,
        trendSlope:              Math.round(slope * 100) / 100,
        consecutiveGrowthMonths:  consGrowth,
        consecutiveDeclineMonths: consDecline,
        consecutiveZeroMonths:    consZero,
        opportunityScore:        0,      // aşağıda normalizasyon sonrası doldurulur
        visitPriorityScore:      0,      // aşağıda normalizasyon sonrası doldurulur
        _opportunityRaw:         _opportunityRaw(reorderProb, forecastBoxes, boxPrice),
        productAffinityScore:    null,
        nextOrderProducts:       [],
        daysSinceLastOrder:      daysSince,
        avgOrderCycle:           avgCycle,
        daysToNextOrder:         daysToNext,
        expectedOrderDate:       null
      };
    });

    // ── Normalize: opportunityScore (0-100) — pharmacy-intelligence.js'in
    //    legacy yoluyla AYNI yöntem: batch içindeki en yüksek ham değere
    //    göre normalize edilir.
    var maxOpp = profiles.reduce(function (m, p) { return Math.max(m, p._opportunityRaw); }, 1);
    profiles.forEach(function (p) {
      p.opportunityScore   = Math.round((p._opportunityRaw / maxOpp) * 100);
      p.visitPriorityScore = _visitPriority(p.opportunityScore, p.reorderProbability, p.daysSinceLastOrder, p.avgOrderCycle);
      delete p._opportunityRaw;
    });

    _cache[cacheKey] = profiles;
    return profiles;
  }

  function clearCache() { _cache = {}; }

  window.PharmacyBehaviorEngine = {
    buildBehaviorProfiles: buildBehaviorProfiles,
    classifyBehavior:      classifyBehavior,
    BEHAVIOR_TYPES:        BEHAVIOR_TYPES,
    clearCache:            clearCache,
    version:               '9.0'
  };

  console.debug('[pharmacy-behavior-engine] FAZ 9.0 yüklendi — 9 davranış tipi aktif.');

})();
