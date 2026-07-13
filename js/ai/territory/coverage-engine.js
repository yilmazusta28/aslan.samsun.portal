// ══════════════════════════════════════════════════════════════════════
//  js/ai/territory/coverage-engine.js
//  Phase 3.3 — Territory Optimization Engine
//
//  Sorumluluk: Bölge kapsama analizini üret
//    • analyzeCoverage(ttt) → coverageResult[]
//
//  Kapsama Metrikleri:
//    - Brickdeki aktif eczane sayısı (ECZANE_RAW)
//    - IMS potansiyel eczane sayısı (proxy: pazar hacmi / ortalama sipariş)
//    - Kapsama oranı: gerçek / potansiyel × 100
//    - Son ziyaret tarihi → recency skoru
//    - Ürün penetrasyon: kaç farklı ürün sattı?
//
//  Status: UNDER_COVERED | ADEQUATE | WELL_COVERED | UNTOUCHED
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: data-state.js, ECZANE_RAW, IMS, MIGI_BRICK_TL_RAW
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMS, MIGI_BRICK_TL_RAW, ECZANE_RAW, eczaneLoaded */

(function () {
  'use strict';

  // ── analyzeCoverage ───────────────────────────────────────
  // @param {string} ttt
  // @returns {Array<{
  //   area: string,          — brick adı
  //   coverage: number,      — 0-100 kapsama %
  //   status: string,        — UNDER_COVERED | ADEQUATE | WELL_COVERED | UNTOUCHED
  //   eczaneCount: number,   — aktif eczane
  //   potentialCount: number,— tahmini potansiyel eczane
  //   daysSinceLastVisit: number,
  //   productPenetration: number, — kaç farklı ürün 0-100
  //   detail: string
  // }>}
  function analyzeCoverage(ttt) {
    if (!ttt) return [];

    try {
      // ── IMS bricklerini topla (pazar bilgisi) ─────────────
      var imsBricks = {};
      (IMS || []).filter(function (r) { return r.ttt === ttt; }).forEach(function (r) {
        var key = (r.brick || '').toUpperCase();
        if (!key) return;
        if (!imsBricks[key]) imsBricks[key] = { pazarHacim: 0, n: 0 };
        imsBricks[key].pazarHacim += (r.toplam || 0);
        imsBricks[key].n++;
      });

      // ── MIGI bricklerini ekle (sira bilgisi, EN GÜNCEL döneme göre) ──
      // BUG DÜZELTMESİ: eskiden tüm ayların en iyisi/en düşüğü alınıyordu
      // — bkz. prim-calc.js'deki aynı düzeltme notu.
      var _migiDonemNum = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
      var _migiRowsByBrick = {};
      (MIGI_BRICK_TL_RAW || []).filter(function (r) { return r.person === ttt; }).forEach(function (r) {
        var key = (r.brick || '').toUpperCase();
        if (!key) return;
        if (!_migiRowsByBrick[key]) _migiRowsByBrick[key] = [];
        _migiRowsByBrick[key].push(r);
      });
      var migiBricks = {};
      Object.keys(_migiRowsByBrick).forEach(function (key) {
        var rows = _migiRowsByBrick[key];
        var latest = rows.reduce(function (max, r) { return Math.max(max, _migiDonemNum(r.donem)); }, 0);
        var latestRow = rows.filter(function (r) { return _migiDonemNum(r.donem) === latest; })[0];
        migiBricks[key] = { sira: (latestRow && latestRow.sira) || 999 };
      });

      // ── ECZANE verisi ─────────────────────────────────────
      var eczBricks = {};
      var now = new Date();
      if (eczaneLoaded && ECZANE_RAW) {
        (ECZANE_RAW || []).filter(function (r) { return r.ttt === ttt; }).forEach(function (r) {
          var key = (r.brick || '').toUpperCase();
          if (!key) return;
          if (!eczBricks[key]) eczBricks[key] = {
            eczaneler: new Set(), urunler: new Set(), adet: 0, lastDate: null
          };
          eczBricks[key].eczaneler.add(r.gln || r.ad);
          eczBricks[key].urunler.add((r.urun || '').toUpperCase());
          eczBricks[key].adet += (r.adet || 0);
          if (r.tarih) {
            var parts = r.tarih.split('.');
            if (parts.length >= 3) {
              var d = new Date(parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0'));
              if (!isNaN(d) && (!eczBricks[key].lastDate || d > eczBricks[key].lastDate)) {
                eczBricks[key].lastDate = d;
              }
            }
          }
        });
      }

      // ── Tüm brickleri birleştir ve kapsama hesapla ────────
      var allBricks = new Set();
      Object.keys(imsBricks).forEach(function(k){ allBricks.add(k); });
      Object.keys(migiBricks).forEach(function(k){ allBricks.add(k); });

      if (!allBricks.size) return [];

      // Ortalama sipariş miktarı (potansiyel eczane hesabı için proxy)
      var avgOrderSize = 5; // kutu/eczane — ilaç sektörü tipik

      var results = [];
      allBricks.forEach(function (brick) {
        var ims  = imsBricks[brick]  || { pazarHacim: 0 };
        var migi = migiBricks[brick] || { sira: 999 };
        var ecz  = eczBricks[brick]  || null;

        // Aktif eczane sayısı
        var eczaneCount = ecz ? ecz.eczaneler.size : 0;

        // Potansiyel eczane: pazar hacmi / avg sipariş
        // Sira ≤ 333 olan bricklerde en az 5 eczane beklenir
        var potentialFromIms  = ims.pazarHacim > 0 ? Math.max(3, Math.round(ims.pazarHacim / avgOrderSize)) : 5;
        var potentialFromSira = migi.sira <= 100 ? 15 : migi.sira <= 333 ? 8 : 4;
        var potentialCount    = Math.max(potentialFromIms, potentialFromSira);

        // Kapsama %
        var coverage = potentialCount > 0
          ? Math.min(100, Math.round((eczaneCount / potentialCount) * 100))
          : 0;

        // Recency
        var daysSince = 999;
        if (ecz && ecz.lastDate) {
          daysSince = Math.floor((now - ecz.lastDate) / (1000 * 60 * 60 * 24));
        }

        // Ürün penetrasyon (kaç ürün sattı → 0-100)
        var urunSayisi = ecz ? ecz.urunler.size : 0;
        var maxUrun    = 5; // URUN_ORDER.length
        var penetration = Math.round((urunSayisi / maxUrun) * 100);

        // Status
        var status;
        if (eczaneCount === 0) {
          status = 'UNTOUCHED';
        } else if (coverage < 40) {
          status = 'UNDER_COVERED';
        } else if (coverage < 70) {
          status = 'ADEQUATE';
        } else {
          status = 'WELL_COVERED';
        }

        // Recency penalty: 30+ gün ziyaretsiz → kapsama düşür
        if (daysSince > 30 && status === 'WELL_COVERED') status = 'ADEQUATE';
        if (daysSince > 45 && status === 'ADEQUATE')     status = 'UNDER_COVERED';

        var detail = eczaneCount + '/' + potentialCount + ' eczane';
        if (daysSince < 999) detail += ' | Son ziyaret: ' + daysSince + ' gün önce';
        if (migi.sira <= 333) detail += ' | Sıra #' + migi.sira;

        results.push({
          area:               brick,
          coverage:           coverage,
          status:             status,
          eczaneCount:        eczaneCount,
          potentialCount:     potentialCount,
          daysSinceLastVisit: daysSince,
          productPenetration: penetration,
          detail:             detail
        });
      });

      // Kapsama artan, potansiyel azalan sıra
      results.sort(function (a, b) {
        if (a.status === 'UNTOUCHED' && b.status !== 'UNTOUCHED') return -1;
        if (b.status === 'UNTOUCHED' && a.status !== 'UNTOUCHED') return 1;
        return a.coverage - b.coverage; // en düşük kapsama önce
      });

      return results;

    } catch (e) {
      console.warn('[coverage-engine] analyzeCoverage hata:', e.message);
      return [];
    }
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.analyzeCoverage = analyzeCoverage;
  console.debug('[coverage-engine] Phase 3.3 yüklendi.');

})();
