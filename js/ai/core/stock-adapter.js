// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/stock-adapter.js
//  FAZ 7.0 Pilot #2 — Stok (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §10, §13, §16
//  — RCA'nın "Stok" nedeni için bugüne kadar "YOK" işaretlenen veri kaynağı)
//
//  Sorumluluk:
//    Eczane/brick bazlı stok durumu (TÜKENDİ/AZALIYOR/STOKTA) sinyallerini
//    standart bir StockRecord modeline çevirir ve SourceAdapterRegistry'ye
//    (FAZ 7.0) KENDİ KENDİNE register eder.
//
//  ⚠️ NEDEN BU DOSYA VAR (§16 FAZ 7.0 beklenen kazanım — İKİNCİ KANIT):
//    field-observation-adapter.js TEK BAŞINA "yeni kaynak = yeni dosya"
//    iddiasını kanıtlar ama TEK ÖRNEK tesadüf olabilir. Bu dosya AYNI
//    arayüzü (discover/normalize/contextHook) İKİNCİ KEZ, BAĞIMSIZ bir
//    veri modeliyle uygulayarak registry'nin GERÇEKTEN genel olduğunu
//    (adapter'a özel kod registry içinde YOK) doğrular — source-adapter.js,
//    field-observation-adapter.js eklenirken HİÇ DEĞİŞMEDİ, bu dosya
//    eklenirken de DEĞİŞMEYECEK.
//
//  VERİ KAYNAĞI (henüz repo'da YOK): stok/manifest.json + stok/*.csv —
//  field-observation-adapter.js İLE AYNI manifest keşif deseni
//  (SourceAdapterRegistry.fetchManifest/fetchText üzerinden, KOD
//  TEKRARI YOK — ikisi de aynı registry yardımcılarını çağırır).
//
//  CSV BAŞLIKLARI (csv-parser.js::parseStokCSV):
//    TARIH; HEDEF_TIPI; HEDEF_ADI; URUN; DURUM; NOT
//
//  STANDART StockRecord MODELİ:
//    {
//      tarih, hedefTipi: 'ECZANE'|'BRICK'|null, hedefAdi,
//      urun, ilacGrubu,        // URUN_ORDER/ALL_GROUPS pozisyonel eşlemesiyle
//                                türetilir (competitive-adapter.js'in GRUP
//                                EŞLEME mantığıyla AYNI prensip — yeni
//                                taksonomi İCAT EDİLMEDİ), eşlenemezse null
//      durum: 'STOKTA'|'AZALIYOR'|'TUKENDI'|'BILINMIYOR',
//      not,
//      guvenirlik: 'SAHA_GIRISI'
//    }
//
//  contextHook: 'stockSignals' → context.stockSignals = {
//    available, records: StockRecord[], byUrun: {urun:[...]},
//    criticalCount (DURUM='TUKENDI' adedi)
//  }
//
//  Public API:
//    normalizeStock()           → context şekli (cache'li, registry üzerinden)
//    getStockByProduct(urun)    → StockRecord[]
//    getCriticalStockouts()     → StockRecord[] (DURUM='TUKENDI')
//    clearCache()
//
//  Kurallar:
//    • csv-parser.js DEĞİŞTİRİLMEDİ — sadece parseStokCSV() (FAZ 7.0'da
//      EKLENEN, yeni fonksiyon) kullanılır.
//    • constants.js (URUN_ORDER/ALL_GROUPS) ve data-normalizer.js (normUrun)
//      DEĞİŞTİRİLMEDİ — sadece OKUNUR.
//    • DOM erişimi YOK.
//    • Hiçbir karar motoruna (risk/decision/rca) BAĞLANMADI — rca-engine.js
//      (henüz yazılmamış, §10'da tasarlanan, ayrı FAZ) yazıldığında
//      "Stok" nedeni için artık "veri yok" DEĞİL, bu context alanını
//      kanıt olarak okuyabilir.
//
//  Bağımlılık: js/ai/core/source-adapter.js (SourceAdapterRegistry),
//              js/data/csv-parser.js (parseStokCSV),
//              js/core/constants.js (URUN_ORDER, ALL_GROUPS) — hepsi
//              opsiyonel, typeof ile kontrol edilir.
//  Yükleme sırası: source-adapter.js SONRASI, ai-context-builder.js ÖNCESİ.
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._STOCK_ADAPTER_LOADED) {
    console.warn('[stock-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._STOCK_ADAPTER_LOADED = true;

  var ADAPTER_VERSION = '1.0';
  var STOK_DIR = 'stok/';

  var DURUM_SET = { 'STOKTA': 1, 'AZALIYOR': 1, 'TUKENDI': 1, 'TÜKENDI': 1, 'TÜKENDİ': 1, 'BILINMIYOR': 1, 'BİLİNMİYOR': 1 };
  var DURUM_NORM = { 'TÜKENDI': 'TUKENDI', 'TÜKENDİ': 'TUKENDI', 'BİLİNMİYOR': 'BILINMIYOR' };

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  function _normDurum(raw) {
    var u = String(raw || '').trim().toUpperCase();
    if (DURUM_NORM[u]) u = DURUM_NORM[u];
    return DURUM_SET[u] ? u : 'BILINMIYOR';
  }

  function _normHedefTipi(raw) {
    var u = String(raw || '').trim().toUpperCase();
    if (u === 'ECZANE' || u === 'BRICK') return u;
    return null;
  }

  // ──────────────────────────────────────────────────────────────────
  //  GRUP EŞLEME — competitive-adapter.js'in §1.1 mantığıyla AYNI:
  //  yeni bir taksonomi İCAT EDİLMEDİ, mevcut URUN_ORDER ↔ ALL_GROUPS
  //  pozisyonel eşlemesi (constants.js) kullanılır. Her ikisi de yoksa
  //  veya uzunlukları uyuşmuyorsa eşleme atlanır (ilacGrubu: null) —
  //  hata FIRLATILMAZ.
  // ──────────────────────────────────────────────────────────────────
  var _urunToGrupCache = null;
  function _urunToGrupMap() {
    if (_urunToGrupCache) return _urunToGrupCache;
    var map = {};
    _safe(function () {
      var order = (typeof URUN_ORDER !== 'undefined') ? URUN_ORDER : null;
      var grups = (typeof ALL_GROUPS !== 'undefined') ? ALL_GROUPS : null;
      if (order && grups && order.length === grups.length) {
        order.forEach(function (u, i) {
          var key = _safe(function () { return stripTR(u.trim().toUpperCase()); }, u.trim().toUpperCase());
          map[key] = grups[i];
        });
      }
    }, null);
    _urunToGrupCache = map;
    return map;
  }

  function _resolveIlacGrubu(urunRaw) {
    if (!urunRaw) return null;
    var normalized = _safe(function () {
      return (typeof normUrun === 'function') ? normUrun(urunRaw) : urunRaw.trim().toUpperCase();
    }, urunRaw.trim().toUpperCase());
    var key = _safe(function () { return stripTR(String(normalized).toUpperCase()); }, String(normalized).toUpperCase());
    return _urunToGrupMap()[key] || null;
  }

  // ──────────────────────────────────────────────────────────────────
  //  discover() — manifest + CSV keşfi. field-observation-adapter.js
  //  İLE AYNI registry yardımcıları kullanılır — kod tekrarı YOK.
  // ──────────────────────────────────────────────────────────────────
  function discover() {
    if (!window.SourceAdapterRegistry) return Promise.resolve([]);

    return window.SourceAdapterRegistry.fetchManifest(STOK_DIR).then(function (manifest) {
      var files = (manifest && manifest.files) || [];
      if (!files.length) return [];

      var base = window.SourceAdapterRegistry.repoRawBase() + STOK_DIR;
      var fetches = files.map(function (f) {
        var fileName = f.file || f.path || f.name;
        if (!fileName) return Promise.resolve([]);
        var url = (f.path ? window.SourceAdapterRegistry.repoRawBase() + f.path : base + fileName);
        return window.SourceAdapterRegistry.fetchText(url).then(function (text) {
          if (!text) return [];
          return _safe(function () {
            return (typeof parseStokCSV === 'function') ? parseStokCSV(text) : [];
          }, []);
        });
      });

      return Promise.all(fetches).then(function (lists) {
        var merged = [];
        lists.forEach(function (l) { merged = merged.concat(l); });
        return merged;
      });
    }).catch(function () { return []; });
  }

  // ──────────────────────────────────────────────────────────────────
  //  normalize() — ham satır → StockRecord + context şekli
  // ──────────────────────────────────────────────────────────────────
  function normalize(rawRows) {
    var rows = rawRows || [];
    var records = rows.map(function (r) {
      return {
        tarih:      r.tarih || null,
        hedefTipi:  _normHedefTipi(r.hedefTipi),
        hedefAdi:   r.hedefAdi || null,
        urun:       r.urun || null,
        ilacGrubu:  _resolveIlacGrubu(r.urun),
        durum:      _normDurum(r.durum),
        not:        r.not || '',
        guvenirlik: 'SAHA_GIRISI'
      };
    });

    var byUrun = {};
    records.forEach(function (rec) {
      if (rec.urun) { (byUrun[rec.urun] = byUrun[rec.urun] || []).push(rec); }
    });

    var criticalCount = records.filter(function (rec) { return rec.durum === 'TUKENDI'; }).length;

    return {
      available: records.length > 0,
      records: records,
      byUrun: byUrun,
      criticalCount: criticalCount
    };
  }

  function _getDefaultContext() {
    return { available: false, records: [], byUrun: {}, criticalCount: 0 };
  }

  function _cacheSignature(rawRows) {
    return (rawRows || []).length + ':' + JSON.stringify(rawRows || []).length;
  }

  // ──────────────────────────────────────────────────────────────────
  //  SORGU YARDIMCILARI (registry'nin senkron önbelleğinden okur)
  // ──────────────────────────────────────────────────────────────────
  function normalizeStock() {
    if (!window.SourceAdapterRegistry) return _getDefaultContext();
    var fields = window.SourceAdapterRegistry.getContextFields();
    return (fields && fields.stockSignals) || _getDefaultContext();
  }

  function getStockByProduct(urun) {
    var ctx = normalizeStock();
    return (ctx.byUrun && ctx.byUrun[urun]) || [];
  }

  function getCriticalStockouts() {
    var ctx = normalizeStock();
    return (ctx.records || []).filter(function (r) { return r.durum === 'TUKENDI'; });
  }

  function clearCache() {
    if (window.SourceAdapterRegistry) window.SourceAdapterRegistry.clearCache('stockSignals');
  }

  // ── REGISTRY'YE KENDİ KENDİNE KAYIT (aynı arayüz, ikinci bağımsız örnek) ──
  if (window.SourceAdapterRegistry) {
    window.SourceAdapterRegistry.register({
      name: 'stockSignals',
      discover: discover,
      normalize: normalize,
      cacheSignature: _cacheSignature,
      contextHook: 'stockSignals',
      getDefaultContext: _getDefaultContext
    });
  } else {
    console.warn('[stock-adapter] SourceAdapterRegistry bulunamadı — register edilemedi (yükleme sırası kontrol edilmeli)');
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.StockAdapter = {
    normalizeStock: normalizeStock,
    getStockByProduct: getStockByProduct,
    getCriticalStockouts: getCriticalStockouts,
    clearCache: clearCache,
    version: ADAPTER_VERSION
  };

  console.debug('[stock-adapter] FAZ 7.0 Pilot #2 yüklendi. Versiyon:', ADAPTER_VERSION);

})();
