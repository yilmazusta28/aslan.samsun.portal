// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/opportunity-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  AI MİMARİ STABİLİZASYONU GÜNCELLEMESİ — IMS erişimi artık
//  js/ai/core/ims-adapter.js üzerinden, parser'a (IMS) DOĞRUDAN ERİŞMEZ
//  (Master Prompt'un açık talebi: "İleride kullanılacak. Şimdiden adapter
//  ile çalışacak şekilde hazırla.").
//
//  Sorumluluk: Büyüme fırsatlarını tespit et, önceliklendir
//    • findOpportunities(ttt) → opportunity[]
//
//  ⚠️ AUDIT NOTU — O1 "Brick Büyüme" / O2 "Saldırı Fırsatı" (bkz.
//    AI_MIMARI_STABILIZASYON_RAPORU.md):
//    Bu iki blok ÖNCEDEN r.bizim_pay / r.pazar_pay / r.rakip_pay
//    okuyordu — risk-engine.js / insight-engine.js'teki AYNI durum:
//    projenin hiçbir yerinde GERÇEK bir veri kaynağı YOK. Bu nedenle bu
//    bloklar her zaman sessizce 0 fırsat üretiyordu ve KASITLI OLARAK
//    ÖYLE BIRAKILDI — tek değişiklik: doğrudan IMS erişimi kaldırıldı
//    (ims-adapter.js üzerinden, brick bazlı gruplama ile — brick alanı
//    IMSRecord şemasında zaten mevcut olduğu için ek bir ikame
//    gerekmedi). "ilac_grubu" alanı adapter şemasında yok; metin
//    içindeki referansı, o brick'te görülen ürünlerin listesiyle
//    değiştirildi (productsInBrick).
//
//  Analiz edilen: ims-adapter.js (güçlü brick), MI&GI (fırsat brick),
//                 GENEL (büyüme potansiyeli olan ürünler)
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js (GENEL, MIGI_BRICK_TL_RAW)
//  Yükleme sırası: ims-adapter.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, MIGI_BRICK_TL_RAW, MIGI_BRICK_KUTU_RAW */
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
      var imsRecords = (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function')
        ? window.IMSAdapter.normalizeIMS(ttt) : [];
      var migiRows  = (MIGI_BRICK_TL_RAW || []).filter(function(r){ return r.person === ttt; });
      var genelRows = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });

      var byBrick = (imsRecords.length && window.IMSAdapter && typeof window.IMSAdapter.groupRecordsBy === 'function')
        ? window.IMSAdapter.groupRecordsBy(imsRecords, 'brick') : {};

      // ── O1: Yüksek pazar payı → büyüme potansiyeli brick ─
      // bkz. dosya başlığı ⚠️ AUDIT NOTU — bizim_pay/pazar_pay hiçbir
      // gerçek veri kaynağında yok, bu blok kasıtlı olarak sessizce 0
      // fırsat üretir (geçmişte de öyleydi).
      if (imsRecords.length) {
        var strongBricks = [];
        Object.keys(byBrick).forEach(function(brick) {
          var rows = byBrick[brick];
          var bizimArr = rows.map(function(r){ return r.bizim_pay || 0; }); // gerçek veri kaynağı YOK — daima 0
          var pazarArr = rows.map(function(r){ return r.pazar_pay || 0; }); // gerçek veri kaynağı YOK — daima 0
          var avgBiz  = bizimArr.reduce(function(s,v){ return s+v; }, 0) / bizimArr.length;
          var avgPaz  = pazarArr.reduce(function(s,v){ return s+v; }, 0) / pazarArr.length;
          var productsInBrick = rows.map(function(r){ return r.product; }).filter(function(v,i,a){ return a.indexOf(v) === i; });
          // Zaten güçlü olduğumuz ve hâlâ büyüme payı olan brickler
          if (avgBiz >= 30 && avgPaz > avgBiz * 1.5) {
            strongBricks.push({ brick: brick, bizim: avgBiz, pazar: avgPaz, products: productsInBrick });
          }
        });

        strongBricks.sort(function(a, b){ return (b.pazar - b.bizim) - (a.pazar - a.bizim); });
        strongBricks.slice(0, 3).forEach(function(b) {
          opps.push({ priority: priority++, title: b.brick + ' Brick Büyüme',
            reason: 'Mevcut pazar payı %' + b.bizim.toFixed(1) + ' — pazar büyüklüğü %' + b.pazar.toFixed(1) + '.',
            detail: b.products.join(', ') + ' ürünlerinde güçlü konum; daha fazla pay alınabilir.' });
        });
      }

      // ── O2: Rakibin zayıf olduğu brickler (saldırı fırsatı)
      // bkz. dosya başlığı ⚠️ AUDIT NOTU — aynı durum, daima 0 fırsat.
      if (imsRecords.length) {
        var attackBricks = [];
        Object.keys(byBrick).forEach(function(brick) {
          var rows = byBrick[brick];
          var rakipArr = rows.map(function(r){ return r.rakip_pay || 0; }); // gerçek veri kaynağı YOK — daima 0
          var bizimArr = rows.map(function(r){ return r.bizim_pay || 0; }); // gerçek veri kaynağı YOK — daima 0
          var avgRak  = rakipArr.reduce(function(s,v){ return s+v; }, 0) / rakipArr.length;
          var avgBiz  = bizimArr.reduce(function(s,v){ return s+v; }, 0) / bizimArr.length;
          var productsInBrick = rows.map(function(r){ return r.product; }).filter(function(v,i,a){ return a.indexOf(v) === i; });
          if (avgRak < 20 && avgBiz < avgRak) {
            attackBricks.push({ brick: brick, rakip: avgRak, bizim: avgBiz, products: productsInBrick });
          }
        });

        attackBricks.sort(function(a, b){ return a.rakip - b.rakip; });
        attackBricks.slice(0, 2).forEach(function(b) {
          opps.push({ priority: priority++, title: b.brick + ' Saldırı Fırsatı',
            reason: 'Rakip %' + b.rakip.toFixed(1) + ' payda zayıf — bizim pay %' + b.bizim.toFixed(1) + '.',
            detail: b.products.join(', ') + ' ürünlerinde rakip baskısı düşük; hızlı pay artışı mümkün.' });
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
  console.debug('[opportunity-engine] Phase 3.0 yüklendi (ims-adapter.js üzerinden).');

})();
