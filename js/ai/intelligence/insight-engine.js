// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/insight-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  AI MİMARİ STABİLİZASYONU GÜNCELLEMESİ — IMS erişimi artık
//  js/ai/core/ims-adapter.js üzerinden, parser'a (IMS) DOĞRUDAN ERİŞMEZ.
//
//  Sorumluluk: Ham satış verisinden otomatik insight üretimi
//    • generateInsights(ttt) → insight[]
//
//  ⚠️ AUDIT NOTU — "Pazar büyüme karşılaştırması" (bkz. AI_MIMARI_STABILIZASYON_RAPORU.md):
//    Bu blok ÖNCEDEN r.hafta / r.bizim_pay / r.pazar_pay okuyordu — bunlar
//    risk-engine.js'teki bizim_pay/rakip_pay ile AYNI durumda: projenin
//    hiçbir yerinde GERÇEK bir veri kaynağı YOK (own_tl/own_kutu'nun
//    aksine, h1..h9 gibi bir ikamesi de yok). Bu nedenle bu blok her
//    zaman sessizce 0 insight üretiyordu ve KASITLI OLARAK ÖYLE
//    BIRAKILDI — tek değişiklik: doğrudan IMS erişimi kaldırıldı
//    (ims-adapter.js üzerinden, ürün bazlı gruplama ile).
//
//  ✅ YENİ — "IMS Haftalık Trend" insight'ı (Master Prompt'un açık talebi
//    üzerine eklendi: "Trend hesapları Adapter üzerinden alınacak"):
//    Bu motorun ÖNCEDEN HİÇ ÇALIŞAN bir trend insight'ı YOKTU (yukarıdaki
//    "pazar büyüme" bloğu trend değil, market-share idi ve zaten ölüydü).
//    js/ai/core/ims-adapter.js artık GERÇEK h1..h9 haftalık hacim
//    verisinden trend/growth hesaplayabildiği için, bu motor ürün bazlı
//    GERÇEKTEN ÇALIŞAN bir trend insight'ı üretebiliyor (örn. "PANOCER
//    haftalık satışlarda güçlü yükseliş gösteriyor"). Bu YENİ bir
//    insight türüdür (mevcut bir özelliğin yerini almaz, ekler).
//
//  ✅ YENİ — "Önceki Dönem Karşılaştırması" insight'ı (Blok 7):
//    js/ai/core/period-archive-adapter.js üzerinden, 6 aylık arşivde
//    kayıtlı bir önceki dönemin final realizasyonuyla mevcut dönem
//    karşılaştırılır. Arşiv boşsa (örn. uygulamanın ilk dönemi)
//    sessizce hiçbir insight üretmez — rollback-safe.
//
//  Analiz edilen veriler: ims-adapter.js (IMS), GENEL, KUTU, MIGI_BRICK_TL_RAW
//  AI çağrısı: YOK — tamamen yerel hesaplama
//  UI değişikliği: YOK
//
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js (GENEL, KUTU, MIGI_BRICK_TL_RAW)
//  Yükleme sırası: ims-adapter.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, KUTU, MIGI_BRICK_TL_RAW */
/* global OWN_IMS, URUN_ORDER */

(function() {
  'use strict';

  // Trend insight'ının "gürültü" üretmemesi için minimum eşikler —
  // ims-adapter.js'in calculateGrowth()'u % bazlı döner, bu eşik de
  // RELATİF (ölçek bağımsız) bir anlam taşır.
  var TREND_INSIGHT_GROWTH_THRESHOLD_PCT = 15;

  // ── generateInsights ───────────────────────────────────────
  // Temsilci verilerini analiz edip insight dizisi döndürür.
  // @param {string} ttt — temsilci kodu
  // @returns {Array<{type, level, text}>}
  function generateInsights(ttt) {
    if (!ttt) return [];
    var insights = [];

    try {
      var genelRows  = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
      var genelTotal = (GENEL || []).find(function(r){ return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      var imsRecords = (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function')
        ? window.IMSAdapter.normalizeIMS(ttt) : [];
      var migiRows   = (MIGI_BRICK_TL_RAW || []).filter(function(r){ return r.person === ttt; });

      if (!genelTotal) return insights;

      var totalPct = genelTotal.tl_pct || 0;
      var totalTL  = genelTotal.satis_tl || 0;
      var hedefTL  = genelTotal.hedef_tl || 0;

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

      // ── 4. Pazar büyüme karşılaştırması (ürün bazlı — adapter üzerinden)
      // bkz. dosya başlığı ⚠️ AUDIT NOTU — bizim_pay/pazar_pay hiçbir
      // gerçek veri kaynağında yok, bu blok kasıtlı olarak sessizce 0
      // insight üretir (geçmişte de öyleydi).
      if (imsRecords.length) {
        var byProduct4 = (window.IMSAdapter && typeof window.IMSAdapter.groupRecordsBy === 'function')
          ? window.IMSAdapter.groupRecordsBy(imsRecords, 'product') : {};

        Object.keys(byProduct4).forEach(function(urun) {
          var rows = byProduct4[urun];
          var latest = rows[rows.length - 1]; // hafta sırası YOK — gerçek veri kaynağı eklenince güncellenmeli
          if (!latest) return;

          var bizimPay  = latest.bizim_pay  || 0; // gerçek veri kaynağı YOK — daima 0
          var pazarPay  = latest.pazar_pay  || 0; // gerçek veri kaynağı YOK — daima 0

          if (bizimPay > 0 && pazarPay > 0) {
            var payOrani = bizimPay / pazarPay;
            if (payOrani > 0.5) {
              insights.push({ type: 'growth', level: 'positive',
                text: urun + ' pazarında güçlü konum: %' + bizimPay.toFixed(1) + ' pazar payı.' });
            } else if (payOrani < 0.2) {
              insights.push({ type: 'growth', level: 'negative',
                text: urun + ' pazarında zayıf konum: %' + bizimPay.toFixed(1) + ' pazar payı. Rakip baskısı var.' });
            }
          }
        });
      }

      // ── 4b. IMS Haftalık Trend (YENİ — ims-adapter.js üzerinden,
      //     gerçek h1..h9 hacim verisinden). Sadece BELİRGİN (eşik
      //     üstü) hareketler raporlanır — gürültü üretmez.
      if (imsRecords.length) {
        var byProduct4b = (window.IMSAdapter && typeof window.IMSAdapter.groupRecordsBy === 'function')
          ? window.IMSAdapter.groupRecordsBy(imsRecords, 'product') : {};

        Object.keys(byProduct4b).forEach(function(urun) {
          var productAgg = (window.IMSAdapter && typeof window.IMSAdapter.aggregateRecords === 'function')
            ? window.IMSAdapter.aggregateRecords(byProduct4b[urun]) : null;
          if (!productAgg) return;

          var growth = productAgg.calculated.growth;
          var trend  = productAgg.calculated.trend;

          if (trend === 'up' && growth >= TREND_INSIGHT_GROWTH_THRESHOLD_PCT) {
            insights.push({ type: 'trend', level: 'positive',
              text: urun + ' haftalık satışlarda güçlü yükseliş gösteriyor (yaklaşık %' + growth.toFixed(1) + ' artış).' });
          } else if (trend === 'down' && growth <= -TREND_INSIGHT_GROWTH_THRESHOLD_PCT) {
            insights.push({ type: 'trend', level: 'negative',
              text: urun + ' haftalık satışlarda belirgin düşüş gösteriyor (yaklaşık %' + Math.abs(growth).toFixed(1) + ' azalış).' });
          }
        });
      }

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

      // ── 7. Önceki Dönem Karşılaştırması (6 Aylık Arşiv — YENİ) ──
      // js/ai/core/period-archive-adapter.js üzerinden, GENEL_TABLO.csv
      // dönem sonunda sıfırlanmadan ÖNCE arşivlenmiş bir önceki dönemin
      // final realizasyonuyla mevcut dönemi karşılaştırır. Arşivde veri
      // yoksa (ör. uygulamanın ilk dönemi) SESSİZCE hiçbir şey üretmez.
      if (window.PeriodArchiveAdapter && typeof window.PeriodArchiveAdapter.getPreviousArchivedPeriod === 'function') {
        var prevPeriod = window.PeriodArchiveAdapter.getPreviousArchivedPeriod(ttt);
        if (prevPeriod && prevPeriod.genelTotal) {
          var prevPct = prevPeriod.genelTotal.tl_pct || 0;
          var deltaPct = totalPct - prevPct;
          if (Math.abs(deltaPct) >= 10) {
            insights.push({ type: 'period_comparison', level: deltaPct > 0 ? 'positive' : 'negative',
              text: prevPeriod.label + ' realizasyonu %' + prevPct.toFixed(1) + ' idi, bu dönem %' +
                totalPct.toFixed(1) + ' (' + (deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + ' puan ' +
                (deltaPct > 0 ? 'artış' : 'düşüş') + ').' });
          }
        }
      }

    } catch (e) {
      console.warn('[insight-engine] generateInsights hata:', e.message);
    }

    return insights;
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.generateInsights = generateInsights;
  console.debug('[insight-engine] Phase 3.0 yüklendi (ims-adapter.js üzerinden).');

})();
