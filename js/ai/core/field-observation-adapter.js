// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/field-observation-adapter.js
//  FAZ 7.0 Pilot #1 — Saha Gözlemleri (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md
//  §13, §16 — "ilk ek kaynak" örneklerinden biri)
//
//  Sorumluluk:
//    Temsilcilerin sahada elle girdiği gözlem notlarını (rakip aktivitesi,
//    stok sorunu sahada görüldü, fiyat değişimi, müşteri geri bildirimi vb.)
//    standart bir FieldObservationRecord modeline çevirir ve
//    SourceAdapterRegistry'ye (FAZ 7.0) KENDİ KENDİNE register eder.
//
//  ⚠️ NEDEN BU DOSYA VAR:
//    Bu, SourceAdapter arayüzünün İLK GERÇEK TÜKETİCİSİ — "yeni veri
//    kaynağı = yeni adapter dosyası, data-loader.js/ai-context-builder.js'e
//    SIFIR DOKUNUŞ" iddiasını kanıtlar (§16 FAZ 7.0 beklenen kazanım).
//
//  VERİ KAYNAĞI (henüz repo'da YOK — ileride saha ekibi/Form'dan gelecek):
//    saha-gozlem/manifest.json + saha-gozlem/*.csv (eczane/manifest.json
//    İLE AYNI keşif deseni — bkz. pharmacy-data-manager.js).
//    Dosya/manifest yoksa discover() SESSİZCE boş dizi döner — HATA VERMEZ,
//    hiçbir mevcut motoru etkilemez (rollback-safe, §15).
//
//  CSV BAŞLIKLARI (csv-parser.js::parseSahaGozlemCSV):
//    TARIH; TTT; HEDEF_TIPI; HEDEF_ADI; GOZLEM_TIPI; ACIKLAMA; ONEM
//
//  STANDART FieldObservationRecord MODELİ:
//    {
//      tarih, ttt, hedefTipi: 'ECZANE'|'BRICK'|null, hedefAdi,
//      kategori: 'RAKIP'|'STOK'|'FIYAT'|'GERI_BILDIRIM'|'DIGER',
//      aciklama, onem: 'DUSUK'|'ORTA'|'YUKSEK',
//      guvenirlik: 'TEMSILCI_GIRISI'   // elle giriş — sistemsel veriden
//                                       // daha düşük güven, RCA/kanıt
//                                       // motorları bunu hesaba katmalı
//    }
//
//  contextHook: 'fieldObservations' → context.fieldObservations = {
//    available, records: FieldObservationRecord[], byTTT: {ttt: [...]},
//    byKategori: {kategori: [...]}, recentCount (son 30 gün)
//  }
//
//  Public API:
//    normalizeFieldObservations()    → context şekli (cache'li, registry üzerinden)
//    getObservationsByTTT(ttt)       → FieldObservationRecord[]
//    getObservationsByCategory(kat)  → FieldObservationRecord[]
//    clearCache()
//
//  Kurallar:
//    • csv-parser.js DEĞİŞTİRİLMEDİ — sadece parseSahaGozlemCSV() (FAZ 7.0'da
//      EKLENEN, yeni fonksiyon) kullanılır.
//    • DOM erişimi YOK.
//    • Hiçbir karar motoruna (risk/decision/rca) BAĞLANMADI — RCA Engine
//      (henüz yazılmamış, ayrı FAZ) bu context alanını ileride kanıt
//      kaynağı olarak okuyabilir.
//
//  Bağımlılık: js/ai/core/source-adapter.js (SourceAdapterRegistry),
//              js/data/csv-parser.js (parseSahaGozlemCSV) — opsiyonel,
//              typeof ile kontrol edilir.
//  Yükleme sırası: source-adapter.js SONRASI, ai-context-builder.js ÖNCESİ.
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._FIELD_OBSERVATION_ADAPTER_LOADED) {
    console.warn('[field-observation-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._FIELD_OBSERVATION_ADAPTER_LOADED = true;

  var ADAPTER_VERSION = '1.0';
  var SAHA_DIR = 'saha-gozlem/';

  var ONEM_SET = { 'DUSUK': 1, 'DÜŞÜK': 1, 'ORTA': 1, 'YUKSEK': 1, 'YÜKSEK': 1 };
  var ONEM_NORM = { 'DÜŞÜK': 'DUSUK', 'YÜKSEK': 'YUKSEK' };

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) KATEGORİ ÇIKARIMI — rep'in serbest metin GOZLEM_TIPI girişini
  //     bilinen bir kovaya eşler (eşleşmezse 'DIGER' — asla hata vermez).
  // ──────────────────────────────────────────────────────────────────
  function _inferKategori(raw) {
    var u = _safe(function () { return stripTR(String(raw || '').trim().toUpperCase()); }, String(raw || '').toUpperCase());
    if (!u) return 'DIGER';
    if (u.indexOf('RAKIP') !== -1)                              return 'RAKIP';
    if (u.indexOf('STOK') !== -1)                               return 'STOK';
    if (u.indexOf('FIYAT') !== -1 || u.indexOf('FİYAT') !== -1) return 'FIYAT';
    if (u.indexOf('GERI') !== -1 || u.indexOf('GERİ') !== -1 || u.indexOf('MUSTERI') !== -1 || u.indexOf('MÜŞTERİ') !== -1) return 'GERI_BILDIRIM';
    return 'DIGER';
  }

  function _normOnem(raw) {
    var u = String(raw || '').trim().toUpperCase();
    if (ONEM_NORM[u]) u = ONEM_NORM[u];
    return ONEM_SET[u] ? u : 'ORTA'; // bilinmeyen/boş → nötr varsayılan
  }

  function _normHedefTipi(raw) {
    var u = String(raw || '').trim().toUpperCase();
    if (u === 'ECZANE' || u === 'BRICK') return u;
    return null;
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) discover() — manifest + CSV keşfi (eczane-manifest deseni)
  // ──────────────────────────────────────────────────────────────────
  function discover() {
    if (!window.SourceAdapterRegistry) return Promise.resolve([]);

    return window.SourceAdapterRegistry.fetchManifest(SAHA_DIR).then(function (manifest) {
      var files = (manifest && manifest.files) || [];
      if (!files.length) return []; // henüz hiç dosya yok — sessizce boş

      var base = window.SourceAdapterRegistry.repoRawBase() + SAHA_DIR;
      var fetches = files.map(function (f) {
        var fileName = f.file || f.path || f.name;
        if (!fileName) return Promise.resolve([]);
        var url = (f.path ? window.SourceAdapterRegistry.repoRawBase() + f.path : base + fileName);
        return window.SourceAdapterRegistry.fetchText(url).then(function (text) {
          if (!text) return [];
          return _safe(function () {
            return (typeof parseSahaGozlemCSV === 'function') ? parseSahaGozlemCSV(text) : [];
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
  //  3) normalize() — ham satır → FieldObservationRecord + context şekli
  // ──────────────────────────────────────────────────────────────────
  function normalize(rawRows) {
    var rows = rawRows || [];
    var records = rows.map(function (r) {
      return {
        tarih:      r.tarih || null,
        ttt:        r.ttt || null,
        hedefTipi:  _normHedefTipi(r.hedefTipi),
        hedefAdi:   r.hedefAdi || null,
        kategori:   _inferKategori(r.gozlemTipi),
        aciklama:   r.aciklama || '',
        onem:       _normOnem(r.onem),
        guvenirlik: 'TEMSILCI_GIRISI'
      };
    });

    var byTTT = {};
    var byKategori = {};
    records.forEach(function (rec) {
      if (rec.ttt) { (byTTT[rec.ttt] = byTTT[rec.ttt] || []).push(rec); }
      (byKategori[rec.kategori] = byKategori[rec.kategori] || []).push(rec);
    });

    var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    var now = Date.now();
    var recentCount = records.filter(function (rec) {
      var t = _safe(function () { return new Date(rec.tarih).getTime(); }, NaN);
      return !isNaN(t) && (now - t) <= THIRTY_DAYS_MS;
    }).length;

    return {
      available: records.length > 0,
      records: records,
      byTTT: byTTT,
      byKategori: byKategori,
      recentCount: recentCount
    };
  }

  function _getDefaultContext() {
    return { available: false, records: [], byTTT: {}, byKategori: {}, recentCount: 0 };
  }

  function _cacheSignature(rawRows) {
    return (rawRows || []).length + ':' + JSON.stringify(rawRows || []).length;
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) SORGU YARDIMCILARI (registry'nin senkron önbelleğinden okur)
  // ──────────────────────────────────────────────────────────────────
  function normalizeFieldObservations() {
    if (!window.SourceAdapterRegistry) return _getDefaultContext();
    var fields = window.SourceAdapterRegistry.getContextFields();
    return (fields && fields.fieldObservations) || _getDefaultContext();
  }

  function getObservationsByTTT(ttt) {
    var ctx = normalizeFieldObservations();
    return (ctx.byTTT && ctx.byTTT[ttt]) || [];
  }

  function getObservationsByCategory(kategori) {
    var ctx = normalizeFieldObservations();
    return (ctx.byKategori && ctx.byKategori[kategori]) || [];
  }

  function clearCache() {
    if (window.SourceAdapterRegistry) window.SourceAdapterRegistry.clearCache('fieldObservations');
  }

  // ── REGISTRY'YE KENDİ KENDİNE KAYIT (FAZ 7.0'ın kanıtladığı desen) ──
  if (window.SourceAdapterRegistry) {
    window.SourceAdapterRegistry.register({
      name: 'fieldObservations',
      discover: discover,
      normalize: normalize,
      cacheSignature: _cacheSignature,
      contextHook: 'fieldObservations',
      getDefaultContext: _getDefaultContext
    });
  } else {
    console.warn('[field-observation-adapter] SourceAdapterRegistry bulunamadı — register edilemedi (yükleme sırası kontrol edilmeli)');
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.FieldObservationAdapter = {
    normalizeFieldObservations: normalizeFieldObservations,
    getObservationsByTTT: getObservationsByTTT,
    getObservationsByCategory: getObservationsByCategory,
    clearCache: clearCache,
    version: ADAPTER_VERSION
  };

  console.debug('[field-observation-adapter] FAZ 7.0 Pilot #1 yüklendi. Versiyon:', ADAPTER_VERSION);

})();
