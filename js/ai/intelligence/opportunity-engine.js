// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/opportunity-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//
//  Sorumluluk: Büyüme fırsatlarını tespit et, önceliklendir
//    • findOpportunities(ttt) → opportunity[]
//
//  Analiz edilen: IMS (güçlü brick), MI&GI (fırsat brick),
//                 GENEL (büyüme potansiyeli olan ürünler)
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//
//  Bağımlılık: js/data/data-state.js, js/core/constants.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMS, GENEL, MIGI_BRICK_TL_RAW, MIGI_BRICK_KUTU_RAW */
/* global OWN_IMS */

(function() {
  'use strict';

  // ── findOpportunities ─────────────────────────────────────
  // @param {string} ttt
  // @returns {Array<{ priority: number, title: string, reason: string, detail: string }>}
  function findOpportunities(ttt) {
    if (!ttt) return [];
    var opps = [];
    var priority = 1;

    try {
      var imsRows  = (IMS  || []).filter(function(r){ return r.ttt === ttt; });
      var migiRows = (MIGI_BRICK_TL_RAW || []).filter(function(r){ return r.person === ttt; });
      var genelRows = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });

      // ── O1: Yüksek pazar payı → büyüme potansiyeli brick ─
      if (imsRows.length) {
        var brickPayMap = {};
        imsRows.forEach(function(r) {
          if (!brickPayMap[r.brick]) brickPayMap[r.brick] = { bizim: [], pazar: [], grp: r.ilac_grubu };
          brickPayMap[r.brick].bizim.push(r.bizim_pay || 0);
          brickPayMap[r.brick].pazar.push(r.pazar_pay || 0);
        });

        var strongBricks = [];
        Object.keys(brickPayMap).forEach(function(brick) {
          var b       = brickPayMap[brick];
          var avgBiz  = b.bizim.reduce(function(s,v){ return s+v; }, 0) / b.bizim.length;
          var avgPaz  = b.pazar.reduce(function(s,v){ return s+v; }, 0) / b.pazar.length;
          // Zaten güçlü olduğumuz ve hâlâ büyüme payı olan brickler
          if (avgBiz >= 30 && avgPaz > avgBiz * 1.5) {
            strongBricks.push({ brick: brick, bizim: avgBiz, pazar: avgPaz, grp: b.grp });
          }
        });

        strongBricks.sort(function(a, b){ return (b.pazar - b.bizim) - (a.pazar - a.bizim); });
        strongBricks.slice(0, 3).forEach(function(b) {
          opps.push({ priority: priority++, title: b.brick + ' Brick Büyüme',
            reason: 'Mevcut pazar payı %' + b.bizim.toFixed(1) + ' — pazar büyüklüğü %' + b.pazar.toFixed(1) + '.',
            detail: b.grp + ' grubunda güçlü konum; daha fazla pay alınabilir.' });
        });
      }

      // ── O2: Rakibin zayıf olduğu brickler (saldırı fırsatı)
      if (imsRows.length) {
        var rakipZayifMap = {};
        imsRows.forEach(function(r) {
          if (!rakipZayifMap[r.brick]) rakipZayifMap[r.brick] = { rakip: [], bizim: [], grp: r.ilac_grubu };
          rakipZayifMap[r.brick].rakip.push(r.rakip_pay || 0);
          rakipZayifMap[r.brick].bizim.push(r.bizim_pay || 0);
        });

        var attackBricks = [];
        Object.keys(rakipZayifMap).forEach(function(brick) {
          var b       = rakipZayifMap[brick];
          var avgRak  = b.rakip.reduce(function(s,v){ return s+v; }, 0) / b.rakip.length;
          var avgBiz  = b.bizim.reduce(function(s,v){ return s+v; }, 0) / b.bizim.length;
          if (avgRak < 20 && avgBiz < avgRak) {
            attackBricks.push({ brick: brick, rakip: avgRak, bizim: avgBiz, grp: b.grp });
          }
        });

        attackBricks.sort(function(a, b){ return a.rakip - b.rakip; });
        attackBricks.slice(0, 2).forEach(function(b) {
          opps.push({ priority: priority++, title: b.brick + ' Saldırı Fırsatı',
            reason: 'Rakip %' + b.rakip.toFixed(1) + ' payda zayıf — bizim pay %' + b.bizim.toFixed(1) + '.',
            detail: b.grp + ' grubunda rakip baskısı düşük; hızlı pay artışı mümkün.' });
        });
      }

      // ── O3: MI&GI — ilk 333 yüksek potansiyel brickler ──
      if (migiRows.length) {
        var mgBrickMap = {};
        migiRows.forEach(function(r) {
          if (!mgBrickMap[r.brick]) mgBrickMap[r.brick] = { mi: [], bi: [], sira: r.sira };
          if (r.mi != null) mgBrickMap[r.brick].mi.push(r.mi);
          if (r.bi != null) mgBrickMap[r.brick].bi.push(r.bi);
        });

        // İlk 333 + MI yüksek + GI yüksek → reçete büyümesi potansiyeli
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
        return p >= 60 && p < 85; // kritik değil ama açık var
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
  console.debug('[opportunity-engine] Phase 3.0 yüklendi.');

})();
