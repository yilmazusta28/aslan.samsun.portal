// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/saha-gozlem-store.js
//  FAZ 12.2 — Saha Gözlemleri (Manuel IndexedDB Kaynağı)
//
//  Sorumluluk:
//    Rep/yöneticinin UI üzerinden girdiği saha gözlemlerini IndexedDB'ye
//    kaydeder. CSV kaynağı (FAZ 7.0) DEĞİŞTİRİLMEZ — bu kayıt ek kaynaktır.
//    parseSahaGozlemCSV şemasıyla UYUMLU: aynı kategori değerleri.
//
//  Kategori değerleri (parseSahaGozlemCSV ile aynı):
//    RAKIP | STOK | FIYAT | GERI_BILDIRIM | DIGER
//
//  Schema:
//    { id(autoIncrement), kategori, eczane?, ttt?, not, tarih,
//      girenTTT, enteredAt }
//
//  Public API:
//    saveObservation(obs)          → Promise<obs>
//    getAll()                      → Promise<obs[]>
//    getByEczane(eczane)           → obs[] (senkron — bellek cache)
//    getByTTT(ttt)                 → Promise<obs[]>
//    getByKategori(kategori)       → Promise<obs[]>
//    deleteObservation(id)         → Promise<boolean>
//    refresh()                     → Promise (cache'i yenile)
//
//  Bağımlılık: PharmaDB (pharma-db.js) — store: saha_gozlemleri (v3)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._SAHA_GOZLEM_STORE_LOADED) {
    console.warn('[saha-gozlem-store] Zaten yüklü — atlandı');
    return;
  }
  window._SAHA_GOZLEM_STORE_LOADED = true;

  var STORE = 'saha_gozlemleri';

  // Bellek-içi cache — getByEczane() senkron erişim için
  var _cache = [];

  function _withStore(mode, fn) {
    if (!window.PharmaDB) return Promise.resolve(fn(null));
    return window.PharmaDB.withStore(STORE, mode, fn);
  }

  // ── saveObservation ────────────────────────────────────────────────
  function saveObservation(obs) {
    var now = new Date().toISOString();
    var entry = {
      kategori:  obs.kategori  || 'DIGER',
      eczane:    obs.eczane    || null,
      ttt:       obs.ttt       || null,
      not:       obs.not       || '',
      tarih:     obs.tarih     || now.slice(0, 10),
      girenTTT:  obs.girenTTT  || null,
      enteredAt: now
    };

    return _withStore('readwrite', function (store) {
      if (!store) { _cache.push(entry); return Promise.resolve(entry); }
      return new Promise(function (resolve, reject) {
        var req = store.add(entry);
        req.onsuccess = function (e) {
          entry.id = e.target.result;
          _cache.push(entry);
          resolve(entry);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── getAll ────────────────────────────────────────────────────────
  function getAll() {
    return _withStore('readonly', function (store) {
      if (!store) return Promise.resolve(_cache.slice());
      return new Promise(function (resolve, reject) {
        var req = store.getAll ? store.getAll() : null;
        if (req) {
          req.onsuccess = function () { _cache = req.result || []; resolve(_cache.slice()); };
          req.onerror   = function (e) { reject(e.target.error); };
        } else {
          var out = [];
          var cur = store.openCursor();
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (c) { out.push(c.value); c.continue(); } else { _cache = out; resolve(out); }
          };
          cur.onerror = function (e) { reject(e.target.error); };
        }
      });
    });
  }

  // ── getByEczane — SENKRON (cache'ten) ────────────────────────────
  function getByEczane(eczane) {
    if (!eczane) return [];
    return _cache.filter(function (o) { return o.eczane === eczane; });
  }

  // ── getByTTT ──────────────────────────────────────────────────────
  function getByTTT(ttt) {
    return getAll().then(function (all) {
      return all.filter(function (o) { return !ttt || o.ttt === ttt; });
    });
  }

  // ── getByKategori ─────────────────────────────────────────────────
  function getByKategori(kategori) {
    return getAll().then(function (all) {
      return all.filter(function (o) { return o.kategori === kategori; });
    });
  }

  // ── deleteObservation ─────────────────────────────────────────────
  function deleteObservation(id) {
    return _withStore('readwrite', function (store) {
      if (!store) { _cache = _cache.filter(function (o) { return o.id !== id; }); return Promise.resolve(true); }
      return new Promise(function (resolve, reject) {
        var req = store.delete(id);
        req.onsuccess = function () {
          _cache = _cache.filter(function (o) { return o.id !== id; });
          resolve(true);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  // ── refresh — cache'i IndexedDB'den yenile ─────────────────────
  function refresh() { return getAll(); }

  // Sayfa yüklenince cache'i doldur
  refresh().catch(function () {});

  window.SahaGozlemStore = {
    saveObservation:   saveObservation,
    getAll:            getAll,
    getByEczane:       getByEczane,
    getByTTT:          getByTTT,
    getByKategori:     getByKategori,
    deleteObservation: deleteObservation,
    refresh:           refresh,
    version:           '12.2'
  };

  console.debug('[saha-gozlem-store] FAZ 12.2 yüklendi.');

})();
