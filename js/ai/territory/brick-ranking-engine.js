// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/brick-ranking-engine.js
//  Phase 3.3 — Territory Optimization Engine
//
//  Sorumluluk: Her brick için çok boyutlu öncelik skoru hesapla
//    • rankBricks(ttt) → rankedBrick[]
//
//  Skor Formülü (toplam 100 puan):
//    30% Realizasyon Açığı     — ne kadar geride?
//    25% Büyüme Potansiyeli    — IMS pazar payı fırsatı
//    20% Pazar Fırsatı         — rakip zayıflığı
//    15% Kapsama Zayıflığı     — eczane ziyaret sıklığı
//    10% MI&GI Fırsatı         — endeks fırsatı
//
//  Sonuç: 0-100 normalize edilmiş öncelik skoru
//  Sınıflandırma: OPPORTUNITY | STABLE | SATURATED | RESCUE
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: data-state.js, constants.js, IMS, GENEL,
//               MIGI_BRICK_TL_RAW, ECZANE_RAW
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMS, GENEL, MIGI_BRICK_TL_RAW, ECZANE_RAW, eczaneLoaded */

(function () {
  'use strict';

  // ── _norm — normalize single value to 0-100 within min/max ─
  function _norm(val, min, max) {
    if (max === min) return 50;
    return Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
  }

  // ── _buildBrickImsMap ──────────────────────────────────────
  // brick → { bizimPay, rakipPay, pazarHacimiKutu, grp }
  function _buildBrickImsMap(ttt) {
    var map = {};
    (IMS || []).filter(function (r) { return r.ttt === ttt; }).forEach(function (r) {
      var key = (r.brick || '').toUpperCase();
      if (!key) return;
      if (!map[key]) map[key] = { bizimSum: 0, rakipSum: 0, pazarSum: 0, n: 0, grp: r.ilac_grubu };
      // Use latest non-zero week value
      var weeks = [r.h1,r.h2,r.h3,r.h4,r.h5,r.h6,r.h7,r.h8,r.h9].filter(function(v){ return v > 0; });
      var toplam = r.toplam || 0;
      map[key].pazarSum += toplam;
      map[key].n        += 1;
    });
    return map;
  }

  // ── _buildBrickMigiMap ─────────────────────────────────────
  // brick → { miAvg, biAvg, sira }
  function _buildBrickMigiMap(ttt) {
    var map = {};
    (MIGI_BRICK_TL_RAW || []).filter(function (r) { return r.person === ttt; }).forEach(function (r) {
      var key = (r.brick || '').toUpperCase();
      if (!key) return;
      if (!map[key]) map[key] = { mi: [], bi: [], sira: r.sira || 999 };
      if (r.mi != null) map[key].mi.push(r.mi);
      if (r.bi != null) map[key].bi.push(r.bi);
      if (r.sira && r.sira < map[key].sira) map[key].sira = r.sira;
    });
    var result = {};
    Object.keys(map).forEach(function (key) {
      var b  = map[key];
      var mi = b.mi.length ? b.mi.reduce(function(s,v){return s+v;},0)/b.mi.length : null;
      var bi = b.bi.length ? b.bi.reduce(function(s,v){return s+v;},0)/b.bi.length : null;
      result[key] = { miAvg: mi, biAvg: bi, sira: b.sira };
    });
    return result;
  }

  // ── _buildBrickEczaneMap ───────────────────────────────────
  // brick → { eczaneCount, totalAdet, lastVisitDaysAgo }
  function _buildBrickEczaneMap(ttt) {
    var map = {};
    if (!eczaneLoaded || !ECZANE_RAW) return map;
    var now = new Date();
    (ECZANE_RAW || []).filter(function (r) { return r.ttt === ttt; }).forEach(function (r) {
      var key = (r.brick || '').toUpperCase();
      if (!key) return;
      if (!map[key]) map[key] = { eczaneler: new Set(), adet: 0, lastDate: null };
      map[key].eczaneler.add(r.gln || r.ad);
      map[key].adet += (r.adet || 0);
      // Parse date for recency
      if (r.tarih) {
        var parts = r.tarih.split('.');
        if (parts.length >= 3) {
          var d = new Date(parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0'));
          if (!isNaN(d) && (!map[key].lastDate || d > map[key].lastDate)) {
            map[key].lastDate = d;
          }
        }
      }
    });
    var result = {};
    Object.keys(map).forEach(function (key) {
      var b = map[key];
      var daysSince = b.lastDate
        ? Math.floor((now - b.lastDate) / (1000 * 60 * 60 * 24))
        : 999;
      result[key] = { eczaneCount: b.eczaneler.size, totalAdet: b.adet, daysSince: daysSince };
    });
    return result;
  }

  // ── _buildBrickGenelMap ────────────────────────────────────
  // brick → realizasyon bilgisi (GENEL ürün satırından tahmini)
  // GENEL brick bazlı değil → ttt genelinden oran kullanırız
  function _buildBrickGenelInfo(ttt) {
    var total = (GENEL || []).find(function (r) {
      return r.ttt === ttt && r.urun === 'GENEL TOPLAM';
    });
    return { tl_pct: total ? (total.tl_pct || 0) : 0,
             satis_tl: total ? (total.satis_tl || 0) : 0,
             hedef_tl: total ? (total.hedef_tl || 0) : 0 };
  }

  // ── rankBricks ────────────────────────────────────────────
  // @param {string} ttt
  // @returns {Array<{
  //   brick: string, score: number, classification: string,
  //   reason: string, detail: string,
  //   scores: { realization, growth, market, coverage, migi }
  // }>}
  function rankBricks(ttt) {
    if (!ttt) return [];

    try {
      var imsMap   = _buildBrickImsMap(ttt);
      var migiMap  = _buildBrickMigiMap(ttt);
      var eczMap   = _buildBrickEczaneMap(ttt);
      var genelInfo = _buildBrickGenelInfo(ttt);

      // Tüm brick'leri birleştir
      var allBricks = new Set();
      Object.keys(imsMap).forEach(function(k){ allBricks.add(k); });
      Object.keys(migiMap).forEach(function(k){ allBricks.add(k); });
      Object.keys(eczMap).forEach(function(k){ allBricks.add(k); });

      if (!allBricks.size) return [];

      // ── Ham skorları hesapla ─────────────────────────────
      var rawScores = [];
      allBricks.forEach(function (brick) {
        var ims  = imsMap[brick]  || {};
        var migi = migiMap[brick] || {};
        var ecz  = eczMap[brick]  || {};

        // 1. Realizasyon açığı: genel realizasyonun ne kadar altı?
        //    Hem genel tl_pct hem de IMS pazar hacmi kullanır
        var realGap = Math.max(0, 91 - genelInfo.tl_pct); // 0-91 aralığı
        // Brick bazlı IMS verisi yoksa genel gap kullan
        var realizationRaw = realGap;

        // 2. Büyüme potansiyeli: IMS pazar büyüklüğü (toplam kutu)
        var growthRaw = ims.pazarSum || 0;

        // 3. Pazar fırsatı: rakip zayıflığı (pazar - bizim pay)
        //    IMS verisinde brick bazlı rakip yok → pazar hacmi proxy
        var marketRaw = ims.pazarSum || 0;

        // 4. Kapsama zayıflığı: son ziyaretten geçen gün (yüksek = zayıf)
        var coverageRaw = ecz.daysSince || 30;

        // 5. MI&GI fırsatı: sira ≤ 333 ve MI 100'ün üstü
        var migiRaw = 0;
        if (migi.sira && migi.sira <= 333) {
          var mi = migi.miAvg || 0;
          // MI > 100 = over-index; opportunity when sira is low
          migiRaw = mi > 100 ? mi : (200 - (migi.sira / 333) * 100);
        }

        rawScores.push({
          brick: brick, realizationRaw, growthRaw, marketRaw, coverageRaw, migiRaw,
          ims, migi, ecz
        });
      });

      // ── Min-max normalize her boyutu ──────────────────────
      var dims = ['realizationRaw','growthRaw','marketRaw','coverageRaw','migiRaw'];
      var minMax = {};
      dims.forEach(function (d) {
        var vals = rawScores.map(function(r){ return r[d]; });
        minMax[d] = { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
      });

      // ── Final skor hesapla ───────────────────────────────
      var ranked = rawScores.map(function (rs) {
        var s = {
          realization: _norm(rs.realizationRaw, minMax.realizationRaw.min, minMax.realizationRaw.max),
          growth:      _norm(rs.growthRaw,      minMax.growthRaw.min,      minMax.growthRaw.max),
          market:      _norm(rs.marketRaw,      minMax.marketRaw.min,      minMax.marketRaw.max),
          coverage:    _norm(rs.coverageRaw,    minMax.coverageRaw.min,    minMax.coverageRaw.max),
          migi:        _norm(rs.migiRaw,        minMax.migiRaw.min,        minMax.migiRaw.max)
        };
        var total = +(
          s.realization * 0.30 +
          s.growth      * 0.25 +
          s.market      * 0.20 +
          s.coverage    * 0.15 +
          s.migi        * 0.10
        ).toFixed(1);

        // ── Sınıflandırma ────────────────────────────────
        var classification;
        var highGrowth  = s.growth   >= 60;
        var highCov     = s.coverage <= 30; // düşük coverage skoru = iyi kapsanmış
        var lowReal     = rs.realizationRaw >= 15; // ciddi açık
        var migiGood    = rs.migi.miAvg && rs.migi.miAvg >= 110;
        var noVisit     = rs.ecz.daysSince > 21;

        if (lowReal && noVisit) {
          classification = 'RESCUE'; // hızlı düşüş + ziyaret yok
        } else if (highGrowth && !highCov) {
          classification = 'OPPORTUNITY'; // büyük pazar + az kapsanmış
        } else if (highCov && !highGrowth) {
          classification = 'SATURATED'; // yoğun kapsama + az büyüme
        } else {
          classification = 'STABLE';
        }

        // ── Neden seçildi? ────────────────────────────────
        var reasons = [];
        if (s.realization >= 70) reasons.push('yüksek realizasyon açığı');
        if (s.growth      >= 70) reasons.push('büyük pazar potansiyeli');
        if (s.market      >= 70) reasons.push('yüksek pazar fırsatı');
        if (s.coverage    >= 70) reasons.push('uzun ziyaretsiz kalma');
        if (s.migi        >= 70) reasons.push('MI&GI fırsatı');

        var reason = reasons.length
          ? reasons.join(', ')
          : 'dengeli performans';

        var detail = 'Pazar hacmi: ' + (rs.ims.pazarSum || 0).toFixed(0) + ' kutu';
        if (rs.ecz.eczaneCount) detail += ' | ' + rs.ecz.eczaneCount + ' eczane';
        if (rs.migi.sira && rs.migi.sira <= 333) detail += ' | Sıra: #' + rs.migi.sira;

        return {
          brick:          rs.brick,
          score:          total,
          classification: classification,
          reason:         reason,
          detail:         detail,
          scores: {
            realization: +s.realization.toFixed(1),
            growth:      +s.growth.toFixed(1),
            market:      +s.market.toFixed(1),
            coverage:    +s.coverage.toFixed(1),
            migi:        +s.migi.toFixed(1)
          }
        };
      });

      ranked.sort(function (a, b) { return b.score - a.score; });
      return ranked;

    } catch (e) {
      console.warn('[brick-ranking-engine] rankBricks hata:', e.message);
      return [];
    }
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.rankBricks = rankBricks;
  console.debug('[brick-ranking-engine] Phase 3.3 yüklendi.');

})();
