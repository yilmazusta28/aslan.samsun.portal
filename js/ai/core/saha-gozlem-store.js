// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/saha-gozlem-store.js
//  FAZ 12.2 — Saha Gözlemleri (Manuel IndexedDB Kaynağı)
//  FAZ 17.0 — Worker/GitHub Senkronu (çoklu cihaz)
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
//    { id(autoIncrement, SADECE YEREL), kategori, eczane?, ttt?, not, tarih,
//      girenTTT, enteredAt }
//
//  FAZ 17.0 — Worker/GitHub Senkronu (route-plan-input.js / stock-entry-
//  adapter.js İLE AYNI DESEN, worker.js'in /gozlem-sync endpoint'i
//  kullanılır):
//    window.GOZLEM_SYNC_WORKER_URL tanımlıysa, saveObservation() sonrası
//    o gözlemi { kategori, eczane, ttt, not, tarih, girenTTT, enteredAt }
//    formatında worker'a POST eder (fire-and-forget, bu sekme içinde
//    SIRAYA alınır). Worker bunu GitHub'daki data/saha_gozlemleri.json'a
//    (düz bir observations[] listesine, enteredAt'e göre dedup ederek)
//    EKLER — en fazla son 500 gözlem tutulur.
//    getAll()/getByTTT()/getByKategori() artık YEREL (IndexedDB) + UZAK
//    (GitHub) veriyi enteredAt'e göre birleştirip dönüyor; getByEczane()
//    (senkron) bu birleşik veriyi _cache üzerinden okur (getAll() her
//    çağrıldığında _cache güncellenir).
//    SINIRLAMA: deleteObservation() SADECE yerel IndexedDB'den siler —
//    worker'a silme isteği GÖNDERİLMEZ (o gözlem GitHub'daki listede
//    kalmaya devam eder, sonraki getAll() birleşiminde tekrar görünür).
//    Bu bilinen bir sınırlama; silme senkronu ayrı bir FAZ'da ele alınabilir.
//
//  Public API:
//    saveObservation(obs)          → Promise<obs>
//    getAll()                      → Promise<obs[]>  (yerel+uzak birleşik)
//    getByEczane(eczane)           → obs[] (senkron — bellek cache)
//    getByTTT(ttt)                 → Promise<obs[]>
//    getByKategori(kategori)       → Promise<obs[]>
//    deleteObservation(id)         → Promise<boolean> (SADECE yerel)
//    fetchTeamObservations()       → Promise<obs[]|null>
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

  // Bellek-içi cache — getByEczane() senkron erişim için (getAll() sonrası
  // YEREL+UZAK birleşik veriyle doldurulur)
  var _cache = [];

  function _withStore(mode, fn) {
    if (!window.PharmaDB) return Promise.resolve(fn(null));
    return window.PharmaDB.withStore(STORE, mode, fn);
  }

  // ── FAZ 17.0 — Worker Senkronu (route-plan-input.js / stock-entry-
  // adapter.js ile AYNI desen: SIRAYA alınmış fire-and-forget POST) ────
  var _workerSyncQueue = Promise.resolve();

  function _syncToWorker(entry) {
    if (!window.GOZLEM_SYNC_WORKER_URL || !entry) return;
    var payload = {
      kategori:  entry.kategori,
      eczane:    entry.eczane,
      ttt:       entry.ttt,
      not:       entry.not,
      tarih:     entry.tarih,
      girenTTT:  entry.girenTTT,
      enteredAt: entry.enteredAt
    };
    _workerSyncQueue = _workerSyncQueue.then(function () {
      return fetch(window.GOZLEM_SYNC_WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      }).then(function (res) {
        if (res && !res.ok) console.warn('[saha-gozlem-store] worker senkron HTTP hatası:', res.status);
      }).catch(function (e) {
        console.warn('[saha-gozlem-store] worker senkron hatası (yoksayıldı, yerel kayıt geçerli):', e && e.message);
      });
    });
  }

  // ── fetchTeamObservations — GitHub'daki data/saha_gozlemleri.json'ı
  // doğrudan oku (worker'da GET yok, route-plan-input.js ile aynı desen) ─
  var _GOZLEM_RAW_URL = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/data/saha_gozlemleri.json';
  function fetchTeamObservations() {
    return fetch(_GOZLEM_RAW_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) { return (data && Array.isArray(data.observations)) ? data.observations : null; })
      .catch(function (e) {
        console.warn('[saha-gozlem-store] GitHub\'dan ekip gözlem verisi okunamadı (yerel fallback kullanılacak):', e && e.message);
        return null;
      });
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

    var writePromise = _withStore('readwrite', function (store) {
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

    // IndexedDB yazımı KESİNLEŞTİKTEN sonra worker'a gönder — çağırana
    // dönen Promise'i bekletmez/etkilemez (fire-and-forget).
    writePromise.then(function () { _syncToWorker(entry); }).catch(function () {});

    return writePromise;
  }

  // ── _getLocalAll — SADECE IndexedDB/_cache'ten okur (uzak veri içermez) ─
  function _getLocalAll() {
    return _withStore('readonly', function (store) {
      if (!store) return Promise.resolve(_cache.slice());
      return new Promise(function (resolve, reject) {
        var req = store.getAll ? store.getAll() : null;
        if (req) {
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror   = function (e) { reject(e.target.error); };
        } else {
          var out = [];
          var cur = store.openCursor();
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (c) { out.push(c.value); c.continue(); } else { resolve(out); }
          };
          cur.onerror = function (e) { reject(e.target.error); };
        }
      });
    });
  }

  // ── _mergeObservations — yerel + uzak listeleri enteredAt'e göre dedup
  // edip yeniden-eskiye sıralar ────────────────────────────────────────
  function _mergeObservations(localList, workerList) {
    var byKey = {};
    (localList || []).forEach(function (o) { if (o && o.enteredAt) byKey[o.enteredAt] = o; });
    (workerList || []).forEach(function (o) {
      if (o && o.enteredAt && !byKey[o.enteredAt]) byKey[o.enteredAt] = o; // yerel kayıt (id'li) öncelikli
    });
    var merged = Object.keys(byKey).map(function (k) { return byKey[k]; });
    merged.sort(function (a, b) { return (b.enteredAt || '').localeCompare(a.enteredAt || ''); });
    return merged;
  }

  // ── getAll — YEREL + UZAK (worker/GitHub) birleşik, yeniden eskiye ────
  // _cache'i de günceller (getByEczane senkron erişimi bu yüzden hep
  // güncel/birleşik veriyi yansıtır).
  function getAll() {
    return Promise.all([_getLocalAll(), fetchTeamObservations()]).then(function (res) {
      var merged = _mergeObservations(res[0], res[1]);
      _cache = merged;
      return merged.slice();
    });
  }

  // ── getByEczane — SENKRON (cache'ten, YEREL+UZAK birleşik) ────────
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

  // ── deleteObservation — SADECE yerel (bkz. dosya başı SINIRLAMA notu) ──
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

  // ── refresh — cache'i YEREL+UZAK birleşik veriyle yenile ────────────
  function refresh() { return getAll(); }

  // Sayfa yüklenince cache'i doldur (YEREL+UZAK birleşik)
  refresh().catch(function () {});

  window.SahaGozlemStore = {
    saveObservation:      saveObservation,
    getAll:                getAll,
    getByEczane:           getByEczane,
    getByTTT:              getByTTT,
    getByKategori:         getByKategori,
    deleteObservation:     deleteObservation,
    fetchTeamObservations: fetchTeamObservations,
    refresh:               refresh,
    version:               '17.0'
  };

  console.debug('[saha-gozlem-store] FAZ 17.0 yüklendi (worker senkron: ' + (window.GOZLEM_SYNC_WORKER_URL ? 'aktif' : 'pasif') + ').');

})();
