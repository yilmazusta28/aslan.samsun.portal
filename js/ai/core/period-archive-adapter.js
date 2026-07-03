// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/period-archive-adapter.js
//  FAZ 12.6 — Dönemsel Arşiv Motoru
//
//  Sorumluluk:
//    • Kullanıcı yeni bir dönemin verilerini sisteme yüklediğinde (Ayarlar
//      sayfasından "Dönem Geçişi" yapıldığında), eski dönemin GENEL_TABLO
//      ve IMS_TABLO verilerini otomatik olarak 6 aylık iki yarı-yıl
//      arşivine yazar.
//
//    Yarı-yıl tanımları (kullanıcı onaylı):
//      YARI1 — 1.Dönem + 2.Dönem + 1.Kompanzasyon  (Ocak–Haziran)
//      YARI2 — 4.Dönem + 5.Dönem + 2.Kompanzasyon  (Temmuz–Aralık)
//
//    • GENEL_TABLO.csv ve IMS_TABLO.csv her dönem bitiminde "sıfırlanır"
//      (kullanıcı yeni CSV yükler); bu motor sıfırlamadan ÖNCE arşivler.
//    • AI motorları (digital-twin, insight, risk, opportunity vb.) bu
//      arşivi okuyarak geçmiş dönem verisine erişir — aktif tablolar
//      yalnızca cari dönem verisini içerir.
//    • Arşiv IndexedDB'ye (PharmaDB) yazılır; yoksa localStorage'a düşer.
//
//  Veri modeli:
//    periodArchive → { periodKey, periodLabel, yari, archivedAt,
//                      genelRows: [...], imsRows: [...] }
//    key → "archive_<yari>_<periodKey>"  (ör. "archive_yari1_1d")
//
//  IMS gecikme kuralı (iş kuralı §3):
//    Yeni bir dönem yüklendiğinde bir önceki dönemin son haftasının IMS
//    verisi sistemde ~1 hafta gecikmeli gelir. Arşivleme bu gecikmeyi
//    bilir; dönem arşivi oluşturulurken "imsLagNote" alanına not düşülür.
//
//  Public API:
//    archivePeriod(periodKey, genelRows, imsRows)  → Promise<true>
//    getArchive(periodKey)                         → Promise<{genelRows,imsRows,...}|null>
//    getAllArchives()                               → Promise<archive[]>
//    getYariArchive(yari)                          → Promise<archive[]>  ('yari1'|'yari2')
//    getMergedRows(yari, type)                     → Promise<row[]>  (type='genel'|'ims')
//    clearArchive(periodKey)                       → Promise<true>
//    clearAllArchives()                            → Promise<true>
//    getPeriodMeta(periodKey)                      → {label,yari,...}|null
//    version
//
//  Bağımlılık: js/core/date-utils.js (PERIODS — key/label/yari eşlemesi için)
//  Yükleme sırası: date-utils.js ve PharmaDB (PharmaCoreDB) SONRASI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._PERIOD_ARCHIVE_ADAPTER_LOADED) {
    console.warn('[period-archive-adapter] Zaten yüklü — atlandı.');
    return;
  }
  window._PERIOD_ARCHIVE_ADAPTER_LOADED = true;

  var VERSION = '1.0.0';
  var LS_PREFIX = 'pharma_period_archive_';

  // ── Yarı-yıl eşlemesi (kullanıcı iş kuralı) ──────────────────────────
  var YARI_MAP = {
    '1d':  'yari1',   // 1.Dönem       — Ocak–Şubat
    '2d':  'yari1',   // 2.Dönem       — Mart–Nisan
    'k1':  'yari1',   // 1.Kompanzasyon — Mayıs–Haziran
    '4d':  'yari2',   // 4.Dönem       — Temmuz–Ağustos
    '5d':  'yari2',   // 5.Dönem       — Eylül–Ekim
    'k2':  'yari2',   // 2.Kompanzasyon — Kasım–Aralık
  };

  var YARI_LABELS = {
    yari1: '1. Yarıyıl (Ocak – Haziran)',
    yari2: '2. Yarıyıl (Temmuz – Aralık)'
  };

  // ── Dönem meta verisi ─────────────────────────────────────────────────
  function getPeriodMeta(periodKey) {
    var periods = (typeof PERIODS !== 'undefined') ? PERIODS : [];
    var period  = null;
    for (var i = 0; i < periods.length; i++) {
      if (periods[i].key === periodKey) { period = periods[i]; break; }
    }
    if (!period) return null;
    var yari = YARI_MAP[periodKey] || null;
    return {
      key:        period.key,
      label:      period.label,
      months:     period.months,
      start:      period.start,
      end:        period.end,
      yari:       yari,
      yariLabel:  yari ? YARI_LABELS[yari] : null
    };
  }

  // ── Arşiv kayıt anahtarı ─────────────────────────────────────────────
  function _archiveKey(periodKey) {
    return 'archive_' + (YARI_MAP[periodKey] || 'unknown') + '_' + periodKey;
  }

  // ── localStorage yedek katmanı ────────────────────────────────────────
  function _lsKey(periodKey) { return LS_PREFIX + periodKey; }

  function _lsWrite(periodKey, record) {
    try {
      localStorage.setItem(_lsKey(periodKey), JSON.stringify(record));
      return true;
    } catch (e) {
      console.warn('[period-archive] localStorage yazma hatası:', e.message);
      return false;
    }
  }

  function _lsRead(periodKey) {
    try {
      var raw = localStorage.getItem(_lsKey(periodKey));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _lsReadAll() {
    var result = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) {
          try {
            var v = JSON.parse(localStorage.getItem(k));
            if (v) result.push(v);
          } catch (_) {}
        }
      }
    } catch (e) {}
    return result;
  }

  function _lsDelete(periodKey) {
    try { localStorage.removeItem(_lsKey(periodKey)); return true; }
    catch (e) { return false; }
  }

  function _lsClear() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
      return true;
    } catch (e) { return false; }
  }

  // ── IndexedDB katmanı (PharmaDB varsa) ───────────────────────────────
  var IDB_STORE = 'period_archives';

  function _idbWrite(periodKey, record) {
    if (!window.PharmaDB || typeof window.PharmaDB.withStore !== 'function') {
      return Promise.resolve(_lsWrite(periodKey, record));
    }
    return window.PharmaDB.withStore(IDB_STORE, 'readwrite', function (store) {
      if (!store) { _lsWrite(periodKey, record); return Promise.resolve(true); }
      return new Promise(function (resolve) {
        var req = store.put(record);
        req.onsuccess = function () { resolve(true); };
        req.onerror   = function () {
          console.warn('[period-archive] IDB yazma hatası, LS\'ye düşüldü.');
          _lsWrite(periodKey, record);
          resolve(true);
        };
      });
    }).catch(function () { _lsWrite(periodKey, record); return true; });
  }

  function _idbRead(periodKey) {
    var key = _archiveKey(periodKey);
    if (!window.PharmaDB || typeof window.PharmaDB.withStore !== 'function') {
      return Promise.resolve(_lsRead(periodKey));
    }
    return window.PharmaDB.withStore(IDB_STORE, 'readonly', function (store) {
      if (!store) return Promise.resolve(_lsRead(periodKey));
      return new Promise(function (resolve) {
        var req = store.get(key);
        req.onsuccess = function (e) { resolve(e.target.result || _lsRead(periodKey)); };
        req.onerror   = function () { resolve(_lsRead(periodKey)); };
      });
    }).catch(function () { return _lsRead(periodKey); });
  }

  function _idbReadAll() {
    if (!window.PharmaDB || typeof window.PharmaDB.withStore !== 'function') {
      return Promise.resolve(_lsReadAll());
    }
    return window.PharmaDB.withStore(IDB_STORE, 'readonly', function (store) {
      if (!store) return Promise.resolve(_lsReadAll());
      return new Promise(function (resolve) {
        var results = [];
        var req = store.openCursor();
        req.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else {
            // LS'deki ek kayıtları da ekle (IDB dışında kalmış olabilir)
            var lsAll = _lsReadAll();
            var idbKeys = results.map(function (r) { return r.archiveKey; });
            lsAll.forEach(function (r) {
              if (idbKeys.indexOf(r.archiveKey) === -1) results.push(r);
            });
            resolve(results);
          }
        };
        req.onerror = function () { resolve(_lsReadAll()); };
      });
    }).catch(function () { return _lsReadAll(); });
  }

  function _idbDelete(periodKey) {
    var key = _archiveKey(periodKey);
    _lsDelete(periodKey);
    if (!window.PharmaDB || typeof window.PharmaDB.withStore !== 'function') {
      return Promise.resolve(true);
    }
    return window.PharmaDB.withStore(IDB_STORE, 'readwrite', function (store) {
      if (!store) return Promise.resolve(true);
      return new Promise(function (resolve) {
        var req = store.delete(key);
        req.onsuccess = function () { resolve(true); };
        req.onerror   = function () { resolve(true); };
      });
    }).catch(function () { return true; });
  }

  // ── Ana API ───────────────────────────────────────────────────────────

  /**
   * archivePeriod(periodKey, genelRows, imsRows)
   *
   * Bir dönemin aktif verilerini arşive yazar. Tipik kullanım:
   *   → Kullanıcı "Yeni dönem yükle" dediğinde, yeni CSV parse edilmeden
   *     ÖNCE bu fonksiyon çağrılır; eski veriler arşivlenir.
   *
   * IMS gecikme notu: Dönem bitiminde son haftanın IMS verisi henüz
   * sisteme girmemiş olabilir (~1 hafta gecikmeli). Bu durum arşiv
   * kaydına "imsLagNote" olarak düşülür; AI motorları bunu okuyarak
   * son haftaya ait tüketim tahminlerini daha ihtiyatlı yapabilir.
   */
  function archivePeriod(periodKey, genelRows, imsRows) {
    var meta = getPeriodMeta(periodKey);
    if (!meta) {
      console.warn('[period-archive] Bilinmeyen dönem key\'i:', periodKey);
      return Promise.reject(new Error('Bilinmeyen dönem: ' + periodKey));
    }

    var archiveKey = _archiveKey(periodKey);

    // IMS gecikme tahmini: son haftanın verisi eksik olabilir
    var imsLagNote = null;
    if (imsRows && imsRows.length) {
      var lastH = 0;
      imsRows.forEach(function (r) {
        for (var n = 9; n >= 1; n--) {
          if (r['h' + n] && r['h' + n] !== 0) { if (n > lastH) lastH = n; break; }
        }
      });
      if (lastH > 0 && lastH < 9) {
        imsLagNote = 'Son dolu hafta: h' + lastH +
          '. h' + (lastH + 1) + ' verisi arşivleme sırasında henüz gelmemişti (~1 hafta gecikme).';
      }
    }

    var record = {
      archiveKey:    archiveKey,
      periodKey:     periodKey,
      periodLabel:   meta.label,
      periodMonths:  meta.months,
      yari:          meta.yari,
      yariLabel:     meta.yariLabel,
      archivedAt:    new Date().toISOString(),
      imsLagNote:    imsLagNote,
      genelRowCount: genelRows ? genelRows.length : 0,
      imsRowCount:   imsRows  ? imsRows.length   : 0,
      genelRows:     genelRows || [],
      imsRows:       imsRows  || []
    };

    console.log('[period-archive] Arşivleniyor:', periodKey, '(' + meta.label + ')',
      record.genelRowCount + ' genel satır,', record.imsRowCount + ' IMS satırı');

    return _idbWrite(periodKey, record).then(function () {
      // Bellek cache'ini güncelle
      _memCache[periodKey] = record;
      console.log('[period-archive] Arşivlendi ✓:', periodKey);
      return true;
    });
  }

  /**
   * getArchive(periodKey) → Promise<arşiv kaydı | null>
   */
  function getArchive(periodKey) {
    if (_memCache[periodKey]) return Promise.resolve(_memCache[periodKey]);
    return _idbRead(periodKey).then(function (rec) {
      if (rec) _memCache[periodKey] = rec;
      return rec;
    });
  }

  /**
   * getAllArchives() → Promise<arşiv[]> (tüm dönemler)
   */
  function getAllArchives() {
    return _idbReadAll().then(function (all) {
      all.forEach(function (r) { _memCache[r.periodKey] = r; });
      return all.sort(function (a, b) { return a.periodKey.localeCompare(b.periodKey); });
    });
  }

  /**
   * getYariArchive(yari) → Promise<arşiv[]>  ('yari1' | 'yari2')
   */
  function getYariArchive(yari) {
    return getAllArchives().then(function (all) {
      return all.filter(function (r) { return r.yari === yari; });
    });
  }

  /**
   * getMergedRows(yari, type) → Promise<row[]>
   * Belirli bir yarı-yılın TÜM dönemlerinin verilerini birleştirir.
   * type: 'genel' → genelRows,  'ims' → imsRows
   * AI motorları geçmiş 6 aylık analiz için bunu kullanır.
   */
  function getMergedRows(yari, type) {
    return getYariArchive(yari).then(function (archives) {
      var merged = [];
      // Dönem sırasını koru: 1d→2d→k1 veya 4d→5d→k2
      var ORDER = yari === 'yari1'
        ? ['1d', '2d', 'k1']
        : ['4d', '5d', 'k2'];
      ORDER.forEach(function (key) {
        var arc = archives.find(function (a) { return a.periodKey === key; });
        if (!arc) return;
        var rows = type === 'ims' ? arc.imsRows : arc.genelRows;
        if (rows && rows.length) {
          // Her satıra kaynak dönem bilgisi ekle (AI motorları için)
          rows.forEach(function (r) {
            merged.push(Object.assign({}, r, {
              _archivePeriodKey:   arc.periodKey,
              _archivePeriodLabel: arc.periodLabel,
              _archiveYari:        arc.yari
            }));
          });
        }
      });
      return merged;
    });
  }

  /**
   * clearArchive(periodKey) → Promise<true>
   */
  function clearArchive(periodKey) {
    delete _memCache[periodKey];
    return _idbDelete(periodKey).then(function () {
      console.log('[period-archive] Arşiv silindi:', periodKey);
      return true;
    });
  }

  /**
   * clearAllArchives() → Promise<true>
   */
  function clearAllArchives() {
    _memCache = {};
    _lsClear();
    if (!window.PharmaDB || typeof window.PharmaDB.withStore !== 'function') {
      return Promise.resolve(true);
    }
    return window.PharmaDB.withStore(IDB_STORE, 'readwrite', function (store) {
      if (!store) return Promise.resolve(true);
      return new Promise(function (resolve) {
        var req = store.clear();
        req.onsuccess = function () { resolve(true); };
        req.onerror   = function () { resolve(true); };
      });
    }).catch(function () { return true; });
  }

  // ── Bellek cache'i ────────────────────────────────────────────────────
  var _memCache = {};

  // Başlangıçta tüm arşivleri belleğe al (sessiz — AI motorları hazır olsun)
  setTimeout(function () {
    getAllArchives().then(function (all) {
      console.debug('[period-archive] Başlangıç cache:', all.length, 'arşiv yüklendi.');
    }).catch(function () {});
  }, 800);

  // ── EXPORTS ──────────────────────────────────────────────────────────
  window.PeriodArchiveAdapter = {
    archivePeriod:    archivePeriod,
    getArchive:       getArchive,
    getAllArchives:    getAllArchives,
    getYariArchive:   getYariArchive,
    getMergedRows:    getMergedRows,
    clearArchive:     clearArchive,
    clearAllArchives: clearAllArchives,
    getPeriodMeta:    getPeriodMeta,
    YARI_MAP:         YARI_MAP,
    YARI_LABELS:      YARI_LABELS,
    version:          VERSION
  };

  console.debug('[period-archive-adapter] FAZ 12.6 yüklendi. v' + VERSION);

})();
