// ══════════════════════════════════════════════════════════════════════
//  js/core/period-archive-manager.js — Dönemsel Veri Arşivleme Motoru
//
//  İŞ KURALI (kullanıcı tarafından bildirildi):
//    GENEL_TABLO.csv ve IMS_TABLO.csv, GitHub üzerinde her satış dönemi
//    bittiğinde kullanıcı tarafından SIFIRLANIR ve yeni dönemin verisiyle
//    doldurulur (sistem yükünü azaltmak için). Bu nedenle bir önceki
//    dönemin verisi, dönem değişiminde kaybolur.
//
//    Bu motor, her başarılı syncData() sonrasında o anki GENEL/IMS
//    verisini "son bilinen dönem görüntüsü" (last snapshot) olarak
//    localStorage'a kaydeder. Bir sonraki sync'te GÜNÜN TARİHİNDEN
//    hesaplanan dönem anahtarı (PERIODS.find), kaydedilmiş son görüntünün
//    dönem anahtarından FARKLIYSA, bu bir dönem geçişi anlamına gelir:
//    kaydedilmiş son görüntü (bir önceki dönemin FİNAL verisi) kalıcı
//    olarak yarıyıl arşivine taşınır.
//
//    Yarıyıl gruplaması (PERIODS.halfYear ile aynı, date-utils.js):
//      H1 = 1.Dönem + 2.Dönem + 1.Kompanzasyon   (Ocak – Haziran)
//      H2 = 4.Dönem + 5.Dönem + 2.Kompanzasyon   (Temmuz – Aralık)
//
//  ÖNEMLİ — Kapsam sınırı:
//    GENEL_TABLO.csv / IMS_TABLO.csv verisinin KENDİSİ hâlâ kullanıcı
//    tarafından dönemsel olarak GitHub'da değiştirilir (bu motor buna
//    müdahale ETMEZ, sadece giden veriyi arşivler — "GENEL ve IMS tablo
//    verileri kullanıcı dönemsel değiştirsin" kuralına birebir uyar).
//
//  Public API (window.PeriodArchiveManager):
//    processNewSync(newGenelArr, newIMSArr)  → sync sonrası çağrılır;
//                                               dönem geçişi varsa arşivler,
//                                               ardından yeni "son görüntü"yü kaydeder.
//    getCurrentPeriodKey(refDate?)           → PERIODS anahtarı ('1d'..'k2') | null
//    getArchivedPeriod(periodKey)            → {genel, ims, periodLabel, archivedAt} | null
//    getHalfYearArchive(halfYearKey)         → {periods:{...}} | {periods:{}}
//    listArchivedPeriods()                   → ['1d','2d',...] (arşivde ne varsa)
//    getSummary()                            → konsoldan hızlı kontrol için özet obje
//    clearAll()                              → TÜM arşivi ve son görüntüyü siler (geri alınamaz)
//
//  Depolama: localStorage
//    PV_PERIOD_ARCHIVE_H1_V1  → { periods: { '1d':{...}, '2d':{...}, 'k1':{...} } }
//    PV_PERIOD_ARCHIVE_H2_V1  → { periods: { '4d':{...}, '5d':{...}, 'k2':{...} } }
//    PV_PERIOD_LAST_SNAPSHOT_V1 → { periodKey, genel, ims, savedAt }
//
//  Bağımlılık: js/core/date-utils.js (PERIODS)
//  Yükleme sırası: date-utils.js SONRASI, js/data/data-loader.js ÖNCESİ
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._PERIOD_ARCHIVE_MANAGER_LOADED) {
    console.warn('[period-archive-manager] Zaten yüklü — atlandı');
    return;
  }
  window._PERIOD_ARCHIVE_MANAGER_LOADED = true;

  var LS_H1   = 'PV_PERIOD_ARCHIVE_H1_V1';
  var LS_H2   = 'PV_PERIOD_ARCHIVE_H2_V1';
  var LS_LAST = 'PV_PERIOD_LAST_SNAPSHOT_V1';

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  function _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // ── PERIODS'tan dönem anahtarı ve meta bilgisi bul ───────────────────
  function _findPeriod(dateStr) {
    var periods = _safe(function () { return PERIODS || []; }, []);
    for (var i = 0; i < periods.length; i++) {
      if (dateStr >= periods[i].start && dateStr <= periods[i].end) return periods[i];
    }
    return null;
  }

  function getCurrentPeriodKey(refDate) {
    var dateStr = refDate ? refDate : _todayStr();
    var p = _findPeriod(dateStr);
    return p ? p.key : null;
  }

  function _halfYearForKey(periodKey) {
    var periods = _safe(function () { return PERIODS || []; }, []);
    var p = periods.find(function (x) { return x.key === periodKey; });
    return p ? p.halfYear : null;
  }

  function _lsKeyForHalfYear(halfYearKey) {
    if (halfYearKey === 'H1') return LS_H1;
    if (halfYearKey === 'H2') return LS_H2;
    return null;
  }

  // ── localStorage okuma/yazma (hatalara toleranslı) ───────────────────
  function _readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed || fallback;
    } catch (e) {
      console.warn('[period-archive-manager] okuma hatası (' + key + '):', e.message);
      return fallback;
    }
  }

  function _writeJSON(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
      return true;
    } catch (e) {
      // Kota dolu (QuotaExceededError) veya localStorage kapalı — sessizce geç,
      // canlı uygulama akışını BOZMAZ.
      console.warn('[period-archive-manager] yazma hatası (' + key + '):', e.message);
      return false;
    }
  }

  // ── Son görüntüyü (last snapshot) al/kaydet ──────────────────────────
  function _getLastSnapshot() {
    return _readJSON(LS_LAST, null);
  }

  function _saveLastSnapshot(periodKey, genelArr, imsArr) {
    _writeJSON(LS_LAST, {
      periodKey: periodKey,
      genel: genelArr,
      ims: imsArr,
      savedAt: new Date().toISOString()
    });
  }

  // ── Bir dönemi kalıcı yarıyıl arşivine taşı ──────────────────────────
  function _archivePeriod(periodKey, genelArr, imsArr) {
    var halfYear = _halfYearForKey(periodKey);
    var lsKey = _lsKeyForHalfYear(halfYear);
    if (!lsKey) {
      console.warn('[period-archive-manager] halfYear bulunamadı, arşivlenemedi:', periodKey);
      return false;
    }
    var periods = _safe(function () { return PERIODS || []; }, []);
    var meta = periods.find(function (x) { return x.key === periodKey; }) || {};

    var bucket = _readJSON(lsKey, { periods: {} });
    if (!bucket.periods) bucket.periods = {};

    bucket.periods[periodKey] = {
      genel: genelArr,
      ims: imsArr,
      periodLabel: meta.label || periodKey,
      periodMonths: meta.months || '',
      archivedAt: new Date().toISOString(),
      genelCount: (genelArr || []).length,
      imsCount: (imsArr || []).length
    };

    var ok = _writeJSON(lsKey, bucket);
    if (ok) {
      console.log('[period-archive-manager] Arşivlendi →', halfYear + '/' + periodKey,
        '(GENEL:', (genelArr || []).length, ', IMS:', (imsArr || []).length, ')');
    }
    return ok;
  }

  // ── Ana giriş noktası — her başarılı syncData() sonrasında çağrılır ──
  function processNewSync(newGenelArr, newIMSArr) {
    // Boş/başarısız veri arşivi bozmasın
    if (!newGenelArr || !newIMSArr || newGenelArr.length === 0 || newIMSArr.length === 0) {
      return { archived: false, reason: 'empty-data' };
    }

    var currentPeriodKey = getCurrentPeriodKey();
    if (!currentPeriodKey) {
      // Bugünün tarihi PERIODS aralıklarından hiçbirine düşmüyor (yıl dışı vb.)
      return { archived: false, reason: 'no-period-match' };
    }

    var last = _getLastSnapshot();
    var archived = false;

    if (last && last.periodKey && last.periodKey !== currentPeriodKey) {
      // Dönem değişmiş: bir önceki dönemin SON bilinen (final) verisini arşivle
      archived = _archivePeriod(last.periodKey, last.genel, last.ims);
    }

    // Şimdiki veriyi "son görüntü" olarak güncelle (bir sonraki geçiş kontrolü için)
    _saveLastSnapshot(currentPeriodKey, newGenelArr, newIMSArr);

    return { archived: archived, currentPeriodKey: currentPeriodKey, previousPeriodKey: last ? last.periodKey : null };
  }

  // ── Arşiv okuma yardımcıları ──────────────────────────────────────────
  function getArchivedPeriod(periodKey) {
    var halfYear = _halfYearForKey(periodKey);
    var lsKey = _lsKeyForHalfYear(halfYear);
    if (!lsKey) return null;
    var bucket = _readJSON(lsKey, { periods: {} });
    return (bucket.periods && bucket.periods[periodKey]) || null;
  }

  function getHalfYearArchive(halfYearKey) {
    var lsKey = _lsKeyForHalfYear(halfYearKey);
    if (!lsKey) return { periods: {} };
    return _readJSON(lsKey, { periods: {} });
  }

  function listArchivedPeriods() {
    var h1 = _readJSON(LS_H1, { periods: {} });
    var h2 = _readJSON(LS_H2, { periods: {} });
    return Object.keys(h1.periods || {}).concat(Object.keys(h2.periods || {}));
  }

  function getSummary() {
    var h1 = _readJSON(LS_H1, { periods: {} });
    var h2 = _readJSON(LS_H2, { periods: {} });
    var last = _getLastSnapshot();
    function _brief(bucket) {
      var out = {};
      Object.keys(bucket.periods || {}).forEach(function (k) {
        var p = bucket.periods[k];
        out[k] = { label: p.periodLabel, genelCount: p.genelCount, imsCount: p.imsCount, archivedAt: p.archivedAt };
      });
      return out;
    }
    return {
      H1: _brief(h1),
      H2: _brief(h2),
      lastSnapshot: last ? {
        periodKey: last.periodKey,
        genelCount: (last.genel || []).length,
        imsCount: (last.ims || []).length,
        savedAt: last.savedAt
      } : null
    };
  }

  function clearAll() {
    try {
      localStorage.removeItem(LS_H1);
      localStorage.removeItem(LS_H2);
      localStorage.removeItem(LS_LAST);
      console.log('[period-archive-manager] Tüm arşiv ve son görüntü silindi.');
      return true;
    } catch (e) {
      console.warn('[period-archive-manager] clearAll hatası:', e.message);
      return false;
    }
  }

  window.PeriodArchiveManager = {
    processNewSync: processNewSync,
    getCurrentPeriodKey: getCurrentPeriodKey,
    getArchivedPeriod: getArchivedPeriod,
    getHalfYearArchive: getHalfYearArchive,
    listArchivedPeriods: listArchivedPeriods,
    getSummary: getSummary,
    clearAll: clearAll
  };
})();
