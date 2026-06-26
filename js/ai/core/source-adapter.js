// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/source-adapter.js
//  FAZ 7.0 — Genel SourceAdapter Arayüzü (AI_MIMARI_ANALIZ_VE_YOL_HARITASI.md §13, §16)
//
//  Sorumluluk:
//    Master Prompt'un listelediği TÜM gelecek veri kaynakları (SharePoint,
//    Rakip Satış Şartları, Saha Gözlemleri, Temsilci Notları, Eczane
//    Ziyaretleri, Market Haberleri, Fiyat Değişimleri, Lansmanlar, Stok
//    Problemleri) için TEK BİR genel adapter SÖZLEŞMESİ + KAYIT DEFTERİ
//    (registry) tanımlamak — §13'teki şema:
//      discover()     → manifest/dosya keşfi
//      normalize()    → ham veri → standart record modeli
//      cache()        → imza bazlı cache
//      contextHook    → AIContextBuilder'a hangi alan adıyla ekleneceği
//
//  ⚠️ NEDEN BU DOSYA VAR:
//    ims-adapter.js, competitive-adapter.js, pharmacy-adapter.js — her biri
//    AYNI deseni (discover/normalize/cache) BAĞIMSIZ OLARAK kendi içinde
//    tekrar yazdı (§12'nin işaret ettiği "ims-adapter cache deseni referans
//    model, diğerleri kopyalamalı" notu — kopyalama = tekrar). FAZ 7.0,
//    bu tekrarı GELECEK kaynaklar için ortadan kaldırır: yeni bir kaynak
//    eklemek için artık (a) bu arayüzü uygulayan TEK bir dosya yazılır,
//    (b) o dosya kendi kendini register() eder, (c) data-loader.js VE
//    ai-context-builder.js'e BİR DAHA ASLA DOKUNULMAZ — ikisi de bu
//    registry'yi GENEL olarak (adapter sayısından bağımsız) okur.
//
//    Mevcut 3 adapter (ims/competitive/pharmacy) BİLEREK bu registry'ye
//    GERİYE DÖNÜK TAŞINMADI — onlar zaten çalışıyor, "ekle, kırma"
//    prensibi (§16) gereği dokunulmadı. Bu FAZ sadece YENİ kaynaklar için
//    bu deseni KANITLAR (bkz. field-observation-adapter.js, stock-adapter.js
//    — ilk iki örnek tüketici).
//
//  SÖZLEŞME — register(adapter) şu şekli bekler:
//    {
//      name: string,                       // benzersiz kimlik, örn. 'fieldObservations'
//      discover:  function () → Promise,   // ham veri getirir (dosya/manifest keşfi DAHİL)
//      normalize: function (raw) → any,    // ham veri → standart record modeli
//      contextHook: string,                // context.<contextHook> = normalize() çıktısı
//      cacheSignature: function (raw) → string,   // OPSİYONEL — ucuz imza (yoksa JSON uzunluğu kullanılır)
//      getDefaultContext: function () → any        // OPSİYONEL — veri yokken context'e konacak güvenli varsayılan
//    }
//
//  Public API:
//    register(adapter)                  → boolean (başarılı mı)
//    getAdapter(name)                   → adapter | null
//    listAdapters()                     → string[] (kayıtlı adapter adları)
//    discoverAndNormalizeAll()          → Promise<Object> ({ [name]: 'OK'|'EMPTY'|'ERROR' } özet)
//    getContextFields()                 → Object ({ [contextHook]: normalized-veya-varsayılan }, SENKRON)
//    getStatus()                        → Object[] (debug/health-check için, her adapter için durum)
//    clearCache(name)                   → void (name verilmezse TÜMÜNÜ temizler)
//    fetchText(url)                     → Promise<string>  (hata-toleranslı ortak fetch — safeGet ile AYNI desen)
//    fetchManifest(dirPath)             → Promise<Object>  (mevcut eczane/manifest.json deseni — yoksa {files:[]})
//    repoRawBase()                      → string (GitHub raw kök URL'i)
//
//  CACHE: her adapter için ayrı, içerik-imza bazlı (ims-adapter.js
//  deseniyle AYNI mantık, ama burada GENEL/TEK YERDEN uygulanıyor —
//  adapter'ların kendi cache mekanizması YAZMASINA gerek YOK).
//
//  Kurallar:
//    • Bir adapter discover()/normalize() içinde HATA FIRLATIRSA, SADECE
//      o adapter 'ERROR' olarak işaretlenir — diğer adapter'lar VE mevcut
//      hiçbir motor etkilenmez (izolasyon, §15 risk azaltımı).
//    • DOM erişimi YOK.
//    • Parser katmanı (csv-parser.js) bu dosyada YOK — her pilot adapter
//      kendi parse fonksiyonunu csv-parser.js'e ekler (KATMAN 0/1 ayrımı
//      korunur, bkz. field-observation-adapter.js / stock-adapter.js).
//
//  Bağımlılık: YOK (saf, bağımsız altyapı — hiçbir global'e zorunlu
//              bağımlı değil; GITHUB_IMG_BASE varsa kullanır, yoksa
//              sabit fallback).
//  Yükleme sırası: data-state.js SONRASI (opsiyonel), HER PİLOT
//                  ADAPTER'DAN (field-observation-adapter.js,
//                  stock-adapter.js) ÖNCESİ, ai-context-builder.js ÖNCESİ.
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._SOURCE_ADAPTER_REGISTRY_LOADED) {
    console.warn('[source-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._SOURCE_ADAPTER_REGISTRY_LOADED = true;

  var REGISTRY_VERSION = '1.0';

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ──────────────────────────────────────────────────────────────────
  //  0) KAYIT DEFTERİ (in-memory) — adapter tanımları + her biri için cache
  // ──────────────────────────────────────────────────────────────────
  var _adapters = {};   // name → adapter tanımı (register() ile gelen)
  var _cache    = {};   // name → { raw, normalized, signature, lastSyncedAt, status }

  function register(adapter) {
    if (!adapter || typeof adapter !== 'object') {
      console.warn('[source-adapter] register() reddedildi: adapter objesi değil');
      return false;
    }
    if (!adapter.name || typeof adapter.name !== 'string') {
      console.warn('[source-adapter] register() reddedildi: "name" zorunlu');
      return false;
    }
    if (typeof adapter.discover !== 'function' || typeof adapter.normalize !== 'function') {
      console.warn('[source-adapter] register("' + adapter.name + '") reddedildi: discover()/normalize() zorunlu');
      return false;
    }
    if (!adapter.contextHook || typeof adapter.contextHook !== 'string') {
      console.warn('[source-adapter] register("' + adapter.name + '") reddedildi: "contextHook" zorunlu');
      return false;
    }
    if (_adapters[adapter.name]) {
      console.warn('[source-adapter] register("' + adapter.name + '") atlandı — bu isim zaten kayıtlı');
      return false;
    }
    _adapters[adapter.name] = adapter;
    _cache[adapter.name] = { raw: null, normalized: null, signature: null, lastSyncedAt: null, status: 'PENDING' };
    console.debug('[source-adapter] kayıt edildi: "' + adapter.name + '" → context.' + adapter.contextHook);
    return true;
  }

  function getAdapter(name) {
    return _adapters[name] || null;
  }

  function listAdapters() {
    return Object.keys(_adapters);
  }

  // ──────────────────────────────────────────────────────────────────
  //  1) ORTAK FETCH YARDIMCILARI — data-loader.js'in safeGet() deseniyle
  //     AYNI hata-toleransı (2 deneme: no-store, sonra query-string).
  //     Bu sayede her pilot adapter kendi fetch toleransını YENİDEN
  //     YAZMAK ZORUNDA DEĞİL.
  // ──────────────────────────────────────────────────────────────────
  function fetchText(url) {
    var ts = Date.now();
    var attempts = [
      function () { return fetch(url, { cache: 'no-store', redirect: 'follow' }); },
      function () { return fetch(url + '?nocache=' + ts, { redirect: 'follow' }); }
    ];
    var i = 0;
    function tryNext() {
      if (i >= attempts.length) return Promise.resolve('');
      var attempt = attempts[i++];
      return attempt()
        .then(function (r) {
          if (r && r.ok) {
            return r.text().then(function (text) {
              if (text && !text.trim().startsWith('<')) return text;
              return tryNext();
            });
          }
          return tryNext();
        })
        .catch(function () { return tryNext(); });
    }
    return tryNext();
  }

  // repoRawBase() — pharmacy-data-manager.js'in REPO_RAW_BASE deseniyle AYNI
  function repoRawBase() {
    return _safe(function () {
      if (typeof GITHUB_IMG_BASE !== 'undefined') {
        return GITHUB_IMG_BASE.replace(/images\/?$/, '');
      }
      return 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/';
    }, 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/');
  }

  // fetchManifest(dirPath) — mevcut eczane/manifest.json deseniyle AYNI
  // şekli bekler ({ files:[{file,...}], ... }). Dosya/manifest henüz
  // YOKSA (gelecek kaynak için repo'da hiç dizin açılmamışsa) HATA
  // VERMEZ — boş { files: [] } döner (discover() bunu kontrol eder).
  // @param {string} dirPath — örn. 'saha-gozlem/' (sondaki / ile)
  function fetchManifest(dirPath) {
    var url = repoRawBase() + dirPath + 'manifest.json';
    return fetchText(url).then(function (text) {
      if (!text) return { dir: dirPath, files: [] };
      try {
        var parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.files)) return { dir: dirPath, files: [] };
        return parsed;
      } catch (e) {
        console.warn('[source-adapter] manifest.json parse hatası (' + dirPath + '):', e.message);
        return { dir: dirPath, files: [] };
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  2) İMZA / CACHE — adapter cacheSignature sağlamazsa GENEL fallback
  //     (JSON uzunluğu — ims-adapter kadar ucuz değil ama HER zaman
  //     güvenli ve adapter'a özel kod gerektirmez).
  // ──────────────────────────────────────────────────────────────────
  function _computeSignature(adapter, raw) {
    if (typeof adapter.cacheSignature === 'function') {
      return _safe(function () { return adapter.cacheSignature(raw); }, null);
    }
    return _safe(function () {
      if (Array.isArray(raw)) return raw.length + ':' + JSON.stringify(raw).length;
      return JSON.stringify(raw || null).length + '';
    }, null);
  }

  // ──────────────────────────────────────────────────────────────────
  //  3) discoverAndNormalizeAll — ANA SENKRONIZASYON FONKSİYONU
  //     Her adapter İZOLE çalışır: biri çökerse diğerleri ETKİLENMEZ.
  // ──────────────────────────────────────────────────────────────────
  function discoverAndNormalizeAll() {
    var names = listAdapters();
    if (!names.length) return Promise.resolve({});

    var jobs = names.map(function (name) {
      var adapter = _adapters[name];
      return Promise.resolve()
        .then(function () { return adapter.discover(); })
        .then(function (raw) {
          var sig = _computeSignature(adapter, raw);
          var prev = _cache[name];

          // İçerik değişmediyse (imza aynı) yeniden normalize ETME —
          // ims-adapter.js'in cache deseniyle AYNI performans kazancı.
          if (prev && prev.signature !== null && prev.signature === sig) {
            prev.lastSyncedAt = new Date().toISOString();
            return name + ':UNCHANGED';
          }

          var isEmpty = !raw || (Array.isArray(raw) && raw.length === 0);
          var normalized = isEmpty ? null : _safe(function () { return adapter.normalize(raw); }, null);

          _cache[name] = {
            raw: raw,
            normalized: normalized,
            signature: sig,
            lastSyncedAt: new Date().toISOString(),
            status: isEmpty ? 'EMPTY' : (normalized ? 'OK' : 'ERROR')
          };
          return name + ':' + _cache[name].status;
        })
        .catch(function (err) {
          _cache[name] = {
            raw: null, normalized: null, signature: null,
            lastSyncedAt: new Date().toISOString(), status: 'ERROR',
            error: _safe(function () { return err.message; }, 'bilinmeyen hata')
          };
          console.warn('[source-adapter] "' + name + '" senkronizasyon hatası (izole, diğerleri etkilenmedi):', _cache[name].error);
          return name + ':ERROR';
        });
    });

    return Promise.all(jobs).then(function (results) {
      var summary = {};
      results.forEach(function (r) {
        var parts = r.split(':');
        summary[parts[0]] = parts[1];
      });
      return summary;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  4) getContextFields — AIContextBuilder'ın TEK satırla okuduğu köprü.
  //     SENKRON çalışır (discoverAndNormalizeAll() ÖNCEDEN bir kez
  //     data-loader.js::syncData() içinden tetiklenmiş olmalı — RAKIP_
  //     AKSİYON/IMS ile AYNI "veri taze tutulur, render'ı BLOKLAMAZ"
  //     deseni). Hiç senkronize edilmemiş bir adapter için
  //     getDefaultContext() (varsa) ya da {available:false} döner.
  // ──────────────────────────────────────────────────────────────────
  function getContextFields() {
    var fields = {};
    listAdapters().forEach(function (name) {
      var adapter = _adapters[name];
      var cached  = _cache[name];
      var value = (cached && cached.normalized) ? cached.normalized : _safe(function () {
        return typeof adapter.getDefaultContext === 'function' ? adapter.getDefaultContext() : { available: false };
      }, { available: false });
      fields[adapter.contextHook] = value;
    });
    return fields;
  }

  // ──────────────────────────────────────────────────────────────────
  //  5) getStatus / clearCache — debug + health-check yardımcıları
  // ──────────────────────────────────────────────────────────────────
  function getStatus() {
    return listAdapters().map(function (name) {
      var c = _cache[name] || {};
      return {
        name: name,
        contextHook: _adapters[name].contextHook,
        status: c.status || 'PENDING',
        lastSyncedAt: c.lastSyncedAt || null,
        error: c.error || null
      };
    });
  }

  function clearCache(name) {
    if (name) {
      if (_cache[name]) _cache[name] = { raw: null, normalized: null, signature: null, lastSyncedAt: null, status: 'PENDING' };
      return;
    }
    Object.keys(_cache).forEach(function (n) {
      _cache[n] = { raw: null, normalized: null, signature: null, lastSyncedAt: null, status: 'PENDING' };
    });
  }

  // ── EXPORTS ──────────────────────────────────────────────────────
  window.SourceAdapterRegistry = {
    register: register,
    getAdapter: getAdapter,
    listAdapters: listAdapters,
    discoverAndNormalizeAll: discoverAndNormalizeAll,
    getContextFields: getContextFields,
    getStatus: getStatus,
    clearCache: clearCache,
    fetchText: fetchText,
    fetchManifest: fetchManifest,
    repoRawBase: repoRawBase,
    version: REGISTRY_VERSION
  };

  console.debug('[source-adapter] FAZ 7.0 — Genel SourceAdapter Registry yüklendi. Versiyon:', REGISTRY_VERSION);

})();
