// ══════════════════════════════════════════════════════════════════════
//  js/pharmacy/reorder-classifier.js — PHASE 4.6.1
//  Reorder Classification Engine
//
//  Sorumluluk:
//    • classifyAllPharmacies(ttt)      → tüm eczaneleri sınıflandır
//    • buildClassifierTop30(ttt)       → "Bu Hafta Siparişe En Yakın 30 Eczane" tablosu
//    • buildReorderClassifierContext(t)→ AI context metni (ai-context.js'e eklenir)
//    • renderClassifierTop30Card(id,t) → dashboard kartı
//
//  Çıktı objesi (her eczane):
//    { eczane, brick, classification, reorderProbability, forecastBoxes, score }
//
//  Sınıflandırma kuralları:
//    REGULAR_BUYER   → son 4 ay satış varyansı düşük (CV < 0.30)
//    GROWING         → son 3 ay sürekli artış (her ay >= önceki * 0.90)
//    AT_RISK         → son 3 ay sürekli düşüş (her ay <= önceki * 1.05, düşüş net)
//    REACTIVATION    → geçmişte yüksek satış (>=50 kutu), son 2 ay sıfır veya çok düşük
//    CAMPAIGN_BUYER  → son ay satış > önceki ortalamanın 3 katı
//
//  Global bağımlılıklar:
//    ECZANE_RAW, eczaneLoaded                    (data-loader.js / data-state.js)
//    window.REORDER_INTELLIGENCE (opsiyonel)     (reorder-engine.js, Phase 4.6)
//
//  Yükleme sırası: reorder-engine.js SONRASI, ai-context.js ÖNCESI
//  GitHub Pages compatible: classic script, IIFE, no ES modules
// ══════════════════════════════════════════════════════════════════════

'use strict';

(function () {

  // ── 1. Guard: çift yüklemeyi önle ───────────────────────────────────
  if (window._REORDER_CLASSIFIER_LOADED) {
    console.warn('[ReorderClassifier] Zaten yüklü — atlandı');
    return;
  }

  // ── 2. Global State ─────────────────────────────────────────────────
  window.REORDER_CLASSIFIER = {
    all:            [],    // tüm sınıflandırılmış eczaneler
    top30:          [],    // siparişe en yakın 30
    byClass:        {
      REGULAR_BUYER:  [],
      GROWING:        [],
      AT_RISK:        [],
      REACTIVATION:   [],
      CAMPAIGN_BUYER: [],
      OTHER:          []
    },
    generatedAt:    null,
    tttFilter:      null
  };

  // ── 3. Yardımcı: Ay string → sıralama sayısı ────────────────────────
  function _monthToNum(ayStr) {
    if (!ayStr) return 0;
    var p = String(ayStr).split('/');
    if (p.length < 2) return 0;
    return parseInt(p[1], 10) * 100 + parseInt(p[0], 10);
  }

  // ── 4. Yardımcı: Coefficient of Variation ───────────────────────────
  function _calcCV(arr) {
    if (!arr || arr.length < 2) return 1;
    var n    = arr.length;
    var mean = arr.reduce(function (s, v) { return s + v; }, 0) / n;
    if (mean === 0) return 1;
    var variance = arr.reduce(function (s, v) {
      return s + Math.pow(v - mean, 2);
    }, 0) / n;
    return Math.sqrt(variance) / mean;
  }

  // ── 5. Sınıflandırma Motoru ──────────────────────────────────────────
  // Öncelik sırası: CAMPAIGN > REACTIVATION > GROWING > AT_RISK > REGULAR_BUYER > OTHER
  function _classify461(monthlySales) {
    if (!monthlySales || !monthlySales.length) return 'OTHER';

    var len    = monthlySales.length;
    var last   = monthlySales[len - 1] || 0;
    var prev   = len >= 2 ? (monthlySales[len - 2] || 0) : 0;

    // ─ CAMPAIGN_BUYER ─────────────────────────────────────────────────
    // Son ay satış > önceki ortalamadan 3 kat fazla
    if (len >= 3) {
      var prevMonths = monthlySales.slice(0, len - 1).filter(function (v) { return v > 0; });
      if (prevMonths.length > 0) {
        var prevAvg = prevMonths.reduce(function (s, v) { return s + v; }, 0) / prevMonths.length;
        if (prevAvg > 0 && last >= prevAvg * 3) {
          return 'CAMPAIGN_BUYER';
        }
      }
    }

    // ─ REACTIVATION ───────────────────────────────────────────────────
    // Son 2 ay sıfır veya çok düşük, geçmişte en az 1 ay >= 50 kutu
    if (len >= 3) {
      var last2Low   = last <= 5 && prev <= 5;
      var hadHistory = monthlySales.slice(0, len - 2).some(function (v) { return v >= 50; });
      if (last2Low && hadHistory) return 'REACTIVATION';
    }

    // ─ GROWING ────────────────────────────────────────────────────────
    // Son 3 ay sürekli artış (her ay >= bir önceki * 0.90 toleranslı, net yükseliş)
    if (len >= 3) {
      var last3    = monthlySales.slice(Math.max(0, len - 3));
      var rising   = true;
      for (var i = 1; i < last3.length; i++) {
        if (last3[i] < last3[i - 1] * 0.90) { rising = false; break; }
      }
      // Net yükseliş: son ay > ilk ay
      if (rising && last3[last3.length - 1] > last3[0]) return 'GROWING';
    }

    // ─ AT_RISK ────────────────────────────────────────────────────────
    // Son 3 ay sürekli düşüş (her ay <= bir önceki * 1.05, düşüş net)
    if (len >= 3) {
      var last3r  = monthlySales.slice(Math.max(0, len - 3));
      var falling = true;
      for (var j = 1; j < last3r.length; j++) {
        if (last3r[j] > last3r[j - 1] * 1.05) { falling = false; break; }
      }
      if (falling && last3r[last3r.length - 1] < last3r[0]) return 'AT_RISK';
    }

    // ─ REGULAR_BUYER ──────────────────────────────────────────────────
    // Son 4 ay varyansı düşük (CV < 0.30) + yeterli aktiflik
    var last4 = monthlySales.slice(Math.max(0, len - 4)).filter(function (v) { return v > 0; });
    if (last4.length >= 3 && _calcCV(last4) < 0.30) return 'REGULAR_BUYER';

    return 'OTHER';
  }

  // ── 6. reorderProbability (0–100) ───────────────────────────────────
  // Sınıfa özgü temel değer + ağırlıklı bileşenler
  function _calcProbability(classification, monthlySales, daysSince) {
    var len          = monthlySales ? monthlySales.length : 0;
    var last         = len > 0 ? (monthlySales[len - 1] || 0) : 0;
    var nonZero      = (monthlySales || []).filter(function (v) { return v > 0; });
    var avg          = nonZero.length ? nonZero.reduce(function (s, v) { return s + v; }, 0) / nonZero.length : 0;
    var activeRatio  = len > 0 ? nonZero.length / len : 0;
    var days         = typeof daysSince === 'number' ? daysSince : 999;

    // Sınıf bazlı başlangıç skoru
    var base = {
      REGULAR_BUYER:  72,
      GROWING:        65,
      AT_RISK:        20,
      REACTIVATION:   35,
      CAMPAIGN_BUYER: 15,
      OTHER:          40
    }[classification] || 40;

    // Aktiflik bonusu (±15)
    base += (activeRatio - 0.5) * 30;

    // Son ay hacim bonusu (±10)
    if (avg > 0) {
      base += Math.min(10, Math.max(-10, ((last / avg) - 1) * 20));
    }

    // Sipariş yaşı (±20)
    if (days <= 25)       base += 20;
    else if (days <= 35)  base += 12;
    else if (days <= 50)  base += 4;
    else if (days > 90)   base -= 20;
    else if (days > 60)   base -= 10;

    return Math.max(0, Math.min(100, Math.round(base)));
  }

  // ── 7. Lineer Tahmin (forecastBoxes) ─────────────────────────────────
  function _forecastLinear(monthlySales) {
    if (!monthlySales || !monthlySales.length) return 0;
    var n = monthlySales.length;
    if (n === 1) return monthlySales[0] || 0;

    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    monthlySales.forEach(function (v, i) {
      sumX  += i; sumY += v; sumXY += i * v; sumX2 += i * i;
    });
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return Math.round(sumY / n);
    var b   = (n * sumXY - sumX * sumY) / denom;
    var a   = (sumY - b * sumX) / n;
    return Math.max(0, Math.round(a + b * n));
  }

  // ── 8. Kompozit Skor (0–100) ─────────────────────────────────────────
  function _composeScore(prob, forecast, maxForecast) {
    var fNorm = maxForecast > 0 ? (forecast / maxForecast) * 100 : 0;
    return Math.max(0, Math.min(100, Math.round(prob * 0.65 + fNorm * 0.35)));
  }

  // ── 9. Gün Hesabı: Son Sipariş Tarihi ────────────────────────────────
  function _daysSince(ayStr) {
    if (!ayStr) return 999;
    try {
      var p    = String(ayStr).split('/');
      var lm   = parseInt(p[0], 10) || 1;
      var ly   = parseInt(p[1], 10) || 2024;
      var date = new Date(ly, lm - 1, 15);
      return Math.max(0, Math.round((new Date() - date) / 86400000));
    } catch (_) { return 999; }
  }

  // ── 10. classifyAllPharmacies(ttt) ───────────────────────────────────
  // ECZANE_RAW → her eczane için classification çıktı objesi
  // ── 10. classifyAllPharmacies(ttt) ───────────────────────────────────
  // FAZ 6.1.5 WRAPPER — PharmacyBehaviorEngine (FAZ 6.1) varsa ona delege
  // eder ve çıktısını bu dosyanın ORİJİNAL (daha sade) şemasına çevirir.
  // Hesap mantığı artık TEK YERDE (behavior-engine) — bu dosyanın kendi
  // _classify461/_calcProbability/_forecastLinear fonksiyonları zaten
  // pharmacy-intelligence.js ile NEREDEYSE BİREBİR AYNIYDI (bkz. dosya
  // başı analiz notu), bu yüzden delegasyon sonucu pratikte AYNI çıkar.
  // PharmacyBehaviorEngine yüklü değilse (rollback / FAZ 6.1 öncesi durum)
  // ORİJİNAL Phase 4.6.1 mantığına (_legacyClassifyAllPharmacies) düşer.
  function _fromBehaviorProfileToClassifier(p, rec) {
    var monthlySales = rec ? window.PharmacyAdapter.monthValuesArray(rec.months, rec.sortedMonths) : [];
    return {
      gln: p.gln, eczane: p.eczane, brick: p.brick, ttt: p.representative,
      classification: p.classification, reorderProbability: p.reorderProbability,
      forecastBoxes: p.forecastBoxes, score: p.score,
      totalBoxes: p.totalBoxes, monthlySales: monthlySales,
      lastPurchaseDate: p.lastPurchaseDate, daysSinceLastOrder: p.daysSinceLastOrder
    };
  }

  function classifyAllPharmacies(tttFilter) {
    if (window.PharmacyBehaviorEngine && window.PharmacyAdapter) {
      try {
        var behaviorProfiles = window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter);
        var records = window.PharmacyAdapter.normalizePharmacy(tttFilter);
        var recByKey = {};
        records.forEach(function (r) { recByKey[r.gln || r.eczane] = r; });
        return behaviorProfiles.map(function (p) {
          return _fromBehaviorProfileToClassifier(p, recByKey[p.gln || p.eczane]);
        });
      } catch (_delegateErr) {
        console.warn('[ReorderClassifier] PharmacyBehaviorEngine delege hata, legacy hesaba düşülüyor:', _delegateErr.message);
        // aşağı düş — legacy hesaba devam
      }
    }
    return _legacyClassifyAllPharmacies(tttFilter);
  }

  function _legacyClassifyAllPharmacies(tttFilter) {
    try {
      var _rcBase = (window.pharmacyActiveData && window.pharmacyActiveData.length > 0)
        ? window.pharmacyActiveData
        : (typeof ECZANE_RAW !== 'undefined' ? ECZANE_RAW : []);
      if (!_rcBase || !Array.isArray(_rcBase) || !_rcBase.length) {
        console.warn('[ReorderClassifier] veri yok');
        return [];
      }

      var source = tttFilter
        ? _rcBase.filter(function (r) { return r.ttt === tttFilter; })
        : _rcBase;

      if (!source.length) return [];

      // Eczane × Ay agregasyonu
      var eczMap = {};
      source.forEach(function (r) {
        var key = r.gln || r.ad;
        if (!key) return;
        if (!eczMap[key]) {
          eczMap[key] = { eczane: r.ad || '', brick: r.brick || '', ttt: r.ttt || '', gln: r.gln || '', aylar: {} };
        }
        var e = eczMap[key];
        if (r.brick && !e.brick) e.brick = r.brick;
        if (r.ttt   && !e.ttt)   e.ttt   = r.ttt;
        if (r.ay) {
          var adet = parseInt(r.adet, 10) || 0;
          e.aylar[r.ay] = (e.aylar[r.ay] || 0) + adet;
        }
      });

      var results = [];

      Object.keys(eczMap).forEach(function (key) {
        try {
          var e = eczMap[key];
          var ayKeys = Object.keys(e.aylar).sort(function (a, b) {
            return _monthToNum(a) - _monthToNum(b);
          });
          if (!ayKeys.length) return;

          var monthlySales  = ayKeys.map(function (k) { return e.aylar[k] || 0; });
          var totalBoxes    = monthlySales.reduce(function (s, v) { return s + v; }, 0);
          var lastAy        = ayKeys[ayKeys.length - 1];
          var days          = _daysSince(lastAy);
          var classification = _classify461(monthlySales);
          var reorderProbability = _calcProbability(classification, monthlySales, days);
          var forecastBoxes      = _forecastLinear(monthlySales);

          results.push({
            gln:               e.gln,
            eczane:            e.eczane,
            brick:             e.brick,
            ttt:               e.ttt,
            classification:    classification,
            reorderProbability: reorderProbability,
            forecastBoxes:     forecastBoxes,
            score:             0,               // sonradan doldurulur
            totalBoxes:        totalBoxes,
            monthlySales:      monthlySales,
            lastPurchaseDate:  lastAy,
            daysSinceLastOrder: days
          });
        } catch (_err) { /* null-safe: tek eczane hata verse devam */ }
      });

      // Master score normalizasyonu
      var maxForecast = results.reduce(function (m, r) { return Math.max(m, r.forecastBoxes); }, 1);
      results.forEach(function (r) {
        r.score = _composeScore(r.reorderProbability, r.forecastBoxes, maxForecast);
      });

      return results;

    } catch (err) {
      console.error('[ReorderClassifier] classifyAllPharmacies hata:', err);
      return [];
    }
  }

  // ── 11. buildClassifierTop30(ttt) ────────────────────────────────────
  // CAMPAIGN_BUYER hariç, score'a göre sıralı ilk 30
  function buildClassifierTop30(tttFilter) {
    var all = classifyAllPharmacies(tttFilter);

    var candidates = all.filter(function (r) {
      return r.classification !== 'CAMPAIGN_BUYER' && r.totalBoxes > 0;
    });

    candidates.sort(function (a, b) { return b.score - a.score; });

    // FAZ 6.1.5: nextOrderProducts/daysToNextOrder/expectedOrderBoxes için
    // ÖNCE PharmacyBehaviorEngine'den oku (script SIRASINA bağımlı değil,
    // her zaman güncel) — orijinal kod bunları window.PHARMACY_INTELLIGENCE
    // .profiles'tan ELLE okuyordu, bu da pharmacy-intelligence.js'in
    // runPharmacyIntelligence()'ı ÖNCEDEN çalıştırmış olmasına bağımlı,
    // dokümante edilmemiş bir kırılgan bağlantıydı (bkz. AI_MIMARI_ANALIZ_
    // VE_YOL_HARITASI.md §3.1). PharmacyBehaviorEngine yoksa eski yola düşülür.
    var behaviorByKey = null;
    if (window.PharmacyBehaviorEngine) {
      try {
        var bp = window.PharmacyBehaviorEngine.buildBehaviorProfiles(tttFilter);
        behaviorByKey = {};
        bp.forEach(function (p) { behaviorByKey[p.gln || p.eczane] = p; });
      } catch (_e) { behaviorByKey = null; }
    }

    return candidates.slice(0, 30).map(function (r, i) {
      var extra = null;
      if (behaviorByKey) {
        extra = behaviorByKey[r.gln || r.eczane] || null;
      } else if (window.PHARMACY_INTELLIGENCE && window.PHARMACY_INTELLIGENCE.profiles) {
        // legacy fallback — orijinal davranış aynen korunuyor
        extra = window.PHARMACY_INTELLIGENCE.profiles.filter(function(p){
          return p.gln === r.gln || p.eczane === r.eczane;
        })[0] || null;
      }
      return {
        rank:               i + 1,
        gln:                r.gln,
        eczane:             r.eczane,
        brick:              r.brick,
        ttt:                r.ttt,
        classification:     r.classification,
        reorderProbability: r.reorderProbability,
        forecastBoxes:      r.forecastBoxes,
        score:              r.score,
        daysSinceLastOrder: r.daysSinceLastOrder,
        lastPurchaseDate:   r.lastPurchaseDate,
        nextOrderProducts:  extra ? (extra.nextOrderProducts || []) : [],
        daysToNextOrder:    extra ? (extra.daysToNextOrder != null ? extra.daysToNextOrder : 99) : 99,
        expectedOrderBoxes: extra ? (extra.expectedOrderBoxes || extra.forecastBoxes || 0) : 0
      };
    });
  }

  // ── 12. runClassifier(ttt) — State güncelle ──────────────────────────
  function runClassifier(tttFilter) {
    try {
      var _rcCheck = (window.pharmacyActiveData && window.pharmacyActiveData.length > 0) ? window.pharmacyActiveData : (typeof ECZANE_RAW !== 'undefined' ? ECZANE_RAW : []);
      if (!_rcCheck || !_rcCheck.length) {
        console.warn('[ReorderClassifier] Veri henüz hazır değil');
        return false;
      }

      var all   = classifyAllPharmacies(tttFilter);
      var top30 = buildClassifierTop30(tttFilter);

      var byClass = {
        REGULAR_BUYER:  [],
        GROWING:        [],
        AT_RISK:        [],
        REACTIVATION:   [],
        CAMPAIGN_BUYER: [],
        OTHER:          []
      };
      all.forEach(function (r) {
        var bucket = byClass[r.classification] || byClass.OTHER;
        bucket.push(r);
      });

      window.REORDER_CLASSIFIER = {
        all:         all,
        top30:       top30,
        byClass:     byClass,
        generatedAt: new Date().toISOString(),
        tttFilter:   tttFilter || 'TÜMÜ'
      };

      // PHASE 5.4: Reorder tahminlerini LearningEngine'e kaydet
      if (window.LearningEngine && top30 && top30.length) {
        top30.forEach(function(e) {
          var _topProd = (e.nextOrderProducts && e.nextOrderProducts.length)
            ? e.nextOrderProducts[0].urun : null;
          window.LearningEngine.recordPrediction({
            type:'reorder', engine:'reorder',
            pharmacy:e.eczane, product:_topProd, brick:e.brick, ttt:e.ttt,
            predictedQty:e.forecastBoxes||0,
            confidence:e.reorderProbability||70,
            meta:{ classification:e.classification, score:e.score }
          });
        });
      }

      console.log(
        '[ReorderClassifier] ✅ Phase 4.6.1 tamamlandı:',
        all.length, 'eczane |',
        top30.length, 'top30 |',
        'REGULAR:', byClass.REGULAR_BUYER.length,
        '| GROWING:', byClass.GROWING.length,
        '| AT_RISK:', byClass.AT_RISK.length,
        '| REACTIVATION:', byClass.REACTIVATION.length,
        '| CAMPAIGN:', byClass.CAMPAIGN_BUYER.length
      );

      return true;
    } catch (err) {
      console.error('[ReorderClassifier] runClassifier hata:', err);
      return false;
    }
  }

  // ── 13. buildReorderClassifierContext(ttt) — AI Context ──────────────
  // ai-context.js'e entegre edilir (Phase 4.6.1 bloğu olarak)
  function buildReorderClassifierContext(tttFilter) {
    try {
      var rc = window.REORDER_CLASSIFIER;

      // Gerekirse yeniden üret
      if (!rc || !rc.top30 || !rc.top30.length || rc.tttFilter !== (tttFilter || 'TÜMÜ')) {
        runClassifier(tttFilter);
        rc = window.REORDER_CLASSIFIER;
      }

      if (!rc || !rc.top30 || !rc.top30.length) {
        return '\n\n--- REORDER CLASSIFIER (4.6.1) ---\n(Veri yok)';
      }

      var bc    = rc.byClass;
      var lines = [
        '',
        '--- REORDER CLASSIFIER (Phase 4.6.1) ---',
        'Üretim: ' + (rc.generatedAt ? rc.generatedAt.slice(0, 10) : '—'),
        'Toplam: ' + rc.all.length + ' eczane',
        'REGULAR_BUYER: '  + bc.REGULAR_BUYER.length  +
        ' | GROWING: '     + bc.GROWING.length         +
        ' | AT_RISK: '     + bc.AT_RISK.length         +
        ' | REACTIVATION: '+ bc.REACTIVATION.length    +
        ' | CAMPAIGN: '    + bc.CAMPAIGN_BUYER.length,
        '',
        'BU HAFTA SİPARİŞE EN YAKIN 30 ECZANE:'
      ];

      rc.top30.forEach(function (e) {
        lines.push(
          '#' + e.rank + ' ' + e.eczane +
          ' [' + e.brick + ']' +
          '\n  Sınıf: '        + e.classification +
          ' | Sipariş %: '    + e.reorderProbability +
          ' | Tahmin: '       + e.forecastBoxes + ' kutu' +
          ' | Skor: '         + e.score +
          '\n  Son alış: '     + (e.lastPurchaseDate || '?') +
          ' (' + e.daysSinceLastOrder + ' gün önce)'
        );
      });

      var totalForecast = rc.top30.reduce(function (s, e) { return s + (e.forecastBoxes || 0); }, 0);
      lines.push('');
      lines.push('TOP 30 Toplam Tahmin: ' + totalForecast + ' kutu');

      // Yeniden kazanım özeti
      if (bc.REACTIVATION && bc.REACTIVATION.length) {
        lines.push('');
        lines.push('🔄 YENİDEN KAZANIM (' + bc.REACTIVATION.length + ' eczane):');
        bc.REACTIVATION.slice(0, 5).forEach(function (r) {
          lines.push('  ' + r.eczane + ' [' + r.brick + '] — ' + r.daysSinceLastOrder + ' gündür sipariş yok');
        });
      }

      // Risk özeti
      if (bc.AT_RISK && bc.AT_RISK.length) {
        lines.push('');
        lines.push('⚠ AT_RISK (' + bc.AT_RISK.length + ' eczane):');
        bc.AT_RISK.slice(0, 5).forEach(function (r) {
          lines.push('  ' + r.eczane + ' [' + r.brick + '] — sürekli düşüş, müdahale gerekiyor');
        });
      }

      return lines.join('\n');

    } catch (err) {
      console.warn('[ReorderClassifier] buildReorderClassifierContext hata:', err.message);
      return '';
    }
  }

  // ── 14. renderClassifierTop30Card(containerId, ttt) ─────────────────
  // "Bu Hafta Siparişe En Yakın 30 Eczane" tablosu
  function renderClassifierTop30Card(containerId, tttFilter) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var ok = runClassifier(tttFilter);
    var rc = window.REORDER_CLASSIFIER;

    if (!ok || !rc || !rc.top30 || !rc.top30.length) {
      container.innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--dim)">' +
        '⏳ Sınıflandırma verisi hazırlanıyor…</div>';
      return;
    }

    // Özet istatistikler
    var totalForecast = rc.top30.reduce(function (s, e) { return s + (e.forecastBoxes || 0); }, 0);
    var avgScore      = Math.round(rc.top30.reduce(function (s, e) { return s + e.score; }, 0) / rc.top30.length);
    var bc            = rc.byClass;

    // Rozet helper
    var _badge = function (cls) {
      var map = {
        REGULAR_BUYER:  { bg: '#EFF6FF', color: '#1D4ED8', icon: '✓', label: 'Düzenli'    },
        GROWING:        { bg: '#DCFCE7', color: '#15803D', icon: '↑', label: 'Büyüyen'    },
        AT_RISK:        { bg: '#FEE2E2', color: '#DC2626', icon: '⚠', label: 'Risk'       },
        REACTIVATION:   { bg: '#F3E8FF', color: '#7C3AED', icon: '🔄', label: 'Kazan'     },
        CAMPAIGN_BUYER: { bg: '#FEF3C7', color: '#D97706', icon: '⚡', label: 'Kampanya'  },
        OTHER:          { bg: '#F1F5F9', color: '#64748B', icon: '·',  label: 'Diğer'     }
      };
      var c = map[cls] || map['OTHER'];
      return '<span style="font-size:9px;font-weight:700;background:' + c.bg +
             ';color:' + c.color +
             ';border-radius:4px;padding:1px 6px;white-space:nowrap">' +
             c.icon + ' ' + c.label + '</span>';
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

    var _scoreColor = function (s) {
      return s >= 75 ? '#521FD1' : s >= 50 ? '#0891B2' : '#64748B';
    };

    // Sınıf dağılım özet çipleri
    var _classSummary = function () {
      var items = [
        { key: 'REGULAR_BUYER',  icon: '✓', label: 'Düzenli',   color: '#1D4ED8', bg: '#EFF6FF' },
        { key: 'GROWING',        icon: '↑', label: 'Büyüyen',   color: '#15803D', bg: '#DCFCE7' },
        { key: 'AT_RISK',        icon: '⚠', label: 'Risk',      color: '#DC2626', bg: '#FEE2E2' },
        { key: 'REACTIVATION',   icon: '🔄', label: 'Kazanım',  color: '#7C3AED', bg: '#F3E8FF' },
        { key: 'CAMPAIGN_BUYER', icon: '⚡', label: 'Kampanya', color: '#D97706', bg: '#FEF3C7' }
      ];
      return items.map(function (it) {
        var cnt = bc[it.key] ? bc[it.key].length : 0;
        return '<div style="display:inline-flex;align-items:center;gap:4px;' +
               'background:' + it.bg + ';color:' + it.color + ';' +
               'border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700">' +
               it.icon + ' ' + it.label + ' <span style="opacity:.7">' + cnt + '</span></div>';
      }).join('');
    };

    // Tablo satırları
    // Ürün sipariş yakınlık badge
    var _prodBadge = function (nextProds) {
      if (!nextProds || !nextProds.length) return '';
      return nextProds.slice(0, 3).map(function (p) {
        var sn = p.urun.replace('GRİPORT COLD','GRP').replace('ACİDPASS','ACP')
                       .replace('PANOCER','PAN').replace('MOKSEFEN','MKS').replace('FAMTREC','FAM');
        var bg  = p.overdue ? '#FEE2E2' : p.urgent ? '#FEF3C7' : '#F1F5F9';
        var col = p.overdue ? '#DC2626' : p.urgent ? '#B45309' : '#475569';
        return '<span style="font-size:8px;font-weight:700;background:' + bg + ';color:' + col +
               ';border-radius:3px;padding:1px 5px">' +
               sn + ' ' + (p.overdue?'⚡':'') + p.label + (p.kutu?' ~'+p.kutu+'K':'') + '</span>';
      }).join(' ');
    };

    var rows = rc.top30.map(function (e) {
      var orderIn = e.daysToNextOrder <= 0
        ? '<span style="color:#DC2626;font-weight:800;font-size:10px">⚡ Bugün!</span>'
        : e.daysToNextOrder <= 7
          ? '<span style="color:#D97706;font-weight:700;font-size:10px">' + e.daysToNextOrder + ' gün</span>'
          : '<span style="color:var(--dim);font-size:10px">' + e.daysToNextOrder + ' gün</span>';
      return '<tr>' +
        '<td style="font-weight:800;color:var(--c1);text-align:center;font-size:12px">' + e.rank + '</td>' +
        '<td style="font-weight:600;font-size:11px">' + e.eczane + '<br>' + _prodBadge(e.nextOrderProducts) + '</td>' +
        '<td style="font-size:10px;color:var(--dim)">' + e.brick + '</td>' +
        '<td style="text-align:center">' + _badge(e.classification) + '</td>' +
        '<td style="text-align:center;font-weight:900;font-size:13px;color:' +
            _scoreColor(e.score) + '">' + e.score + '</td>' +
        '<td style="text-align:center">' + _probBar(e.reorderProbability) + '</td>' +
        '<td style="text-align:center;font-weight:700;color:#0891B2;font-size:12px">' +
            e.forecastBoxes + '</td>' +
        '<td style="text-align:center;font-size:10px;color:var(--dim)">' +
            e.daysSinceLastOrder + ' gün</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-hd" style="flex-wrap:wrap;gap:6px">' +
          '<span class="card-badge">' + rc.top30.length + ' eczane</span>' +
          '<span class="card-badge" style="background:#EFF6FF;color:#1D4ED8">' +
            '🔮 Tahmin: ' + totalForecast + ' kutu</span>' +
          '<span class="card-badge" style="background:#F0FDF4;color:#15803D">' +
            'Ort. skor: ' + avgScore + '</span>' +
        '</div>' +
        '<div style="padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px">' +
          _classSummary() +
        '</div>' +
        '<div class="card-body-0 scroll-x">' +
          '<table class="tbl" style="min-width:780px">' +
            '<thead><tr>' +
              '<th style="text-align:center;width:32px">#</th>' +
              '<th>Eczane</th>' +
              '<th>Brick</th>' +
              '<th style="text-align:center">Sınıf</th>' +
              '<th style="text-align:center">Skor</th>' +
              '<th style="text-align:center">Sipariş %</th>' +
              '<th style="text-align:center">Tahmin</th>' +
              '<th style="text-align:center">Son Alış</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  // ── 15. Public API ───────────────────────────────────────────────────
  window.classifyAllPharmacies        = classifyAllPharmacies;
  window.buildClassifierTop30         = buildClassifierTop30;
  window.runClassifier                = runClassifier;
  window.buildReorderClassifierContext= buildReorderClassifierContext;
  window.renderClassifierTop30Card    = renderClassifierTop30Card;

  // ── 16. ai-context.js entegrasyon sinyali ───────────────────────────
  window._REORDER_CLASSIFIER_LOADED  = true;
  window._REORDER_CLASSIFIER_READY   = true;

  console.log('[ReorderClassifier] ✅ Phase 4.6.1 yüklendi');

})();
