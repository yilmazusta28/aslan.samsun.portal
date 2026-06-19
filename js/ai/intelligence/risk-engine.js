// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/risk-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  Phase 1 Refactor — IMS Data Model Unification
//
//  Sorumluluk: Otomatik risk tespiti ve sınıflandırması
//    • detectRisks(ttt) → risk[]
//
//  DEĞİŞİKLİK: r.hafta, r.bizim_pay, r.rakip_pay → YOK.
//    Pazar payı IMSAdapter.getMarketShare() üzerinden hesaplanıyor.
//    IMS global'a doğrudan erişim YOK.
//
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global IMSAdapter, GENEL, MIGI_BRICK_TL_RAW */

(function() {
  'use strict';

  // ── detectRisks ───────────────────────────────────────────
  // @param {string} ttt
  // @returns {Array<{ severity: 'LOW'|'MEDIUM'|'HIGH', title: string, detail: string }>}
  function detectRisks(ttt) {
    if (!ttt) return [];
    var risks = [];

    try {
      var genelRows  = (GENEL || []).filter(function(r){ return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
      var genelTotal = (GENEL || []).find(function(r){ return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });
      var migiRows   = (MIGI_BRICK_TL_RAW || []).filter(function(r){ return r.person === ttt; });

      // ── Pazar payı: adapter'dan hesaplanmış ──────────────
      // r.bizim_pay / r.rakip_pay IMS'de yok; getMarketShare() kullanılıyor.
      var marketShare = IMSAdapter.getMarketShare(ttt);

      // ── R1: Genel TL realizasyon riski ───────────────────
      if (genelTotal) {
        var pct = genelTotal.tl_pct || 0;
        if (pct < 70) {
          risks.push({ severity: 'HIGH', title: 'Kritik Realizasyon Açığı',
            detail: 'Genel TL realizasyonu %' + pct.toFixed(1) + ' — prim eşiğinin çok altında (%91). Acil aksiyon gerekli.' });
        } else if (pct < 82) {
          risks.push({ severity: 'MEDIUM', title: 'Realizasyon Açığı',
            detail: 'Genel TL realizasyonu %' + pct.toFixed(1) + ' — %91 prim eşiğine ' + (91 - pct).toFixed(1) + ' puan kaldı.' });
        } else if (pct < 91) {
          risks.push({ severity: 'LOW', title: 'Sınırda Realizasyon',
            detail: 'Genel TL realizasyonu %' + pct.toFixed(1) + ' — %91 eşiği yakın, tempo korunmalı.' });
        }
      }

      // ── R2: Ürün bazlı kritik açıklar ────────────────────
      genelRows.forEach(function(r) {
        var p = r.tl_pct || 0;
        if (p < 60) {
          risks.push({ severity: 'HIGH', title: r.urun + ' Kritik Açık',
            detail: r.urun + ' realizasyonu %' + p.toFixed(1) + ' — portföy primini tehdit ediyor.' });
        } else if (p < 75) {
          risks.push({ severity: 'MEDIUM', title: r.urun + ' Düşük Realizasyon',
            detail: r.urun + ' realizasyonu %' + p.toFixed(1) + ' — ek satış baskısı gerekli.' });
        }
      });

      // ── R3: Pazar payı kaybı — adapter'dan hesaplanmış pazar payı kullanılıyor
      // eskiden: r.bizim_pay, r.rakip_pay — IMS'te bu sütunlar YOK.
      // Şimdi: getMarketShare() → { grp: { bizimPay, pazarToplam, bizimToplam } }
      Object.keys(marketShare).forEach(function(grp) {
        var ms = marketShare[grp];
        var bizimPay = ms.bizimPay || 0;
        // Rakip pay: pazar - bizim (yaklaşık; doğrudan sütun yok)
        var pazarToplam = ms.pazarToplam || 0;
        var bizimToplam = ms.bizimToplam || 0;
        var rakipToplam = Math.max(0, pazarToplam - bizimToplam);
        var rakipPay = pazarToplam > 0 ? (rakipToplam / pazarToplam) * 100 : 0;

        if (bizimPay < 15 && rakipPay > 30) {
          risks.push({ severity: 'HIGH', title: grp + ' Pazar Payı Kaybı',
            detail: 'Bizim pay %' + bizimPay.toFixed(1) + ' iken rakip tahmini %' + rakipPay.toFixed(1) + ' — öncelikli saldırı hedefi.' });
        } else if (bizimPay < 20 && rakipPay > 25) {
          risks.push({ severity: 'MEDIUM', title: grp + ' Pazar Payı Baskısı',
            detail: 'Bizim pay %' + bizimPay.toFixed(1) + ' — rakip baskısı mevcut.' });
        }
      });

      // ── R4: MI&GI brick zayıflığı ────────────────────────
      if (migiRows.length) {
        var brickMap = {};
        migiRows.forEach(function(r) {
          if (!brickMap[r.brick]) brickMap[r.brick] = { mi: [], bi: [], sira: r.sira };
          if (r.mi != null) brickMap[r.brick].mi.push(r.mi);
          if (r.bi != null) brickMap[r.brick].bi.push(r.bi);
        });

        var criticalBricks = [];
        var warnBricks     = [];

        Object.keys(brickMap).forEach(function(brick) {
          var b   = brickMap[brick];
          var mi  = b.mi.length ? b.mi.reduce(function(s,v){ return s+v; }, 0) / b.mi.length : null;
          var sira = b.sira || 999;
          if (sira <= 333 && mi !== null && mi < 80) criticalBricks.push(brick);
          else if (sira <= 333 && mi !== null && mi < 90) warnBricks.push(brick);
        });

        if (criticalBricks.length) {
          risks.push({ severity: 'HIGH', title: 'Kritik Brick MI Açığı',
            detail: 'İlk 333 brick\'te ' + criticalBricks.length + ' brick\'te MI endeksi 80 altında: ' +
              criticalBricks.slice(0, 3).join(', ') + (criticalBricks.length > 3 ? ' ve diğerleri.' : '.') });
        }
        if (warnBricks.length) {
          risks.push({ severity: 'MEDIUM', title: 'Brick MI Riski',
            detail: 'İlk 333 brick\'te ' + warnBricks.length + ' brick\'te MI endeksi 80-90 arasında.' });
        }
      }

      // ── R5: Portföy prim riski ────────────────────────────
      if (genelTotal) {
        var realPct = genelTotal.tl_pct || 0;
        var primPuani = genelRows.length
          ? genelRows.reduce(function(s,r){ return s + (r.tl_pct || 0); }, 0) / genelRows.length
          : 0;

        if (realPct < 91 && primPuani < 91) {
          risks.push({ severity: 'HIGH', title: 'Portföy Prim Riski',
            detail: 'Hem TL real (%' + realPct.toFixed(1) + ') hem de ürün ortalaması (%' + primPuani.toFixed(1) +
              ') %91 altında — portföy prim koşulu sağlanamıyor.' });
        }
      }

      risks.sort(function(a, b) {
        var order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return (order[a.severity] || 2) - (order[b.severity] || 2);
      });

    } catch (e) {
      console.warn('[risk-engine] detectRisks hata:', e.message);
    }

    return risks;
  }

  // ── EXPORT ─────────────────────────────────────────────────
  window.detectRisks = detectRisks;
  console.debug('[risk-engine] Phase 3.0 + Phase 1 Refactor yüklendi.');

})();
