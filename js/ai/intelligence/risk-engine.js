// ══════════════════════════════════════════════════════════════════════
//  js/ai/intelligence/risk-engine.js
//  Phase 3.0 — Sales Intelligence Engine
//  AI MİMARİ STABİLİZASYONU GÜNCELLEMESİ — IMS erişimi artık
//  js/ai/core/ims-adapter.js üzerinden, parser'a (IMS) DOĞRUDAN ERİŞMEZ.
//
//  Sorumluluk: Otomatik risk tespiti ve sınıflandırması
//    • detectRisks(ttt) → risk[]
//
//  Risk kategorileri:
//    - Realizasyon riski (hedeften sapma)            — GENEL (değişmedi)
//    - Pazar payı kaybı (IMS)                          — adapter üzerinden (bkz. ⚠️ not)
//    - Brick performansı (MI&GI)                       — MIGI_BRICK_TL_RAW (değişmedi)
//    - Portföy prim riski                               — GENEL (değişmedi)
//
//  ⚠️ ÖNEMLİ AUDIT NOTU — R3 "Pazar Payı Kaybı" (bkz. AI_MIMARI_STABILIZASYON_RAPORU.md):
//    Bu blok ÖNCEDEN r.hafta / r.bizim_pay / r.rakip_pay okuyordu. r.hafta
//    GERÇEK parseIMSCSV() çıktısında yoktu (trend/forecast'taki gibi) —
//    AMA r.bizim_pay / r.rakip_pay, trend/forecast'taki own_tl/own_kutu'dan
//    FARKLI bir durum: bu ikisinin YERİNE KULLANILABİLECEK gerçek bir
//    veri kaynağı PROJENİN HİÇBİR YERİNDE YOK (own_tl/own_kutu'nun aksine,
//    h1..h9 gibi bir "gerçek rakip pazar payı" verisi parser'da hiç
//    üretilmiyor). Bu nedenle bu risk kuralı HER ZAMAN sessizce devre dışı
//    kalıyordu ve KASITLI OLARAK ÖYLE BIRAKILDI — adapter'ın kapsamı
//    (growth/average/trend/volatility) bu eksikliği dolduramaz, çünkü
//    "pazar payı" farklı bir veri boyutudur. Tek yapılan: IMS'e DOĞRUDAN
//    erişim kaldırıldı (artık ims-adapter.js üzerinden, ürün bazlı
//    gruplama ile), ve hayali r.hafta sıralaması kaldırıldı. Davranış
//    (her zaman 0 risk üretmesi) AYNEN KORUNDU — bu bir "mevcut
//    fonksiyonelliği bozma" değil, zaten var olmayan bir fonksiyonelliği
//    olduğu gibi (dormant) bırakmaktır.
//
//  Severity: 'LOW' | 'MEDIUM' | 'HIGH'
//  AI çağrısı: YOK
//  UI değişikliği: YOK
//
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js (GENEL, MIGI_BRICK_TL_RAW)
//  Yükleme sırası: ims-adapter.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, MIGI_BRICK_TL_RAW */

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
      var imsRecords = (window.IMSAdapter && typeof window.IMSAdapter.normalizeIMS === 'function')
        ? window.IMSAdapter.normalizeIMS(ttt) : [];
      var migiRows   = (MIGI_BRICK_TL_RAW || []).filter(function(r){ return r.person === ttt; });

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

      // ── R3: Pazar payı kaybı (IMS, ürün bazlı — adapter üzerinden) ──
      // bkz. dosya başlığı ⚠️ AUDIT NOTU — bizim_pay/rakip_pay hiçbir
      // gerçek veri kaynağında yok, bu nedenle bu blok kasıtlı olarak
      // sessizce 0 risk üretir (geçmişte de öyleydi).
      if (imsRecords.length) {
        var byProduct = (window.IMSAdapter && typeof window.IMSAdapter.groupRecordsBy === 'function')
          ? window.IMSAdapter.groupRecordsBy(imsRecords, 'product') : {};

        Object.keys(byProduct).forEach(function(urun) {
          var rows   = byProduct[urun];
          var latest = rows[rows.length - 1]; // hafta sırası YOK — gerçek veri kaynağı eklenince burası güncellenmeli
          if (!latest) return;

          var bizimPay  = latest.bizim_pay || 0; // gerçek veri kaynağı YOK — daima 0
          var rakipPay  = latest.rakip_pay || 0; // gerçek veri kaynağı YOK — daima 0

          if (bizimPay < 15 && rakipPay > 30) {
            risks.push({ severity: 'HIGH', title: urun + ' Pazar Payı Kaybı',
              detail: 'Bizim pay %' + bizimPay.toFixed(1) + ' iken rakip %' + rakipPay.toFixed(1) + ' — öncelikli saldırı hedefi.' });
          } else if (bizimPay < 20 && rakipPay > 25) {
            risks.push({ severity: 'MEDIUM', title: urun + ' Pazar Payı Baskısı',
              detail: 'Bizim pay %' + bizimPay.toFixed(1) + ' — rakip baskısı mevcut.' });
          }
        });
      }

      // ── R4: MI&GI brick zayıflığı ────────────────────────
      // BUG DÜZELTMESİ: eskiden tüm ayların mi/bi/sira'sı filtresiz
      // karıştırılıyordu — bkz. prim-calc.js'deki aynı düzeltme notu.
      if (migiRows.length) {
        var _migiDonemNum = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
        var _rowsByBrick = {};
        migiRows.forEach(function(r) { if (!_rowsByBrick[r.brick]) _rowsByBrick[r.brick] = []; _rowsByBrick[r.brick].push(r); });
        var brickMap = {};
        Object.keys(_rowsByBrick).forEach(function (brick) {
          var rows = _rowsByBrick[brick];
          var latest = rows.reduce(function (max, r) { return Math.max(max, _migiDonemNum(r.donem)); }, 0);
          var latestRows = rows.filter(function (r) { return _migiDonemNum(r.donem) === latest; });
          brickMap[brick] = { mi: [], bi: [], sira: latestRows[0] ? latestRows[0].sira : null };
          latestRows.forEach(function (r) {
            if (r.mi != null) brickMap[brick].mi.push(r.mi);
            if (r.bi != null) brickMap[brick].bi.push(r.bi);
          });
        });

        var criticalBricks = [];
        var warnBricks     = [];

        Object.keys(brickMap).forEach(function(brick) {
          var b   = brickMap[brick];
          var mi  = b.mi.length ? b.mi.reduce(function(s,v){ return s+v; }, 0) / b.mi.length : null;
          var bi  = b.bi.length ? b.bi.reduce(function(s,v){ return s+v; }, 0) / b.bi.length : null;
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

      // ── R5: Portföy prim riski — TL real + prim puanı ────
      if (genelTotal) {
        var realPct = genelTotal.tl_pct || 0;
        // Prim puanı proxy: ürün realizasyon ortalaması
        var primPuani = genelRows.length
          ? genelRows.reduce(function(s,r){ return s + (r.tl_pct || 0); }, 0) / genelRows.length
          : 0;

        if (realPct < 91 && primPuani < 91) {
          risks.push({ severity: 'HIGH', title: 'Portföy Prim Riski',
            detail: 'Hem TL real (%' + realPct.toFixed(1) + ') hem de ürün ortalaması (%' + primPuani.toFixed(1) +
              ') %91 altında — portföy prim koşulu sağlanamıyor.' });
        }
      }

      // Sırala: HIGH önce
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
  console.debug('[risk-engine] Phase 3.0 yüklendi (ims-adapter.js üzerinden).');

})();
