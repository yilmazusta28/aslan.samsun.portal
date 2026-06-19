// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/insight-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  Phase 1 Refactor — IMS Data Model Unification
//
//  Sorumluluk: Ham satış verisinden otomatik insight üretimi
//    • generateInsights(ttt) → insight[]
//
//  DEĞİŞİKLİK: r.hafta, r.bizim_pay, r.pazar_pay → YOK.
//    Pazar payı IMSAdapter.getMarketShare() üzerinden hesaplanıyor.
//    IMS global'a doğrudan erişim YOK.
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMSAdapter, GENEL, MIGI_BRICK_TL_RAW */
/* global OWN_IMS, URUN_ORDER */

(function() {
  'use strict';

  // ── generateInsights ───────────────────────────────────────
  // @param {string} ttt
  // @returns {Array<{type, level, text}>}
  function generateInsights(ttt) {
    if (!ttt) return [];
    var insights = [];

    try {
      var genelRows  = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
      var genelTotal = (GENEL || []).find(function(r){ return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      var migiRows   = (MIGI_BRICK_TL_RAW || []).filter(function(r){ return r.person === ttt; });

      if (!genelTotal) return insights;

      var totalPct = genelTotal.tl_pct || 0;

      // ── 1. Genel performans seviyesi ─────────────────────
      if (totalPct >= 91) {
        insights.push({ type: 'achievement', level: 'positive',
          text: 'Genel TL realizasyonu %91 üzerinde — prim hedefi rotasında.' });
      } else if (totalPct >= 75) {
        insights.push({ type: 'achievement', level: 'warning',
          text: 'Genel TL realizasyonu %' + totalPct.toFixed(1) + ' — %91 hedefine ' + (91 - totalPct).toFixed(1) + ' puan kaldı.' });
      } else {
        insights.push({ type: 'achievement', level: 'negative',
          text: 'Genel TL realizasyonu %' + totalPct.toFixed(1) + ' — kritik açık. Acil aksiyon gerekli.' });
      }

      // ── 2. En güçlü ürün ─────────────────────────────────
      if (genelRows.length) {
        var strongest = genelRows.reduce(function(a, b){ return (b.tl_pct || 0) > (a.tl_pct || 0) ? b : a; }, genelRows[0]);
        if (strongest && (strongest.tl_pct || 0) >= 91) {
          insights.push({ type: 'strength', level: 'positive',
            text: strongest.urun + ' en güçlü ürün — %' + (strongest.tl_pct || 0).toFixed(1) + ' realizasyon ile hedefe ulaşmış.' });
        }
      }

      // ── 3. En zayıf ürün ─────────────────────────────────
      if (genelRows.length) {
        var weakest = genelRows.reduce(function(a, b){ return (b.tl_pct || 0) < (a.tl_pct || 0) ? b : a; }, genelRows[0]);
        if (weakest && (weakest.tl_pct || 0) < 70) {
          insights.push({ type: 'weakness', level: 'negative',
            text: weakest.urun + ' en zayıf ürün — %' + (weakest.tl_pct || 0).toFixed(1) + ' ile kritik açık var.' });
        }
      }

      // ── 4. Pazar büyüme karşılaştırması — adapter kullanılıyor
      // eskiden: r.hafta, r.bizim_pay, r.pazar_pay — IMS'te YOK.
      // Şimdi: IMSAdapter.getMarketShare() hesaplanmış pazar payı döner.
      var marketShare = IMSAdapter.getMarketShare(ttt);
      Object.keys(marketShare).forEach(function(grp) {
        var ms = marketShare[grp];
        var bizimPay  = ms.bizimPay || 0;
        var pazarPct  = ms.pazarToplam > 0 ? 100 : 0; // pazar = 100%

        if (bizimPay > 0) {
          if (bizimPay > 50) {
            insights.push({ type: 'growth', level: 'positive',
              text: grp + ' pazarında güçlü konum: %' + bizimPay.toFixed(1) + ' pazar payı.' });
          } else if (bizimPay < 20) {
            insights.push({ type: 'growth', level: 'negative',
              text: grp + ' pazarında zayıf konum: %' + bizimPay.toFixed(1) + ' pazar payı. Rakip baskısı var.' });
          }
        }
      });

      // ── 5. MI&GI brick anomalisi ─────────────────────────
      if (migiRows.length) {
        var brickMap = {};
        migiRows.forEach(function(r) {
          if (!brickMap[r.brick]) brickMap[r.brick] = { mi: [], bi: [], sira: r.sira };
          if (r.mi != null) brickMap[r.brick].mi.push(r.mi);
          if (r.bi != null) brickMap[r.brick].bi.push(r.bi);
        });

        var brickList = Object.keys(brickMap).map(function(brick) {
          var b = brickMap[brick];
          var miAvg = b.mi.length ? b.mi.reduce(function(s,v){ return s+v; }, 0) / b.mi.length : null;
          var biAvg = b.bi.length ? b.bi.reduce(function(s,v){ return s+v; }, 0) / b.bi.length : null;
          return { brick: brick, mi: miAvg, bi: biAvg, sira: b.sira };
        });

        var topBrick = brickList.filter(function(b){ return b.sira <= 333 && b.mi >= 110 && b.bi >= 100; });
        if (topBrick.length) {
          insights.push({ type: 'migi', level: 'positive',
            text: 'İlk 333 brick içinde ' + topBrick.length + ' yüksek performanslı brick (MI≥110, GI≥100).' });
        }

        var riskBrick = brickList.filter(function(b){ return b.mi != null && b.mi < 90; });
        if (riskBrick.length >= 3) {
          insights.push({ type: 'migi', level: 'warning',
            text: riskBrick.length + ' brick\'te MI endeksi 90 altında — MI&GI prim riski mevcut.' });
        }
      }

      // ── 6. Realizasyon anomalisi — ürün uyumsuzluğu ──────
      var highPct = genelRows.filter(function(r){ return (r.tl_pct || 0) >= 95; });
      var lowPct  = genelRows.filter(function(r){ return (r.tl_pct || 0) < 70; });
      if (highPct.length > 0 && lowPct.length > 0) {
        insights.push({ type: 'anomaly', level: 'warning',
          text: 'Ürün dengesi bozuk: ' + highPct.map(function(r){ return r.urun; }).join(', ') +
            ' güçlü iken ' + lowPct.map(function(r){ return r.urun; }).join(', ') + ' kritik açıkta.' });
      }

    } catch (e) {
      console.warn('[insight-engine] generateInsights hata:', e.message);
    }

    return insights;
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.generateInsights = generateInsights;
  console.debug('[insight-engine] Phase 3.0 + Phase 1 Refactor yüklendi.');

})();
