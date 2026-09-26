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
//    - R1/R2: DÖNEM SONU FORECAST riski (hedeften sapma)  — GENEL + forecast-engine.js
//    - Pazar payı kaybı (IMS)                          — adapter üzerinden (bkz. ⚠️ not)
//    - Brick performansı (MI&GI)                       — MIGI_BRICK_TL_RAW (değişmedi)
//    - Portföy prim riski                               — GENEL (değişmedi)
//
//  ⚠️ YAPISAL DEĞİŞİKLİK (kullanıcı isteği — forecast tabanlı risk):
//    R1 (genel realizasyon) ve R2 (ürün bazlı) artık MEVCUT anlık
//    realizasyona (tl_pct) göre değil, generateForecast()'ın ürettiği
//    DÖNEM SONU TAHMİNİ realizasyona (projectedReal / productForecasts)
//    göre sınıflandırılıyor. Mantık: bir temsilci/ürünün mevcut durumu
//    zayıf görünse bile gidişatı (forecast) %100'ü geçecekse "mevcut
//    durum korunur" — risk üretilmez; forecast düşükse, ne kadar
//    düşükse severity o kadar artar (kritik uyarı/önlem artışı). Mevcut
//    (anlık) yüzde artık sadece detail metninde bağlam olarak gösterilir,
//    sınıflandırmayı BELİRLEMEZ. generateForecast() yüklenmemişse (veya
//    hesap üretemezse) anlık tl_pct'e sessizce geri düşülür — davranış
//    hiçbir zaman kırılmaz.
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
//  Bağımlılık: js/ai/core/ims-adapter.js, js/data/data-state.js (GENEL, MIGI_BRICK_TL_RAW),
//              js/ai/predictive/forecast-engine.js (generateForecast — R1/R2/R5 forecast kaynağı)
//  Yükleme sırası: ims-adapter.js VE forecast-engine.js SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global GENEL, MIGI_BRICK_TL_RAW, generateForecast */

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

      // ── Dönem sonu forecast'ı bir kere hesapla (R1 + R2 ortak kaynak) ──
      var fcAll = null;
      try { if (typeof generateForecast === 'function') fcAll = generateForecast(ttt); } catch (eFc) { /* silent */ }
      var productForecastMap = {};
      if (fcAll && fcAll.productForecasts) {
        fcAll.productForecasts.forEach(function (pf) { productForecastMap[pf.urun] = pf; });
      }

      // ── R1: Genel TL — DÖNEM SONU FORECAST riski ─────────────────
      // (bkz. dosya başı ⚠️ YAPISAL DEĞİŞİKLİK notu)
      if (genelTotal) {
        var pct = genelTotal.tl_pct || 0; // sadece bağlam metni için
        var fcGenel = (fcAll && fcAll.projectedReal != null && fcAll.projectedReal > 0) ? fcAll.projectedReal : pct;
        if (fcGenel >= 100) {
          // Gidişat dönem sonunda %100'ü geçiyor → mevcut durum korunur,
          // risk üretilmez (mevcut anlık % düşük görünse bile).
        } else if (fcGenel < 70) {
          risks.push({ severity: 'HIGH', title: 'Dönem Sonu Forecast Kritik',
            detail: 'Mevcut gidişle dönem sonu tahmini realizasyon %' + fcGenel.toFixed(1) + ' (şu an %' + pct.toFixed(1) + ') — prim eşiğinin (%91) çok altında. Acil aksiyon gerekli.' });
        } else if (fcGenel < 91) {
          risks.push({ severity: 'MEDIUM', title: 'Forecast %91 Prim Eşiğinin Altında',
            detail: 'Dönem sonu tahmini realizasyon %' + fcGenel.toFixed(1) + ' (şu an %' + pct.toFixed(1) + ') — %91 prim eşiğine ' + (91 - fcGenel).toFixed(1) + ' puan kaldı, tempo artırılmalı.' });
        } else {
          risks.push({ severity: 'LOW', title: 'Forecast Sınırda',
            detail: 'Dönem sonu tahmini realizasyon %' + fcGenel.toFixed(1) + ' (şu an %' + pct.toFixed(1) + ') — %100 hedefine yakın, tempo korunmalı.' });
        }
      }

      // ── R2: Ürün bazlı — DÖNEM SONU FORECAST riski ───────────────
      genelRows.forEach(function(r) {
        var p  = r.tl_pct || 0; // sadece bağlam metni için
        var pf = productForecastMap[r.urun];
        var fcP = (pf && pf.projectedReal != null && (pf.hedefTL || 0) > 0) ? pf.projectedReal : p;
        if (fcP >= 100) {
          // Ürünün gidişatı dönem sonunda %100'ü geçiyor → mevcut
          // (başarılı) gidişat korunur, risk üretilmez.
        } else if (fcP < 60) {
          risks.push({ severity: 'HIGH', title: r.urun + ' Dönem Sonu Forecast Kritik',
            detail: r.urun + ' için dönem sonu tahmini realizasyon %' + fcP.toFixed(1) + ' (şu an %' + p.toFixed(1) + ') — portföy primini tehdit ediyor, önlem şart.' });
        } else if (fcP < 91) {
          risks.push({ severity: 'MEDIUM', title: r.urun + ' Forecast Düşük',
            detail: r.urun + ' için dönem sonu tahmini realizasyon %' + fcP.toFixed(1) + ' (şu an %' + p.toFixed(1) + ') — ek satış baskısı gerekli.' });
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

      // ── R5: Portföy prim riski — FORECAST real + forecast prim puanı ──
      // YENİ MANTIK: R1/R2 ile tutarlı olsun diye bu da artık anlık
      // yerine dönem sonu forecast'a bakıyor — forecast %100'ü geçen bir
      // ekip/ürün için bu blok da risk üretmez.
      if (genelTotal) {
        var realPctFc = (fcAll && fcAll.projectedReal != null && fcAll.projectedReal > 0) ? fcAll.projectedReal : (genelTotal.tl_pct || 0);
        // Prim puanı proxy: ürün forecast ortalaması (varsa), yoksa anlık ürün ortalaması
        var primPuaniFc = genelRows.length
          ? genelRows.reduce(function(s,r){
              var pf = productForecastMap[r.urun];
              var v  = (pf && pf.projectedReal != null && (pf.hedefTL || 0) > 0) ? pf.projectedReal : (r.tl_pct || 0);
              return s + v;
            }, 0) / genelRows.length
          : 0;

        if (realPctFc < 91 && primPuaniFc < 91) {
          risks.push({ severity: 'HIGH', title: 'Portföy Prim Riski',
            detail: 'Hem dönem sonu TL forecast (%' + realPctFc.toFixed(1) + ') hem de ürün forecast ortalaması (%' + primPuaniFc.toFixed(1) +
              ') %91 altında — mevcut gidişle portföy prim koşulu sağlanamıyor.' });
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
