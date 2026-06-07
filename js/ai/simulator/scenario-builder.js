// ══════════════════════════════════════════════════════════════════════
//  js/ai/simulator/scenario-builder.js
//  Phase 3.2 — Smart Target Simulator
//
//  Sorumluluk:
//    • buildScenario(ttt)         → worst / expected / best case
//    • analyzeProductImpact(ttt)  → ürün kaldıraç skoru + etki analizi
//    • analyzeBrickImpact(ttt)    → brick kaldıraç skoru + etki analizi
//    • formatScenariosForAI(obj)  → AI prompt metni
//
//  Bağımlılık:
//    js/ai/predictive/runrate-engine.js  (calculateRunRate)
//    js/ai/predictive/forecast-engine.js (generateForecast)
//    js/ai/simulator/prim-simulator.js   (simulatePrim)
//    js/data/data-state.js               (GENEL, IMS, MIGI_BRICK_TL_RAW, KUTU)
//    js/core/constants.js                (URUN_ORDER, IMS_TL_MAP, URUN_AGIRLIK)
//    js/core/prim-calc.js                (getCarpan)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, IMS, MIGI_BRICK_TL_RAW, KUTU,
          URUN_ORDER, IMS_TL_MAP, URUN_AGIRLIK,
          calculateRunRate, generateForecast, simulatePrim, getCarpan */

(function () {
  'use strict';

  // ── Yardımcılar ───────────────────────────────────────────

  function _genel(ttt) {
    return (typeof GENEL !== 'undefined' ? GENEL : [])
      .filter(function (r) { return r.ttt === ttt; });
  }
  function _genelTotal(ttt) {
    return _genel(ttt).find(function (r) { return r.urun === 'GENEL TOPLAM'; }) || null;
  }
  function _genelRows(ttt) {
    return _genel(ttt).filter(function (r) {
      return r.urun !== 'GENEL TOPLAM' && r.urun !== 'DESTEVIT';
    });
  }

  function _safeRR(ttt) {
    return (typeof calculateRunRate === 'function')
      ? calculateRunRate(ttt)
      : { dailyRunRate: 0, remainingDays: 0, projectedMonthEnd: 0, confidence: 0 };
  }

  function _safeForecast(ttt) {
    return (typeof generateForecast === 'function')
      ? generateForecast(ttt)
      : { projectedTL: 0, projectedReal: 0, confidence: 0 };
  }

  // ── buildScenario ─────────────────────────────────────────
  // 3 senaryo: worst (run rate -20%), expected (run rate), best (run rate +20%)
  // @param {string} ttt
  // @returns {{
  //   worst:    { realization, projectedTL, projectedBox, prim, note },
  //   expected: { realization, projectedTL, projectedBox, prim, note },
  //   best:     { realization, projectedTL, projectedBox, prim, note }
  // }}
  function buildScenario(ttt) {
    var empty = { realization: 0, projectedTL: 0, projectedBox: 0, prim: 0, note: '—' };
    var result = { worst: Object.assign({}, empty), expected: Object.assign({}, empty), best: Object.assign({}, empty) };

    try {
      var gt  = _genelTotal(ttt);
      if (!gt) return result;

      var currentTL  = gt.satis_tl || 0;
      var hedefTL    = gt.hedef_tl || 0;
      // FIX-SCEN-01a: back-calc hedef_tl when missing (Phase 3.0.3 pattern)
      if (hedefTL === 0 && (gt.tl_pct || 0) > 0 && currentTL > 0) {
        hedefTL = Math.round(currentTL / ((gt.tl_pct || 1) / 100));
      }
      if (hedefTL === 0) return result;

      var rr         = _safeRR(ttt);
      var remaining  = rr.remainingDays || 0;
      var dailyRate  = rr.dailyRunRate  || 0;

      // FIX-SCEN-01b: if dailyRate is inflated (elapsedDays too small), cap it.
      // Sanity check: dailyRate should not exceed currentTL / 5 (5 minimum elapsed days)
      var currentReal = hedefTL > 0 ? (currentTL / hedefTL) * 100 : 0;
      var minElapsed  = 5; // en az 5 iş günü geçmiş varsayımı
      var maxReasonableDaily = currentTL / minElapsed;
      if (dailyRate > maxReasonableDaily && maxReasonableDaily > 0) {
        dailyRate = maxReasonableDaily;
      }

      // Tahmini kutu: KUTU verisinden
      var currentBox = (typeof KUTU !== 'undefined' ? KUTU : [])
        .filter(function (r) { return r.ttt === ttt; })
        .reduce(function (s, r) { return s + (r.cikan_kutu || 0); }, 0);
      var tlPerBox   = currentTL > 0 && currentBox > 0 ? currentTL / currentBox : 100;

      // 3 hız senaryosu (±%20 — mevcut hız üzerinden)
      var rates = {
        worst:    dailyRate * 0.80,
        expected: dailyRate,
        best:     dailyRate * 1.20
      };

      var keys = ['worst', 'expected', 'best'];
      keys.forEach(function (key) {
        var rate     = rates[key];
        // FIX-SCEN-01c: projection uses kalan (kalanTL) as the variable part
        // projTL = currentTL (floor) + additional_sales_in_remaining_days
        var projTL   = Math.round(currentTL + rate * remaining);
        // FIX-SCEN-01d: cap projReal at 130% — no scenario should show >130%
        var rawReal  = hedefTL > 0 ? (projTL / hedefTL) * 100 : 0;
        var projReal = Math.min(130, Math.round(rawReal * 10) / 10);
        var projBox  = Math.round(currentBox + (rate / (tlPerBox || 1)) * remaining);

        // Prim tahmini
        var primVal = 0;
        if (typeof getCarpan === 'function' && projReal >= 91) {
          var carpan = getCarpan(projReal);
          primVal    = Math.round(carpan * 55000 * 1.2);
        }

        var noteMap = {
          worst:    'Mevcut hız %20 yavaşlarsa',
          expected: 'Mevcut hız sabit kalırsa',
          best:     'Mevcut hız %20 artarsa'
        };

        result[key] = {
          realization:  projReal,
          projectedTL:  projTL,
          projectedBox: Math.max(0, projBox),
          prim:         primVal,
          dailyRate:    Math.round(rate),
          // FIX-SCEN-01e: note also shows current vs projected for clarity
          note:         noteMap[key] + ': mevcut %' + Math.round(currentReal * 10) / 10 +
            ' → tahmini %' + projReal + ' (₺' + projTL.toLocaleString('tr-TR') + ')'
        };
      });

    } catch (e) {
      console.warn('[scenario-builder] buildScenario hata:', e.message);
    }

    return result;
  }

  // ── analyzeProductImpact ──────────────────────────────────
  // Her ürün için: "Bu ürün %X büyüse toplam realizasyon kaç artar?"
  // Impact Score = ürün ağırlığı × (hedef_tl içindeki payı) × büyüme kaldıracı
  //
  // @param {string} ttt
  // @param {number} [growthPct]  — varsayılan %10 büyüme simülasyonu
  // @returns {Array<{
  //   product:      string,
  //   currentReal:  number,
  //   currentTL:    number,
  //   hedefTL:      number,
  //   weight:       number,    — URUN_AGIRLIK'tan
  //   impactScore:  number,    — 0-10 kaldıraç gücü
  //   tlGapContrib: number,    — toplam TL açığına katkı %
  //   realizationGain: number, — bu ürün %10 büyüseydi genel real kaç artar
  //   note:         string
  // }>}
  function analyzeProductImpact(ttt, growthPct) {
    var growth = (growthPct !== undefined ? growthPct : 10) / 100;
    var results = [];

    try {
      var gt       = _genelTotal(ttt);
      var urunRows = _genelRows(ttt);
      if (!gt || !urunRows.length) return results;

      var hedefTLTotal = gt.hedef_tl || 0;
      var satisTLTotal = gt.satis_tl || 0;
      var totalGap     = Math.max(0, hedefTLTotal - satisTLTotal);
      var agirliklar   = (typeof URUN_AGIRLIK !== 'undefined') ? URUN_AGIRLIK : {};
      var urunOrder    = (typeof URUN_ORDER !== 'undefined')   ? URUN_ORDER   : [];

      urunRows.forEach(function (r) {
        var urun        = r.urun;
        var currentTL   = r.satis_tl  || 0;
        var hedefTL     = r.hedef_tl  || 0;
        var currentReal = hedefTL > 0 ? (currentTL / hedefTL) * 100 : 0;
        var weight      = (r.urun_agirlik > 0) ? r.urun_agirlik : (agirliklar[urun] || 0);

        // Eğer bu ürün %10 büyüseydi genel realizasyona etkisi
        var additionalTL    = currentTL * growth;
        var newUrunReal     = hedefTL > 0 ? ((currentTL + additionalTL) / hedefTL) * 100 : 0;
        var realGain        = hedefTLTotal > 0 ? (additionalTL / hedefTLTotal) * 100 : 0;

        // Toplam açıktaki payı
        var urunGap         = Math.max(0, hedefTL - currentTL);
        var tlGapContrib    = totalGap > 0 ? (urunGap / totalGap) * 100 : 0;

        // Kaldıraç skoru: ağırlık × açık büyüklüğü × düşük realizasyondan kazanç
        var gapFactor       = hedefTLTotal > 0 ? hedefTL / hedefTLTotal : 0;
        var underPerform    = Math.max(0, 100 - currentReal) / 100;
        var impactScore     = Math.round((weight * 10 + gapFactor * 5 + underPerform * 3) * 10) / 10;
        impactScore         = Math.min(10, impactScore);

        // Ürün sırası
        var urunIdx = urunOrder.indexOf(urun);

        results.push({
          product:         urun,
          sortOrder:       urunIdx >= 0 ? urunIdx : 99,
          currentReal:     Math.round(currentReal * 10) / 10,
          currentTL:       Math.round(currentTL),
          hedefTL:         Math.round(hedefTL),
          weight:          weight,
          impactScore:     impactScore,
          tlGapContrib:    Math.round(tlGapContrib * 10) / 10,
          realizationGain: Math.round(realGain * 10) / 10,
          note:            urun + ' %' + Math.round(growth * 100) + ' büyüse genel real +%' +
            Math.round(realGain * 10) / 10 + ' artar.'
        });
      });

      // Impact score'a göre sırala (yüksekten düşüğe)
      results.sort(function (a, b) { return b.impactScore - a.impactScore; });

    } catch (e) {
      console.warn('[scenario-builder] analyzeProductImpact hata:', e.message);
    }

    return results;
  }

  // ── analyzeBrickImpact ────────────────────────────────────
  // Her brick için kaldıraç gücü ve potansiyel TL katkısı hesapla.
  // Kaynak: IMS haftalık satış (kendi ürünlerimiz + pazar payı).
  //
  // @param {string} ttt
  // @returns {Array<{
  //   brick:         string,
  //   impactScore:   number,   — 0-100
  //   potentialTL:   number,   — realizasyon artışından elde edilebilecek TL
  //   ourShare:      number,   — mevcut pazar payı %
  //   mktSize:       number,   — haftalık toplam pazar büyüklüğü (TL)
  //   shareGap:      number,   — rakip en güçlü oyuncuya göre pay açığı
  //   topGroup:      string,   — en büyük satış yaptığımız ürün grubu
  //   note:          string
  // }>}
  function analyzeBrickImpact(ttt) {
    var results = [];

    try {
      var imsRows  = (typeof IMS !== 'undefined' ? IMS : [])
        .filter(function (r) { return r.ttt === ttt; });
      var migiRows = (typeof MIGI_BRICK_TL_RAW !== 'undefined' ? MIGI_BRICK_TL_RAW : [])
        .filter(function (r) { return r.person === ttt; });
      var tlMap    = (typeof IMS_TL_MAP !== 'undefined') ? IMS_TL_MAP : {};

      if (!imsRows.length) return results;

      // Brick başına grup verisi
      var brickMap = {};
      imsRows.forEach(function (r) {
        var b = r.brick;
        if (!b) return;
        if (!brickMap[b]) {
          brickMap[b] = { groups: {}, ourKutu: 0, mktKutu: 0, is_mkt: [], grps: [] };
        }

        var isOwn = !r.is_mkt;
        var grp   = r.ilac_grubu;
        var kutu  = r.toplam || 0;

        if (!brickMap[b].groups[grp]) {
          brickMap[b].groups[grp] = { own: 0, mkt: 0 };
        }
        if (isOwn) {
          brickMap[b].ourKutu    += kutu;
          brickMap[b].groups[grp].own += kutu;
        } else {
          brickMap[b].mktKutu    += kutu;
          brickMap[b].groups[grp].mkt += kutu;
        }
        if (brickMap[b].grps.indexOf(grp) === -1) brickMap[b].grps.push(grp);
      });

      // MIGI sıra haritası (ilk 333 bonusu)
      var migiSira = {};
      migiRows.forEach(function (r) {
        if (!migiSira[r.brick] || r.sira < migiSira[r.brick]) {
          migiSira[r.brick] = r.sira;
        }
      });

      Object.keys(brickMap).forEach(function (brick) {
        var b        = brickMap[brick];
        var totalKutu = b.ourKutu + b.mktKutu;
        if (totalKutu === 0) return;

        var ourShare  = (b.ourKutu / totalKutu) * 100;
        var shareGap  = Math.max(0, 50 - ourShare); // %50'ye kadar kazanılabilecek pay

        // TL potansiyeli: pazar payı artışından
        // Eğer %10 daha pay alırsak, o ek kutu × ortalama birim fiyat
        var avgPrice = 0;
        var priceCnt = 0;
        b.grps.forEach(function (grp) {
          var ownDrug = (typeof OWN_DRUG_BY_GRP !== 'undefined' && OWN_DRUG_BY_GRP[grp])
            ? OWN_DRUG_BY_GRP[grp].urun : null;
          if (ownDrug && tlMap[ownDrug]) { avgPrice += tlMap[ownDrug]; priceCnt++; }
        });
        if (priceCnt) avgPrice /= priceCnt; else avgPrice = 100;

        var potentialExtraKutu = totalKutu * 0.10; // %10 pay artışı
        var potentialTL        = Math.round(potentialExtraKutu * avgPrice);

        // İlk 333 bonusu
        var sira      = migiSira[brick] || 999;
        var migiBonus = sira <= 100 ? 20 : sira <= 333 ? 10 : 0;

        // Impact skoru: pazar büyüklüğü + pay artış alanı + MIGI bonusu
        var sizeFactor  = Math.min(30, Math.log(totalKutu + 1) * 3);
        var gapFactor   = Math.min(40, shareGap * 0.8);
        var impactScore = Math.round(sizeFactor + gapFactor + migiBonus);
        impactScore     = Math.min(100, Math.max(0, impactScore));

        // En büyük grubun adı
        var topGrp = b.grps.reduce(function (best, grp) {
          var v = (b.groups[grp] || { own: 0 }).own;
          return v > ((b.groups[best] || { own: 0 }).own) ? grp : best;
        }, b.grps[0] || '');

        results.push({
          brick:       brick,
          impactScore: impactScore,
          potentialTL: potentialTL,
          ourShare:    Math.round(ourShare * 10) / 10,
          mktSize:     totalKutu,
          shareGap:    Math.round(shareGap * 10) / 10,
          topGroup:    topGrp,
          sira:        sira,
          note:        brick + ': pazar payı %' + Math.round(ourShare) + ' — %10 artışla ₺' +
            potentialTL.toLocaleString('tr-TR') + ' ek TL potansiyeli.'
        });
      });

      // Impact score'a göre sırala
      results.sort(function (a, b) { return b.impactScore - a.impactScore; });

    } catch (e) {
      console.warn('[scenario-builder] analyzeBrickImpact hata:', e.message);
    }

    return results;
  }

  // ── formatScenariosForAI ──────────────────────────────────
  function formatScenariosForAI(scenarios, productImpact, brickImpact) {
    var lines = [];
    lines.push('');
    lines.push('SENARYO ANALİZİ:');

    if (scenarios) {
      lines.push('  En Kötü Durum  : %' + scenarios.worst.realization    + ' — ' + scenarios.worst.note);
      lines.push('  Beklenen Durum : %' + scenarios.expected.realization  + ' — ' + scenarios.expected.note);
      lines.push('  En İyi Durum   : %' + scenarios.best.realization      + ' — ' + scenarios.best.note);
    }

    if (productImpact && productImpact.length) {
      lines.push('');
      lines.push('ÜRÜN KALDIRAC ANALİZİ (ilk 3):');
      productImpact.slice(0, 3).forEach(function (p) {
        lines.push('  ' + p.product + ': etki skoru ' + p.impactScore +
          '/10 | açık katkısı %' + p.tlGapContrib +
          ' | %10 büyüme = genel real +%' + p.realizationGain);
      });
    }

    if (brickImpact && brickImpact.length) {
      lines.push('');
      lines.push('BRICK KALDIRAC ANALİZİ (ilk 3):');
      brickImpact.slice(0, 3).forEach(function (b) {
        lines.push('  ' + b.brick + ': etki skoru ' + b.impactScore +
          '/100 | pazar payı %' + b.ourShare +
          ' | potansiyel ₺' + (b.potentialTL || 0).toLocaleString('tr-TR'));
      });
    }

    return lines.join('\n');
  }

  // ── EXPORT ────────────────────────────────────────────────
  window.buildScenario          = buildScenario;
  window.analyzeProductImpact   = analyzeProductImpact;
  window.analyzeBrickImpact     = analyzeBrickImpact;
  window.formatScenariosForAI   = formatScenariosForAI;

  console.debug('[scenario-builder] Phase 3.2 yüklendi.');

})();
