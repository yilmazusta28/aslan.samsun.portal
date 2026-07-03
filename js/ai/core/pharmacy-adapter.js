// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/pharmacy-adapter.js
//  FAZ 6.0 — Pharmacy Adapter Katmanı
//
//  Sorumluluk:
//    Üç farklı eczane ham veri kaynağını (ECZANE_RAW, pharmacyActiveData,
//    pharmacyStore.normalized) AI motorlarının kullanacağı ORTAK, STANDART
//    bir veri modeline (PharmacyRecord) çevirmek. Parser'lar DEĞİŞMEDİ —
//    sadece bu adapter, üç kaynağın çıktısını okuyup tek modele indirger.
//
//  ⚠️ NEDEN BU DOSYA VAR (bkz. AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §3.1, §16 FAZ 6.0):
//    pharmacy-intelligence.js, reorder-engine.js ve reorder-classifier.js
//    aynı eczane verisini ÜÇ AYRI YERDE, ÜÇ FARKLI ÖNCELİK ZİNCİRİYLE okuyor:
//      • pharmacy-intelligence.js : pharmacyActiveData → ECZANE_RAW
//      • reorder-engine.js        : pharmacyStore.normalized → pharmacyActiveData → ECZANE_RAW
//      • reorder-classifier.js    : pharmacyActiveData → ECZANE_RAW  (pharmacyStore'u HİÇ bilmiyor)
//    Bu üç kaynağın alan adları da farklı (ttt vs temsilci, ad vs eczane,
//    ay vs year+month). Üç motor bazen aynı veriden, bazen farklı kaynaktan
//    okuduğu için ÇELİŞEN sonuçlar üretebiliyor. Bu adapter, TEK GERÇEK
//    KAYNAK olarak en zengin mevcut kaynağı seçer ve tüm motorların
//    BUNDAN SONRA SADECE bu adapter üzerinden okumasını sağlar.
//
//  GERÇEK HAM ŞEMALAR (üç kaynak, üç farklı alan adı seti):
//    1) ECZANE_RAW / pharmacyActiveData (parseEczaneCSV çıktısı — index.html):
//         { tarih, gln, ad, brick, urun, adet, tutar, iade, ay, ttt }
//    2) pharmacyStore.normalized (PHASE 5.2 — pharmacy-data-manager.js):
//         { year, month, temsilci, brick, eczane, gln, urun, adet, tutar, ay, aktif }
//    (İki şema da AYNI satır bazlı veriyi temsil eder — sadece alan adları
//     farklı. Bu adapter ikisini de aynı PharmacyRecord alanlarına eşler.)
//
//  STANDART PharmacyRecord MODELİ (bu adapter'ın ÜRETTİĞİ model — eczane bazlı,
//  TÜM aylar ve TÜM ürünler birleşik):
//    {
//      gln, eczane, brick, representative,        // ttt/temsilci → representative
//      months: { 'MM/YYYY': totalBoxes, ... },     // ay → toplam kutu (tüm ürünler)
//      monthsByProduct: { 'URUN': { 'MM/YYYY': boxes, ... }, ... },
//      monthsValue: { 'MM/YYYY': totalTutar, ... }, // ay → toplam TL (gerçek tutar — varsa)
//      monthsReturned: { 'MM/YYYY': totalIade, ... },// ay → toplam iade (varsa)
//      sortedMonths: ['MM/YYYY', ...]               // kronolojik sıralı
//    }
//
//  Public API:
//    normalizePharmacy(tttFilter)      → PharmacyRecord[] (cache'li)
//    getRawSource()                    → { rows, sourceName } (hangi kaynak kullanıldı, debug/şeffaflık için)
//    monthValuesArray(monthsObj, sortedMonths) → [v1..vN] kronolojik sıralı dizi
//    activeMonthCount(monthVals)       → sıfırdan farklı ay sayısı
//    averageUnitPrice(record)          → TL/kutu (gerçek tutar/adet'ten — yoksa null)
//    clearCache()                      → cache temizle (manuel, normalde otomatik)
//
//  CACHE: tttFilter başına, içerik-imzası ile otomatik geçersizleşir
//  (ims-adapter.js ile AYNI desen — veri değişmeden tekrar normalize ETMEZ).
//
//  Kurallar:
//    • Parser'lar (parseEczaneCSV, pharmacy-data-manager.js'in _normalizeRow'u)
//      DEĞİŞTİRİLMEDİ.
//    • DOM erişimi YOK.
//    • ECZANE_RAW bir `let` değişkenidir (window'a otomatik bağlanmaz —
//      bu projede daha önce tespit edilmiş bilinen bir hata deseni); bu
//      yüzden `typeof` ile güvenli okunur (ims-adapter.js'in IMS okuma
//      deseniyle AYNI).
//    • Kaynak önceliği reorder-engine.js'in zaten kurduğu zincirle AYNI
//      (en zengin/en güncel kaynak önce): pharmacyStore.normalized →
//      pharmacyActiveData → ECZANE_RAW. pharmacy-intelligence.js ve
//      reorder-classifier.js'in pharmacyStore'u atlamasının nedeni bu
//      adapter'ın olmamasıydı — artık üçü de aynı zinciri kullanabilir.
//
//  Bağımlılık: js/data/data-state.js (ECZANE_RAW — typeof ile kontrol),
//              js/pharmacy/pharmacy-data-manager.js (pharmacyStore/pharmacyActiveData
//              — window üzerinden, typeof ile kontrol; SIRALAMA için aşağı bak)
//  Yükleme sırası: data-state.js SONRASI, pharmacy-data-manager.js SONRASI
//                  (pharmacyStore şemasını okuyabilmesi için), pharmacy-intelligence.js/
//                  reorder-engine.js/reorder-classifier.js ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._PHARMACY_ADAPTER_LOADED) {
    console.warn('[pharmacy-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._PHARMACY_ADAPTER_LOADED = true;

  var ADAPTER_VERSION = '1.0';

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) AY SIRALAMA YARDIMCISI ('MM/YYYY' → sayısal sıralama anahtarı)
  // ──────────────────────────────────────────────────────────────────
  function _monthNum(ayStr) {
    if (!ayStr) return 0;
    var p = String(ayStr).split('/');
    if (p.length < 2) return 0;
    return parseInt(p[1], 10) * 100 + parseInt(p[0], 10);
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) KAYNAK SEÇİMİ — üç motorun zaten kullandığı önceliği TEK YERE
  //     toplar: pharmacyStore.normalized (en zengin — tutar/iade dahil)
  //     → pharmacyActiveData (PDM'in aktif filtreli ECZANE_RAW benzeri
  //     çıktısı) → ECZANE_RAW (en ham, lazy-load fallback).
  // ──────────────────────────────────────────────────────────────────

  // pharmacyStore.normalized satırını ortak ham alan adlarına çevirir
  // (reorder-engine.js'in _toRaw() fonksiyonuyla AYNI eşleme — tek yerden).
  function _fromNormalized(n) {
    return {
      gln:   n.gln      || '',
      ad:    n.eczane   || '',
      brick: n.brick    || '',
      ttt:   n.temsilci || '',
      urun:  n.urun     || '',
      adet:  n.adet     || 0,
      tutar: n.tutar     || 0,
      iade:  0, // pharmacyStore.normalized şemasında iade alanı yok
      ay:    n.ay || (String(n.month).padStart(2, '0') + '/' + n.year)
    };
  }

  // @returns { rows: Array, sourceName: string }
  function _selectSource() {
    var storeNorm = _safe(function () {
      return (window.pharmacyStore && window.pharmacyStore.normalized && window.pharmacyStore.normalized.length)
        ? window.pharmacyStore.normalized
        : null;
    }, null);
    if (storeNorm) {
      return { rows: storeNorm.map(_fromNormalized), sourceName: 'pharmacyStore.normalized' };
    }

    var activeData = _safe(function () {
      return (window.pharmacyActiveData && window.pharmacyActiveData.length) ? window.pharmacyActiveData : null;
    }, null);
    if (activeData) {
      return { rows: activeData, sourceName: 'pharmacyActiveData' };
    }

    var rawFallback = _safe(function () {
      return (typeof ECZANE_RAW !== 'undefined' && ECZANE_RAW) ? ECZANE_RAW : null;
    }, null);
    if (rawFallback) {
      return { rows: rawFallback, sourceName: 'ECZANE_RAW' };
    }

    return { rows: [], sourceName: 'none' };
  }

  // Dışa açık — hangi kaynağın kullanıldığını görmek isteyen kod için
  // (debug, sağlık kontrolü, şeffaflık amaçlı; normalde gerekmez).
  function getRawSource() {
    return _selectSource();
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) monthValuesArray / activeMonthCount — IMS adapter'daki
  //     weekValuesArray/activeWeekCount ile AYNI desen, ay bazlı versiyonu.
  // ──────────────────────────────────────────────────────────────────

  // {months} nesnesini sortedMonths sırasına göre düz diziye çevirir.
  function monthValuesArray(monthsObj, sortedMonths) {
    if (!monthsObj || !sortedMonths) return [];
    return sortedMonths.map(function (m) { return monthsObj[m] || 0; });
  }

  function activeMonthCount(monthVals) {
    return (monthVals || []).filter(function (v) { return v > 0; }).length;
  }

  // Gerçek tutar verisi varsa (pharmacyStore.normalized kaynaklıysa)
  // TL/kutu birim fiyatını döner; yoksa null (motor kendi fallback'ini kullanır
  // — örn. pharmacy-intelligence.js'in AVG_BOX_PRICE sabiti).
  function averageUnitPrice(record) {
    if (!record) return null;
    var totalValue = 0, totalBoxes = 0;
    (record.sortedMonths || []).forEach(function (m) {
      totalValue += (record.monthsValue && record.monthsValue[m]) || 0;
      totalBoxes += (record.months && record.months[m]) || 0;
    });
    if (totalValue <= 0 || totalBoxes <= 0) return null;
    return Math.round((totalValue / totalBoxes) * 100) / 100;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) normalizePharmacy — ANA FONKSİYON (cache'li)
  // ──────────────────────────────────────────────────────────────────

  var _cache = {}; // tttFilter (ya da '__ALL__') → { records, signature, sourceName }

  function _dataSignature(rows) {
    // İçerik-tabanlı ucuz imza: satır sayısı + toplam adet toplamı.
    // Kaynak değiştiğinde (örn. ECZANE_RAW'dan pharmacyStore'a geçildiğinde)
    // ya da içerik değiştiğinde (yeni ay yüklendiğinde) cache otomatik geçersizleşir.
    var totalAdet = rows.reduce(function (s, r) { return s + (parseInt(r.adet, 10) || 0); }, 0);
    return rows.length + ':' + totalAdet;
  }

  function _buildRecords(rows) {
    var eczMap = {};

    rows.forEach(function (r) {
      var key = r.gln || r.ad;
      if (!key) return;
      var adet  = parseInt(r.adet, 10) || 0;
      var tutar = parseFloat(r.tutar) || 0;
      var iade  = parseInt(r.iade, 10) || 0;

      if (!eczMap[key]) {
        eczMap[key] = {
          gln: r.gln || '', eczane: r.ad || '',
          brick: r.brick || '', representative: r.ttt || '',
          months: {}, monthsByProduct: {}, monthsValue: {}, monthsReturned: {}
        };
      }
      var e = eczMap[key];
      if (r.brick) e.brick = r.brick;
      if (r.ttt)   e.representative = r.ttt;
      if (!r.ay) return;

      e.months[r.ay] = (e.months[r.ay] || 0) + adet;
      if (tutar) e.monthsValue[r.ay] = (e.monthsValue[r.ay] || 0) + tutar;
      if (iade)  e.monthsReturned[r.ay] = (e.monthsReturned[r.ay] || 0) + iade;

      if (r.urun) {
        if (!e.monthsByProduct[r.urun]) e.monthsByProduct[r.urun] = {};
        e.monthsByProduct[r.urun][r.ay] = (e.monthsByProduct[r.urun][r.ay] || 0) + adet;
      }
    });

    var records = [];
    Object.keys(eczMap).forEach(function (key) {
      var e = eczMap[key];
      var sortedMonths = Object.keys(e.months).sort(function (a, b) {
        return _monthNum(a) - _monthNum(b);
      });
      if (!sortedMonths.length) return;
      e.sortedMonths = sortedMonths;
      records.push(e);
    });
    return records;
  }

  // ── normalizePharmacy(tttFilter) — üç ham kaynaktan birini seçip
  //    PharmacyRecord[]'e çevirir. tttFilter verilmezse tüm temsilciler.
  // @param {string} [tttFilter]
  // @returns {Array<PharmacyRecord>}
  function normalizePharmacy(tttFilter) {
    var cacheKey = tttFilter || '__ALL__';

    var src = _selectSource();
    if (!src.rows.length) {
      _cache[cacheKey] = { records: [], signature: '0:0', sourceName: src.sourceName };
      return [];
    }

    var filteredRows = tttFilter
      ? src.rows.filter(function (r) { return r.ttt === tttFilter; })
      : src.rows;

    var sig = _dataSignature(filteredRows) + '|' + src.sourceName;
    var cached = _cache[cacheKey];
    if (cached && cached.signature === sig) {
      return cached.records;
    }

    var records = _buildRecords(filteredRows);
    _cache[cacheKey] = { records: records, signature: sig, sourceName: src.sourceName };
    return records;
  }

  function clearCache() {
    _cache = {};
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.PharmacyAdapter = {
    normalizePharmacy: normalizePharmacy,
    getRawSource:      getRawSource,
    monthValuesArray:  monthValuesArray,
    activeMonthCount:  activeMonthCount,
    averageUnitPrice:  averageUnitPrice,
    clearCache:        clearCache,
    version: ADAPTER_VERSION
  };

  console.debug('[pharmacy-adapter] yüklendi. Versiyon:', ADAPTER_VERSION);

})();
