// ══════════════════════════════════════════════════════════════════════
//  js/ai/core/period-archive-adapter.js
//  FAZ — Arşiv → AI Motor Bağlantısı
//
//  Sorumluluk:
//    js/core/period-archive-manager.js içinde localStorage'da biriken
//    "6 aylık arşiv" (H1/H2, dönem bazlı final GENEL/IMS anlık görüntüsü)
//    ham verisini, AI motorlarının (insight-engine, runrate-engine,
//    decision-engine) doğrudan tüketebileceği normalize edilmiş, TTT
//    bazlı, dönem-sırasına göre sıralı bir formata çevirir.
//
//    ims-adapter.js'in IMS ham verisi için yaptığını, bu adapter arşiv
//    verisi için yapar — motorlar PeriodArchiveManager'ın localStorage
//    şemasını BİLMEZ, sadece bu adapter'ın normalize çıktısını okur.
//
//  ⚠️ BİLİNEN SINIRLAMA: PERIODS (date-utils.js) ve dolayısıyla arşiv
//    anahtarları ('1d','2d','k1','4d','5d','k2') YIL BİLGİSİ TAŞIMAZ —
//    tıpkı PERIODS'un kendisi gibi. Uygulama çok yıllı kullanılırsa
//    (örn. 2027'ye geçildiğinde) aynı anahtarlar üzerine yazılabilir.
//    Bu, mevcut PERIODS tasarımının bir devamıdır, bu adapter'ın YENİ
//    bir kısıtı değildir — PERIODS yıl-farkında hale getirilirse bu
//    adapter otomatik olarak düzelir (sadece localStorage şema versiyonu
//    güncellenmesi gerekir).
//
//  Public API (window.PeriodArchiveAdapter):
//    getPreviousArchivedPeriod(ttt) → {
//      periodKey, label, months, halfYear,
//      genelTotal: {satis_tl, hedef_tl, tl_pct} | null,
//      genelRows:  [{urun, satis_tl, hedef_tl, tl_pct}, ...],
//      archivedAt
//    } | null   — TTT için, aktif dönemden bir önceki arşivlenmiş dönem
//
//    getHalfYearSeries(ttt) → [
//      { periodKey, label, tl_pct, satis_tl, hedef_tl }, ...
//    ]  — kronolojik sırayla, TTT'nin arşivdeki TÜM dönemleri (trend için)
//
//    getSummaryForTTT(ttt) → {
//      previousPeriod: (yukarıdaki gibi) | null,
//      trendSeries: (yukarıdaki gibi) []
//    }  — insight/decision motorlarının TEK ÇAĞRIYLA alacağı özet
//
//  Bağımlılık: js/core/period-archive-manager.js, js/core/date-utils.js (PERIODS)
//  Yükleme sırası: period-archive-manager.js SONRASI, AI motorlarından ÖNCE
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
/* global PERIODS */

(function () {
  'use strict';

  if (window._PERIOD_ARCHIVE_ADAPTER_LOADED) {
    console.warn('[period-archive-adapter] Zaten yüklü — atlandı');
    return;
  }
  window._PERIOD_ARCHIVE_ADAPTER_LOADED = true;

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ── PERIODS sırasına göre "bir önceki dönem anahtarı"nı bul ──────────
  function _previousPeriodKey(currentKey) {
    var periods = _safe(function () { return PERIODS || []; }, []);
    var idx = periods.findIndex(function (p) { return p.key === currentKey; });
    if (idx <= 0) return null; // ilk dönem (1d) veya bulunamadı → önceki yok
    return periods[idx - 1].key;
  }

  // ── Arşivlenmiş bir dönemin ham kaydını TTT'ye göre normalize et ─────
  function _normalizeArchivedPeriod(periodKey, rawArchived) {
    if (!rawArchived) return null;
    return {
      periodKey:    periodKey,
      label:        rawArchived.periodLabel || periodKey,
      months:       rawArchived.periodMonths || '',
      archivedAt:   rawArchived.archivedAt || null,
      _genel:       rawArchived.genel || []
    };
  }

  function _filterForTTT(normalized, ttt) {
    if (!normalized || !ttt) return null;
    var genelRows = normalized._genel.filter(function (r) { return r.ttt === ttt && r.urun !== 'GENEL TOPLAM'; });
    var genelTotalRaw = normalized._genel.find(function (r) { return r.ttt === ttt && r.urun === 'GENEL TOPLAM'; });

    return {
      periodKey:  normalized.periodKey,
      label:      normalized.label,
      months:     normalized.months,
      halfYear:   _safe(function () {
        return (PERIODS.find(function (p) { return p.key === normalized.periodKey; }) || {}).halfYear;
      }, null),
      archivedAt: normalized.archivedAt,
      genelTotal: genelTotalRaw ? {
        satis_tl: genelTotalRaw.satis_tl || 0,
        hedef_tl: genelTotalRaw.hedef_tl || 0,
        tl_pct:   genelTotalRaw.tl_pct || 0
      } : null,
      genelRows: genelRows.map(function (r) {
        return { urun: r.urun, satis_tl: r.satis_tl || 0, hedef_tl: r.hedef_tl || 0, tl_pct: r.tl_pct || 0 };
      })
    };
  }

  // ── getPreviousArchivedPeriod ─────────────────────────────────────
  function getPreviousArchivedPeriod(ttt) {
    if (!ttt || !window.PeriodArchiveManager) return null;
    return _safe(function () {
      var currentKey = window.PeriodArchiveManager.getCurrentPeriodKey();
      if (!currentKey) return null;
      var prevKey = _previousPeriodKey(currentKey);
      if (!prevKey) return null;
      var raw = window.PeriodArchiveManager.getArchivedPeriod(prevKey);
      if (!raw) return null;
      var normalized = _normalizeArchivedPeriod(prevKey, raw);
      var filtered = _filterForTTT(normalized, ttt);
      // TTT'nin o arşivlenmiş dönemde hiç kaydı yoksa (örn. yeni işe
      // başlayan temsilci) — sözleşme gereği null dön, boş nesne değil.
      if (!filtered || !filtered.genelTotal) return null;
      return filtered;
    }, null);
  }

  // ── getHalfYearSeries ─────────────────────────────────────────────
  // Arşivde bulunan TÜM dönemleri (hangi yarıyıla ait olursa olsun),
  // PERIODS sırasına göre kronolojik dizip TTT için trend serisi üretir.
  function getHalfYearSeries(ttt) {
    if (!ttt || !window.PeriodArchiveManager) return [];
    return _safe(function () {
      var periods = PERIODS || [];
      var archivedKeys = window.PeriodArchiveManager.listArchivedPeriods();
      var series = [];
      periods.forEach(function (p) {
        if (archivedKeys.indexOf(p.key) === -1) return;
        var raw = window.PeriodArchiveManager.getArchivedPeriod(p.key);
        var normalized = _normalizeArchivedPeriod(p.key, raw);
        var filtered = _filterForTTT(normalized, ttt);
        if (filtered && filtered.genelTotal) {
          series.push({
            periodKey: filtered.periodKey,
            label:     filtered.label,
            tl_pct:    filtered.genelTotal.tl_pct,
            satis_tl:  filtered.genelTotal.satis_tl,
            hedef_tl:  filtered.genelTotal.hedef_tl
          });
        }
      });
      return series;
    }, []);
  }

  // ── getSummaryForTTT ───────────────────────────────────────────────
  function getSummaryForTTT(ttt) {
    return {
      previousPeriod: getPreviousArchivedPeriod(ttt),
      trendSeries:    getHalfYearSeries(ttt)
    };
  }

  window.PeriodArchiveAdapter = {
    getPreviousArchivedPeriod: getPreviousArchivedPeriod,
    getHalfYearSeries:         getHalfYearSeries,
    getSummaryForTTT:          getSummaryForTTT
  };

  console.debug('[period-archive-adapter] yüklendi.');

})();
