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

  // ── FAZ 12.5 — Senkron okuma cache'i ─────────────────────────────────
  // getLatestStockEntry() async (IndexedDB) olduğu için sync motorlar
  // (örn. digital-twin-builder.js) doğrudan okuyamıyordu. Bu cache
  // recordStockEntry() ve getLatestStockEntry() her çağrıldığında
  // (yani UI bir eczaneyi açtığında/kaydettiğinde) doldurulur; sync
  // motorlar getLatestStockEntrySync() ile en güncel bilineni okur.
  var _syncCache = {}; // pharmacy → StockEntry | null

  function getLatestStockEntrySync(pharmacy) {
    return _syncCache.hasOwnProperty(pharmacy) ? _syncCache[pharmacy] : null;
  }

  function primeSyncCache(pharmacy, entry) {
    _syncCache[pharmacy] = entry || null;
  }

  // ── recordStockEntry ───────────────────────────────────────────────────
  function recordStockEntry(pharmacy, date, products) {
    var entry = {
      pharmacy:   pharmacy,
      date:       date || new Date().toISOString().slice(0, 10),
      products:   products || [],
      enteredAt:  new Date().toISOString()
    };

    // FAZ 12.5: kaydedilen giriş anında sync cache'e yazılır — bu giriş
    // her zaman en güncel olduğu için ekstra okuma beklemeye gerek yok.
    primeSyncCache(pharmacy, entry);

    if (!window.PharmaDB) {
      if (!_fallback[pharmacy]) _fallback[pharmacy] = [];
      _fallback[pharmacy].push(entry);
      return Promise.resolve(entry);
    }

    return window.PharmaDB.withStore(STORE, 'readwrite', function (store) {
      if (!store) {
        if (!_fallback[pharmacy]) _fallback[pharmacy] = [];
        _fallback[pharmacy].push(entry);
        return Promise.resolve();
      }
      return new Promise(function (resolve, reject) {
        var req = store.add(entry);
        req.onsuccess = function () { resolve(); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getLatestStockEntry ────────────────────────────────────────────────
  function getLatestStockEntry(pharmacy) {
    if (!window.PharmaDB) {
      var entries = _fallback[pharmacy] || [];
      var result = entries.length ? entries[entries.length - 1] : null;
      primeSyncCache(pharmacy, result);
      return Promise.resolve(result);
    }

    return window.PharmaDB.withStore(STORE, 'readonly', function (store) {
      if (!store) {
        var fb = _fallback[pharmacy] || [];
        var fbResult = fb.length ? fb[fb.length - 1] : null;
        primeSyncCache(pharmacy, fbResult);
        return Promise.resolve(fbResult);
      }
      return new Promise(function (resolve, reject) {
        var results = [];
        var idx = store.index('pharmacy');
        var req = idx.openCursor(IDBKeyRange.only(pharmacy));
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else {
            if (!results.length) { primeSyncCache(pharmacy, null); resolve(null); return; }
            results.sort(function (a, b) { return b.enteredAt.localeCompare(a.enteredAt); });
            primeSyncCache(pharmacy, results[0]);
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
    recordStockEntry:       recordStockEntry,
    getLatestStockEntry:    getLatestStockEntry,
    getLatestStockEntrySync: getLatestStockEntrySync, // FAZ 12.5: sync motorlar için
    getStockHistory:        getStockHistory,
    discover:               discover,
    contextHook:            'stockEntries',
    version:                '9.3.1'
  };

  // SourceAdapterRegistry'ye kendini kayıt et (varsa)
  if (window.SourceAdapterRegistry && typeof window.SourceAdapterRegistry.register === 'function') {
    window.SourceAdapterRegistry.register({ name: 'stockEntries', contextHook: 'stockEntries', adapter: window.StockEntryAdapter });
  }

  console.debug('[stock-entry-adapter] FAZ 9.3 yüklendi. contextHook: stockEntries');

})();
