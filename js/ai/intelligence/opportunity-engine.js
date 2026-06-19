// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/opportunity-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  Phase 1 Refactor — IMS Data Model Unification
//
//  Sorumluluk: Büyüme fırsatlarını tespit et, önceliklendir
//    • findOpportunities(ttt) → opportunity[]
//
//  DEĞİŞİKLİK: r.bizim_pay, r.pazar_pay, r.rakip_pay → YOK.
//    Pazar payı IMSAdapter.getMarketShare() brick bazında hesaplanıyor.
//    IMS global'a doğrudan erişim YOK.
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMSAdapter, GENEL, MIGI_BRICK_TL_RAW, MIGI_BRICK_KUTU_RAW */

(function() {
  'use strict';

  // ── _buildBrickShareMap: brick × ilac_grubu bazında pazar payı haritası
  // IMS adapter cache'inden kendi ve toplam kutu → pay hesabı yapılır.
  // eskiden: r.bizim_pay, r.pazar_pay, r.rakip_pay — IMS'te bu sütunlar YOK.
  function _buildBrickShareMap(ttt) {
    var cache = IMSAdapter.getIMSCache();
    var map = {}; // brick → { bizimToplam, pazarToplam, grp }

    cache.filter(function(r){ return r.representative === ttt; }).forEach(function(r) {
      var key = r.brick;
      if (!map[key]) map[key] = { bizimToplam: 0, pazarToplam: 0, grp: r.ilac_grubu };
      if (r.isOwn) {
        map[key].bizimToplam += r.total;
      }
      if (r.isMkt) {
        map[key].pazarToplam += r.total;
      }
    });

    // Pay hesabı
    Object.keys(map).forEach(function(brick) {
      var b = map[brick];
      b.bizimPay = b.pazarToplam > 0
        ? Math.round((b.bizimToplam / b.pazarToplam) * 1000) / 10
        : 0;
      var rakipToplam = Math.max(0, b.pazarToplam - b.bizimToplam);
      b.rakipPay = b.pazarToplam > 0
        ? Math.round((rakipToplam / b.pazarToplam) * 1000) / 10
        : 0;
    });

    return map;
  }

  // ── findOpportunities ─────────────────────────────────────
  // @param {string} ttt
  // @returns {Array<{ priority: number, title: string, reason: string, detail: string }>}
  function findOpportunities(ttt) {
    if (!ttt) return [];
    var opps = [];
    var priority = 1;

    try {
      var migiRows  = (MIGI_BRICK_TL_RAW || []).filter(function(r){ return r.person === ttt; });
      var genelRows = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });

      // Brick bazlı pazar payı haritası (adapter üzerinden)
      var brickShareMap = _buildBrickShareMap(ttt);

      // ── O1: Yüksek pazar payı → büyüme potansiyeli brick ─
      var strongBricks = [];
      Object.keys(brickShareMap).forEach(function(brick) {
        var b = brickShareMap[brick];
        // Zaten güçlü olduğumuz ve hâlâ büyüme payı olan brickler
        if (b.bizimPay >= 30 && b.pazarToplam > b.bizimToplam * 1.5) {
          strongBricks.push({
            brick: brick,
            bizim: b.bizimPay,
            pazar: 100, // pazar = %100
            grp:   b.grp,
            gap:   100 - b.bizimPay
          });
        }
      });

      strongBricks.sort(function(a, b){ return b.gap - a.gap; });
      strongBricks.slice(0, 3).forEach(function(b) {
        opps.push({ priority: priority++, title: b.brick + ' Brick Büyüme',
          reason: 'Mevcut pazar payı %' + b.bizim.toFixed(1) + ' — büyüme potansiyeli var.',
          detail: b.grp + ' grubunda güçlü konum; daha fazla pay alınabilir.' });
      });

      // ── O2: Rakibin zayıf olduğu brickler (saldırı fırsatı)
      var attackBricks = [];
      Object.keys(brickShareMap).forEach(function(brick) {
        var b = brickShareMap[brick];
        if (b.rakipPay < 20 && b.bizimPay < b.rakipPay) {
          attackBricks.push({
            brick: brick,
            rakip: b.rakipPay,
            bizim: b.bizimPay,
            grp:   b.grp
          });
        }
      });

      attackBricks.sort(function(a, b){ return a.rakip - b.rakip; });
      attackBricks.slice(0, 2).forEach(function(b) {
        opps.push({ priority: priority++, title: b.brick + ' Saldırı Fırsatı',
          reason: 'Rakip tahmini %' + b.rakip.toFixed(1) + ' payda zayıf — bizim pay %' + b.bizim.toFixed(1) + '.',
          detail: b.grp + ' grubunda rakip baskısı düşük; hızlı pay artışı mümkün.' });
      });

      // ── O3: MI&GI — ilk 333 yüksek potansiyel brickler ──
      if (migiRows.length) {
        var mgBrickMap = {};
        migiRows.forEach(function(r) {
          if (!mgBrickMap[r.brick]) mgBrickMap[r.brick] = { mi: [], bi: [], sira: r.sira };
          if (r.mi != null) mgBrickMap[r.brick].mi.push(r.mi);
          if (r.bi != null) mgBrickMap[r.brick].bi.push(r.bi);
        });

        var mgOpps = [];
        Object.keys(mgBrickMap).forEach(function(brick) {
          var b    = mgBrickMap[brick];
          var sira = b.sira || 999;
          if (sira > 333) return;
          var mi = b.mi.length ? b.mi.reduce(function(s,v){ return s+v; },0)/b.mi.length : 0;
          var bi = b.bi.length ? b.bi.reduce(function(s,v){ return s+v; },0)/b.bi.length : 0;
          if (mi >= 110 && bi >= 100) {
            mgOpps.push({ brick: brick, sira: sira, mi: mi, bi: bi });
          }
        });

        mgOpps.sort(function(a,b){ return a.sira - b.sira; });
        mgOpps.slice(0, 3).forEach(function(b) {
          opps.push({ priority: priority++, title: b.brick + ' MI&GI Büyüme',
            reason: 'Sıra #' + b.sira + ' — MI:' + b.mi.toFixed(0) + ', GI:' + b.bi.toFixed(0) + '.',
            detail: 'Yüksek hekim yoğunluğu ve büyüme endeksi. Reçete artışı için öncelikli.' });
        });
      }

      // ── O4: Zayıf ürünlerde hızlı geri dönüş fırsatı ────
      var lowButRecoverable = genelRows.filter(function(r) {
        var p = r.tl_pct || 0;
        return p >= 60 && p < 85;
      });
      lowButRecoverable.sort(function(a, b){ return (a.tl_pct || 0) - (b.tl_pct || 0); });
      lowButRecoverable.slice(0, 2).forEach(function(r) {
        opps.push({ priority: priority++, title: r.urun + ' Hızlı Toparlanma',
          reason: '%' + (r.tl_pct || 0).toFixed(1) + ' realizasyonda — kritik eşiğin üstünde, toparlanabilir.',
          detail: 'Hedef TL: ' + ((r.hedef_tl || 0) / 1000).toFixed(0) + 'K | Kalan: ' +
            ((r.kalan_tl || 0) / 1000).toFixed(0) + 'K — odaklanarak kapatılabilir.' });
      });

    } catch (e) {
      console.warn('[opportunity-engine] findOpportunities hata:', e.message);
    }

    return opps;
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.findOpportunities = findOpportunities;
  console.debug('[opportunity-engine] Phase 3.0 + Phase 1 Refactor yüklendi.');

})();
