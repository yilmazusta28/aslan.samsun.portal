// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/stok-adapter.js
//  FAZ 7.0 — Stok Adapter (SourceAdapter Arayüzü Kanıtı)
//
//  Sorumluluk:
//    "Yeni veri kaynağı = yeni adapter, sıfır kırılma" iddiasını kanıtlar.
//    Eczane bazlı manuel stok girişlerini (YOK/KRİTİK/NORMAL/YETERLİ)
//    localStorage'da saklar ve downstream motorlara (Risk, Decision,
//    Opportunity) standart bir stok sinyal şemasıyla sunar.
//
//  TASARIM — ims-adapter.js / pharmacy-adapter.js ile AYNI desen:
//    KATMAN 0 (Raw): localStorage CRUD (saveStok / deleteStok)
//    KATMAN 1 (Normalize): normalizeStok() → StokRecord[]
//    KATMAN 2 (Sorgu): getStokByGln / getStokByBrick / getStokSignal
//
//  STANDART StokRecord MODELİ:
//    {
//      gln,           // eczane GLN kodu
//      eczane,        // eczane adı (görüntüleme için)
//      brick,         // brick (bölge)
//      ttt,           // giren temsilci
//      urun,          // URUN_ORDER'dan biri
//      durum,         // 'YOK' | 'KRİTİK' | 'NORMAL' | 'YETERLİ'
//      notlar,        // serbest metin (opsiyonel)
//      girisTarihi,   // ISO timestamp
//      girenTTT       // giren kullanıcı
//    }
//
//  STOK SİNYALİ (downstream motorlar için):
//    getStokSignal(ttt) → {
//      kritikCount,    // KRİTİK veya YOK stok sayısı
//      kritikBricks,   // etkilenen brick'ler
//      kritikUrunler,  // etkilenen ürünler
//      riskScore,      // 0-100 (stok riskini tek sayıyla özetler)
//      urgentActions   // [{gln, eczane, urun, durum, brick}] — acil liste
//    }
//
//  Public API:
//    saveStok(entry)              → true/false (CRUD: kaydet/güncelle)
//    deleteStok(gln, urun)        → true/false
//    getStokByGln(gln)            → StokRecord[] (o eczanenin tüm ürünleri)
//    getStokByBrick(brick, ttt)   → StokRecord[] (brick bazlı filtre)
//    getStokSignal(ttt)           → stok risk özeti (decision/risk motorları için)
//    normalizeStok(ttt)           → StokRecord[] (tüm kayıtlar, ttt filtreli)
//    exportCSV(ttt)               → CSV string (indirme için)
//    clearAll()                   → localStorage temizle
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._STOK_ADAPTER_LOADED) {
    console.warn('[stok-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._STOK_ADAPTER_LOADED = true;

  var ADAPTER_VERSION = '1.0';
  var STORAGE_KEY = 'pv_stok_v1';  // sales-conditions.js ile aynı 'pv_' prefix

  var DURUM_SIRASI = ['YOK', 'KRİTİK', 'NORMAL', 'YETERLİ'];
  var DURUM_RISK   = { 'YOK': 100, 'KRİTİK': 70, 'NORMAL': 10, 'YETERLİ': 0 };

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  KATMAN 0 — Raw localStorage CRUD
  // ──────────────────────────────────────────────────────────────────

  function _loadAll() {
    return _safe(function () {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }, []);
  }

  function _saveAll(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch (e) {
      console.error('[stok-adapter] Kayıt hatası:', e);
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  KATMAN 1 — Normalize + CRUD
  // ──────────────────────────────────────────────────────────────────

  // Yeni stok girişi kaydet veya güncelle (aynı gln+urun varsa üzerine yaz)
  function saveStok(entry) {
    if (!entry || !entry.gln || !entry.urun || !entry.durum) return false;
    if (DURUM_SIRASI.indexOf(entry.durum) === -1) return false;

    var all = _loadAll();
    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].gln === entry.gln && all[i].urun === entry.urun) {
        idx = i; break;
      }
    }

    var record = {
      gln:          entry.gln,
      eczane:       entry.eczane  || '',
      brick:        entry.brick   || '',
      ttt:          entry.ttt     || '',
      urun:         entry.urun,
      durum:        entry.durum,
      notlar:       entry.notlar  || '',
      girisTarihi:  new Date().toISOString(),
      girenTTT:     entry.girenTTT || entry.ttt || ''
    };

    if (idx >= 0) all[idx] = record;
    else all.push(record);

    return _saveAll(all);
  }

  function deleteStok(gln, urun) {
    if (!gln || !urun) return false;
    var all = _loadAll().filter(function (r) {
      return !(r.gln === gln && r.urun === urun);
    });
    return _saveAll(all);
  }

  function normalizeStok(ttt) {
    var all = _loadAll();
    return ttt ? all.filter(function (r) { return r.ttt === ttt; }) : all;
  }

  function getStokByGln(gln) {
    if (!gln) return [];
    return _loadAll().filter(function (r) { return r.gln === gln; });
  }

  function getStokByBrick(brick, ttt) {
    if (!brick) return [];
    var all = _loadAll().filter(function (r) { return r.brick === brick; });
    return ttt ? all.filter(function (r) { return r.ttt === ttt; }) : all;
  }

  // ──────────────────────────────────────────────────────────────────
  //  KATMAN 2 — Stok Sinyali (downstream motorlar: risk/decision)
  // ──────────────────────────────────────────────────────────────────

  function getStokSignal(ttt) {
    var records = normalizeStok(ttt);
    if (!records.length) {
      return { kritikCount: 0, kritikBricks: [], kritikUrunler: [], riskScore: 0, urgentActions: [] };
    }

    var urgent = records.filter(function (r) {
      return r.durum === 'YOK' || r.durum === 'KRİTİK';
    });

    var brickSet = {}, urunSet = {};
    urgent.forEach(function (r) {
      if (r.brick) brickSet[r.brick] = true;
      if (r.urun)  urunSet[r.urun]  = true;
    });

    // Risk skoru: kayıtların ağırlıklı ortalaması (YOK=100, KRİTİK=70, NORMAL=10, YETERLİ=0)
    var totalRisk = records.reduce(function (s, r) {
      return s + (DURUM_RISK[r.durum] || 0);
    }, 0);
    var riskScore = Math.min(100, Math.round(totalRisk / records.length));

    return {
      kritikCount:   urgent.length,
      kritikBricks:  Object.keys(brickSet),
      kritikUrunler: Object.keys(urunSet),
      riskScore:     riskScore,
      urgentActions: urgent.map(function (r) {
        return { gln: r.gln, eczane: r.eczane, urun: r.urun, durum: r.durum, brick: r.brick };
      })
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  CSV Export
  // ──────────────────────────────────────────────────────────────────

  function exportCSV(ttt) {
    var records = normalizeStok(ttt);
    if (!records.length) return '';
    var header = 'GLN;Eczane;Brick;Temsilci;Ürün;Durum;Notlar;Giriş Tarihi;Giren\n';
    var rows = records.map(function (r) {
      return [r.gln, r.eczane, r.brick, r.ttt, r.urun, r.durum,
              (r.notlar || '').replace(/;/g, ','), r.girisTarihi, r.girenTTT].join(';');
    }).join('\n');
    return header + rows;
  }

  function clearAll() {
    try { localStorage.removeItem(STORAGE_KEY); return true; }
    catch (e) { return false; }
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.StokAdapter = {
    saveStok:       saveStok,
    deleteStok:     deleteStok,
    normalizeStok:  normalizeStok,
    getStokByGln:   getStokByGln,
    getStokByBrick: getStokByBrick,
    getStokSignal:  getStokSignal,
    exportCSV:      exportCSV,
    clearAll:       clearAll,
    DURUM_SIRASI:   DURUM_SIRASI,  // UI dropdown için
    version:        ADAPTER_VERSION
  };

  console.debug('[stok-adapter] yüklendi. Versiyon:', ADAPTER_VERSION);

})();
