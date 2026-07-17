// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/stock-entry-adapter.js
//  FAZ 9.3 — Stok Intelligence (Saha Manuel Girişi)
//
//  NOT: stok-adapter.js (FAZ 7.0, localStorage, NİTEL: KRİTİK/NORMAL/
//  YETERLİ) İLE KARIŞTIRILMAMALI. Bu adapter TEMSİLCİNİN SAHADA ANLIK
//  girdiği SAYISAL stok bilgisini IndexedDB'de saklar.
//
//  KARAR (FAZ 9.3): İki kaynak BİRLEŞTİRİLMEYECEK, AYRI kalacak.
//    stockSignals (FAZ 7.0, localStorage, nitel) → dokunulmaz
//    stockEntries (FAZ 9.3, IndexedDB, sayısal) → bu dosya
//
//  AI öncelik sırası (FAZ 9.4 Digital Twin'de uygulanacak):
//    1) stockEntries SAYISAL   2) stockEntries NİTEL (stok-adapter.js)
//    3) son sipariş  4) aylık satış  5) IMS  6) stockSignals
//    7) mevsimsellik  8) pattern
//
//  Depolama: IndexedDB → pharma-db.js (PharmaDB paylaşımlı DB)
//    Store: stock_entries
//    Model: { id(auto), pharmacy, date, products: [{product, stock}], enteredAt }
//
//  Public API:
//    recordStockEntry(pharmacy, date, products) → Promise<void>
//    getLatestStockEntry(pharmacy)              → Promise<StockEntry|null>
//    getStockHistory(pharmacy)                  → Promise<StockEntry[]>
//
//  contextHook: 'stockEntries' — SourceAdapterRegistry'ye kendini
//  kayıt eder (varsa). discover() IndexedDB'den okur (CSV/manifest yok).
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._STOCK_ENTRY_ADAPTER_LOADED) {
    console.warn('[stock-entry-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._STOCK_ENTRY_ADAPTER_LOADED = true;

  var STORE = 'stock_entries';

  var _fallback = {}; // pharmacy → StockEntry[] (IndexedDB yoksa)

  // ── Senkron bellek-içi önbellek (GÜVENLİ EKLEME — mevcut asenkron API'ye
  //    dokunulmadı) ─────────────────────────────────────────────────────
  //  Amaç: digital-twin-builder.js gibi SENKRON çalışan tüketiciler,
  //  IndexedDB'yi (doğası gereği asenkron) doğrudan await edemiyor. Bu
  //  önbellek, sayfa yüklendiğinde arka planda BİR KEZ IndexedDB'den
  //  okunup doldurulur (discover() üzerinden — zaten var olan API) ve her
  //  yeni kayıtta güncellenir. Tüketiciler getLatestStockEntrySync() ile
  //  "şu an bilinen en son değeri" senkron okuyabilir; önbellek henüz
  //  dolmamışsa (sayfa yeni açıldıysa) null döner — hata fırlatmaz.
  var _memCache      = {};   // pharmacy → en son StockEntry
  var _memCacheReady = false;

  function _latestByPharmacy(entries) {
    var byPharmacy = {};
    (entries || []).forEach(function (e) {
      var cur = byPharmacy[e.pharmacy];
      if (!cur || (e.enteredAt || '').localeCompare(cur.enteredAt || '') > 0) {
        byPharmacy[e.pharmacy] = e;
      }
    });
    return byPharmacy;
  }

  function _rebuildMemCache() {
    return discover().then(function (result) {
      _memCache = _latestByPharmacy(result && result.stockEntries);
      _memCacheReady = true;
    }).catch(function (err) {
      console.warn('[stock-entry-adapter] _rebuildMemCache hata:', err && err.message);
      _memCacheReady = true; // hata da olsa "denedik" işaretle — sonsuz null bekleme olmasın
    });
  }

  // Senkron okuma — önbellek henüz dolmadıysa null (asla throw etmez)
  function getLatestStockEntrySync(pharmacy) {
    return _memCache[pharmacy] || null;
  }

  function isMemCacheReady() { return _memCacheReady; }

  // ── recordStockEntry ───────────────────────────────────────────────────
  function recordStockEntry(pharmacy, date, products) {
    var entry = {
      pharmacy:   pharmacy,
      date:       date || new Date().toISOString().slice(0, 10),
      products:   products || [],
      enteredAt:  new Date().toISOString()
    };

    function _updateMemCache() {
      // Yeni kayıt her zaman "en son" olur (enteredAt = şimdi) — direkt yaz.
      _memCache[pharmacy] = entry;
    }

    if (!window.PharmaDB) {
      if (!_fallback[pharmacy]) _fallback[pharmacy] = [];
      _fallback[pharmacy].push(entry);
      _updateMemCache();
      return Promise.resolve();
    }

    return window.PharmaDB.withStore(STORE, 'readwrite', function (store) {
      if (!store) {
        if (!_fallback[pharmacy]) _fallback[pharmacy] = [];
        _fallback[pharmacy].push(entry);
        _updateMemCache();
        return Promise.resolve();
      }
      return new Promise(function (resolve, reject) {
        var req = store.add(entry);
        req.onsuccess = function () { _updateMemCache(); resolve(); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getLatestStockEntry ────────────────────────────────────────────────
  function getLatestStockEntry(pharmacy) {
    if (!window.PharmaDB) {
      var entries = _fallback[pharmacy] || [];
      return Promise.resolve(entries.length ? entries[entries.length - 1] : null);
    }

    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) {
        var fb = _fallback[pharmacy] || [];
        return Promise.resolve(fb.length ? fb[fb.length - 1] : null);
      }
      return new Promise(function (resolve, reject) {
        var results = [];
        var idx = store.index('pharmacy');
        var req = idx.openCursor(IDBKeyRange.only(pharmacy));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else {
            if (!results.length) { resolve(null); return; }
            results.sort(function (a, b) { return b.enteredAt.localeCompare(a.enteredAt); });
            resolve(results[0]);
          }
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getStockHistory ────────────────────────────────────────────────────
  function getStockHistory(pharmacy) {
    if (!window.PharmaDB) {
      return Promise.resolve((_fallback[pharmacy] || []).slice());
    }
    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) return Promise.resolve((_fallback[pharmacy] || []).slice());
      return new Promise(function (resolve, reject) {
        var results = [];
        var idx = store.index('pharmacy');
        var req = idx.openCursor(IDBKeyRange.only(pharmacy));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else {
            results.sort(function (a, b) { return b.enteredAt.localeCompare(a.enteredAt); });
            resolve(results);
          }
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── discover — SourceAdapterRegistry sözleşmesi ───────────────────────
  // IndexedDB'deki tüm stok girişlerini döner (CSV/manifest ETMEZ)
  function discover() {
    if (!window.PharmaDB) return Promise.resolve({ stockEntries: Object.values(_fallback).flat() });
    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) return Promise.resolve({ stockEntries: [] });
      return new Promise(function (resolve, reject) {
        var results = [];
        var req = store.openCursor();
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else resolve({ stockEntries: results });
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  window.StockEntryAdapter = {
    recordStockEntry:        recordStockEntry,
    getLatestStockEntry:     getLatestStockEntry,
    getStockHistory:         getStockHistory,
    discover:                discover,
    getLatestStockEntrySync: getLatestStockEntrySync,
    isMemCacheReady:         isMemCacheReady,
    contextHook:             'stockEntries',
    version:                 '9.4'
  };

  // SourceAdapterRegistry'ye kendini kayıt et (varsa)
  if (window.SourceAdapterRegistry && typeof window.SourceAdapterRegistry.register === 'function') {
    window.SourceAdapterRegistry.register({ name: 'stockEntries', contextHook: 'stockEntries', adapter: window.StockEntryAdapter });
  }

  // Senkron önbelleği arka planda BİR KEZ doldur (sayfa yüklenirken).
  // Bilerek "fire and forget" — hiçbir çağıranı bloklamaz, sadece
  // getLatestStockEntrySync()'in mümkün olan en kısa sürede gerçek veri
  // dönmesini sağlar.
  _rebuildMemCache();

  console.debug('[stock-entry-adapter] FAZ 9.4 yüklendi. contextHook: stockEntries (senkron önbellek eklendi)');

})();
