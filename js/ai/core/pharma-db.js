// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/pharma-db.js
//  FAZ 9.2 — Paylaşımlı IndexedDB yöneticisi
//
//  FAZ 9.x modülleri (Coverage Selection, Stock Entry, Route Plan,
//  Field Observations) bu yardımcıyı kullanır. Tek bir DB açılır,
//  her FAZ yeni bir object store ekler — versiyon yükseltme burada
//  yönetilir (outcome-tracker.js / learning-engine.js DEĞİŞTİRİLMEDİ).
//
//  DB Adı: pharma_ai_pharma_db
//  Store'lar (versiyon yükseldikçe eklenir):
//    v1: coverage_selections, stock_entries
//    (v2+ ileride: route_plans, field_observations_manual)
//
//  Public API:
//    PharmaDB.open()          → Promise<IDBDatabase|null>
//    PharmaDB.withStore(storeName, mode, fn) → Promise<any>
//
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._PHARMA_DB_LOADED) return;
  window._PHARMA_DB_LOADED = true;

  var DB_NAME    = 'pharma_ai_pharma_db';
  var DB_VERSION = 3; // v3: saha_gozlemleri eklendi (FAZ 12.2)

  var _dbPromise = null;
  var _usingFallback = false;
  var _fallbackStore = {};

  function open() {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB desteklenmiyor'));
        return;
      }
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = function (e) {
          var db = e.target.result;

          if (!db.objectStoreNames.contains('coverage_selections')) {
            var cs = db.createObjectStore('coverage_selections', { keyPath: 'pharmacy' });
            cs.createIndex('representative', 'representative', { unique: false });
            cs.createIndex('selectedForVisit', 'selectedForVisit', { unique: false });
          }

          if (!db.objectStoreNames.contains('stock_entries')) {
            var se = db.createObjectStore('stock_entries', { keyPath: 'id', autoIncrement: true });
            se.createIndex('pharmacy', 'pharmacy', { unique: false });
            se.createIndex('date', 'date', { unique: false });
          }

          // v2: route_plans — FAZ 10.2 haftalık rota planı
          // keyPath: composite representative+weekday string olarak tutulur
          if (!db.objectStoreNames.contains('route_plans')) {
            var rp = db.createObjectStore('route_plans', { keyPath: 'id' }); // id = representative+'|'+weekday
            rp.createIndex('representative', 'representative', { unique: false });
            rp.createIndex('weekday', 'weekday', { unique: false });
          }

          // v3: saha_gozlemleri — FAZ 12.2 manuel saha gözlemleri (IndexedDB kaynağı)
          // Schema: { id(autoIncrement), kategori, eczane?, ttt?, not, tarih, girenTTT, enteredAt }
          if (!db.objectStoreNames.contains('saha_gozlemleri')) {
            var sg = db.createObjectStore('saha_gozlemleri', { keyPath: 'id', autoIncrement: true });
            sg.createIndex('kategori',   'kategori',   { unique: false });
            sg.createIndex('eczane',     'eczane',     { unique: false });
            sg.createIndex('ttt',        'ttt',        { unique: false });
            sg.createIndex('tarih',      'tarih',      { unique: false });
          }
        };

        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror   = function (e) {
          reject((e.target && e.target.error) || new Error('DB açma hatası'));
        };
      } catch (e) { reject(e); }
    }).catch(function (e) {
      console.warn('[pharma-db] IndexedDB açılamadı, bellek-içi fallback:', e.message);
      _usingFallback = true;
      return null;
    });

    return _dbPromise;
  }

  function withStore(storeName, mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null, _fallbackStore);
      return new Promise(function (resolve, reject) {
        try {
          var tx    = db.transaction(storeName, mode);
          var store = tx.objectStore(storeName);
          var result;
          try {
            result = fn(store, null);
          } catch (e) { reject(e); return; }
          if (result && typeof result.then === 'function') {
            result.then(resolve).catch(reject);
          } else {
            tx.oncomplete = function () { resolve(result); };
            tx.onerror    = function (e) { reject(e.target.error); };
          }
        } catch (e) { reject(e); }
      });
    });
  }

  window.PharmaDB = {
    open:      open,
    withStore: withStore,
    isFallback: function () { return _usingFallback; }
  };

  console.debug('[pharma-db] FAZ 9.x paylaşımlı DB yüklendi.');

})();
