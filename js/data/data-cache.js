// ══════════════════════════════════════════════════════════════
//  js/data/data-cache.js — Veri Önbellek Katmanı
//  Phase 2.3.5 TASK 2
//
//  Sorumluluk:
//    • Uygulama verilerini localStorage'a kaydet / yükle
//    • 24 saatlik cache süresi — süresi dolmuşsa fresh fetch
//    • Veri bütünlüğü için JSON parse hatalarına karşı güvenli fallback
//    • Davranış değişikliği yok — sadece veri katmanı hızlandırma
//
//  Cache'lenen veriler:
//    IMS, GENEL, KUTU, MIGI_TL_RAW, MIGI_KUTU_RAW,
//    MIGI_BRICK_TL_RAW, MIGI_BRICK_KUTU_RAW
//
//  Bağımlılık: js/data/data-state.js (global array'ler)
//  Yükleme sırası: data-state.js SONRASI, data-loader.js ÖNCESI
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var CACHE_KEY     = 'samsun2d_data_cache';
  var CACHE_VERSION = 1;
  var CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 saat

  // ── saveDataCache ──────────────────────────────────────────
  // Mevcut global veri state'ini localStorage'a yazar.
  // Hata oluşursa sessizce devam eder (veri bütünlüğü riski yok).
  function saveDataCache() {
    try {
      var payload = {
        version:   CACHE_VERSION,
        savedAt:   Date.now(),
        IMS:                  (typeof IMS               !== 'undefined') ? IMS               : [],
        GENEL:                (typeof GENEL             !== 'undefined') ? GENEL             : [],
        KUTU:                 (typeof KUTU              !== 'undefined') ? KUTU              : [],
        MIGI_TL_RAW:          (typeof MIGI_TL_RAW       !== 'undefined') ? MIGI_TL_RAW       : [],
        MIGI_KUTU_RAW:        (typeof MIGI_KUTU_RAW     !== 'undefined') ? MIGI_KUTU_RAW     : [],
        MIGI_BRICK_TL_RAW:    (typeof MIGI_BRICK_TL_RAW !== 'undefined') ? MIGI_BRICK_TL_RAW : [],
        MIGI_BRICK_KUTU_RAW:  (typeof MIGI_BRICK_KUTU_RAW !== 'undefined') ? MIGI_BRICK_KUTU_RAW : []
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      console.debug('[data-cache] Cache kaydedildi. IMS:', payload.IMS.length,
        'GENEL:', payload.GENEL.length);
    } catch (e) {
      // localStorage dolu veya erişim engeli — sessizce geç
      console.warn('[data-cache] saveDataCache hata:', e.message);
    }
  }

  // ── loadDataCache ──────────────────────────────────────────
  // localStorage'dan veri yükler. Cache geçerli ise global state'e atar.
  // Başarılı yükleme → true döner; cache yok / süresi dolmuş / hata → false.
  function loadDataCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;

      var payload = JSON.parse(raw);

      // Versiyon kontrolü
      if (payload.version !== CACHE_VERSION) {
        console.debug('[data-cache] Cache versiyonu uyumsuz, temizleniyor.');
        clearDataCache();
        return false;
      }

      // TTL kontrolü
      if (!isCacheValid(payload.savedAt)) {
        console.debug('[data-cache] Cache süresi dolmuş, temizleniyor.');
        clearDataCache();
        return false;
      }

      // Global state'e yükle (sadece dizi ise)
      if (Array.isArray(payload.IMS))               { IMS.length = 0;               payload.IMS.forEach(function(r){ IMS.push(r); }); }
      if (Array.isArray(payload.GENEL))             { GENEL.length = 0;             payload.GENEL.forEach(function(r){ GENEL.push(r); }); }
      if (Array.isArray(payload.KUTU))              { KUTU.length = 0;              payload.KUTU.forEach(function(r){ KUTU.push(r); }); }
      if (Array.isArray(payload.MIGI_TL_RAW))       { MIGI_TL_RAW.length = 0;       payload.MIGI_TL_RAW.forEach(function(r){ MIGI_TL_RAW.push(r); }); }
      if (Array.isArray(payload.MIGI_KUTU_RAW))     { MIGI_KUTU_RAW.length = 0;     payload.MIGI_KUTU_RAW.forEach(function(r){ MIGI_KUTU_RAW.push(r); }); }
      if (Array.isArray(payload.MIGI_BRICK_TL_RAW)) { MIGI_BRICK_TL_RAW.length = 0; payload.MIGI_BRICK_TL_RAW.forEach(function(r){ MIGI_BRICK_TL_RAW.push(r); }); }
      if (Array.isArray(payload.MIGI_BRICK_KUTU_RAW)) { MIGI_BRICK_KUTU_RAW.length = 0; payload.MIGI_BRICK_KUTU_RAW.forEach(function(r){ MIGI_BRICK_KUTU_RAW.push(r); }); }

      console.info('[data-cache] Cache yüklendi. IMS:', IMS.length,
        'GENEL:', GENEL.length,
        'Kaydedilme:', new Date(payload.savedAt).toLocaleTimeString('tr-TR'));
      return true;

    } catch (e) {
      console.warn('[data-cache] loadDataCache hata — fresh fetch gerekli:', e.message);
      // Bozuk cache'i temizle
      try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
      return false;
    }
  }

  // ── clearDataCache ─────────────────────────────────────────
  // localStorage'dan cache'i siler. Hata oluşursa sessizce geçer.
  function clearDataCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
      console.debug('[data-cache] Cache temizlendi.');
    } catch (e) {
      console.warn('[data-cache] clearDataCache hata:', e.message);
    }
  }

  // ── isCacheValid ───────────────────────────────────────────
  // savedAt timestamp'ına göre cache'in 24 saatlik TTL içinde
  // olup olmadığını kontrol eder.
  // @param {number} savedAt  — Unix ms timestamp
  // @returns {boolean}
  function isCacheValid(savedAt) {
    if (!savedAt || typeof savedAt !== 'number') return false;
    return (Date.now() - savedAt) < CACHE_TTL_MS;
  }

  // ── EXPORTS ────────────────────────────────────────────────
  window.saveDataCache   = saveDataCache;
  window.loadDataCache   = loadDataCache;
  window.clearDataCache  = clearDataCache;
  window.isCacheValid    = isCacheValid;

  console.debug('[data-cache] Phase 2.3.5 data cache katmanı yüklendi.');

})();
