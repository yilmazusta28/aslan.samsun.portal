// ══════════════════════════════════════════════════════════════
//  js/core/runtime-patches.js — Phase 2.2 UI Runtime Stabilization
//  Rollback-safe: bu dosyayı kaldırmak yeterli
//  Bağımlılık: js/data/data-state.js (isDataReady)
//              js/core/async-guard.js
//  Yükleme sırası: async-guard → constants → ... → runtime-patches
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── 1. Render Cycle Token ────────────────────────────────────
// Her goPage() çağrısında artar.
// Async render'lar bu token'ı yakalar; sayfa geçişinde stale render discard edilir.
var _renderCycle = 0;

function _newRenderCycle() {
  _renderCycle = (_renderCycle + 1) % 10000;
  return _renderCycle;
}

// ── 2. setTimeout Leak Koruması ──────────────────────────────
// _pendingTimers, _safeTimeout, _cancelPendingTimers → js/core/async-guard.js'de tanımlı
// (syncData çağrı zinciri DOMContentLoaded'dan önce tetiklenebilir)

// ── 3. Render Guard ──────────────────────────────────────────
// render* fonksiyonları çağrılmadan önce veri hazır mı kontrol eder.
// Kullanım: if (!_renderGuard('renderPazar')) return;
function _renderGuard(fnName) {
  if (typeof isDataReady === 'function' && !isDataReady()) {
    console.warn('[renderGuard] ' + fnName + ': veri henüz hazır değil, render iptal');
    return false;
  }
  return true;
}

// ── 4. Bind-Once Yardımcısı ──────────────────────────────────
// Aynı element'e aynı event'i birden fazla bind etmeyi önler.
// Element üzerinde _boundEvents map'i tutar.
function _bindOnce(element, event, handler) {
  if (!element) return;
  if (!element._boundEvents) element._boundEvents = {};
  if (element._boundEvents[event]) {
    element.removeEventListener(event, element._boundEvents[event]);
  }
  element._boundEvents[event] = handler;
  element.addEventListener(event, handler);
}

// ── 5. Drawer Cleanup ────────────────────────────────────────
// goPage() geçişinde açık drawer'ı temizler.
function _cleanupDrawers() {
  if (typeof closeMfDrawer === 'function') {
    try { closeMfDrawer(); } catch(e) {}
  }
  // overlay zorla kapat
  var ov = document.getElementById('mfOverlay');
  if (ov) ov.classList.remove('show');
  // _activeMfDrawer sıfırla (data-state değişkeni)
  if (typeof _activeMfDrawer !== 'undefined') {
    try {
      var drawers = document.querySelectorAll('.mf-drawer, .drawer, [id$="Drawer"]');
      drawers.forEach(function(d) { d.classList.remove('open'); });
    } catch(e) {}
  }
}

// ── 6. Orphan DOM Cleanup ────────────────────────────────────
// Dinamik eklenen geçici DOM node'larını temizler.
function _cleanupOrphanNodes() {
  // AI loading bubble'ları (render tamamlanmadan sayfa değiştirildiyse)
  document.querySelectorAll('[id^="ai_loading_"], [id^="eng_ai_"]').forEach(function(el) {
    el.remove();
  });
  // Detached tooltip/popup'lar
  document.querySelectorAll('.temp-tooltip, .temp-popup').forEach(function(el) {
    el.remove();
  });
}

// ── 7. Chart Stale Render Koruması ──────────────────────────
// setTimeout içindeki mkChart çağrıları sayfa değiştikten sonra çalışabilir.
// Bu wrapper: render cycle token kontrol ederek stale chart render'ı önler.
function _mkChartSafe(capturedCycle, id, type, data, opts) {
  if (_renderCycle !== capturedCycle) {
    console.debug('[chartSafe] Stale chart render iptal edildi: ' + id +
      ' (cycle: ' + capturedCycle + ' → ' + _renderCycle + ')');
    return;
  }
  if (typeof mkChart === 'function') mkChart(id, type, data, opts);
}

// ── 8. goPage Lifecycle Wrapper ──────────────────────────────
// Mevcut goPage()'i sarar; cleanup + guard'ları ekler.
// ÖNEMLI: DOMContentLoaded sonrası uygulanır, orijinal goPage korunur.
function _installGoPageGuard() {
  if (typeof goPage !== 'function') return;
  if (goPage._guarded) return; // tekrar kurulum önle

  var _originalGoPage = goPage;

  goPage = function(i) {
    // 1. Bekleyen timer'ları iptal et
    _cancelPendingTimers();
    // 2. Render cycle yenile (stale async render'ları discard etmek için)
    _newRenderCycle();
    // 3. Açık drawer'ları temizle
    _cleanupDrawers();
    // 4. Orphan node'ları temizle
    _cleanupOrphanNodes();
    // Phase 2.3.5 TASK 4: Modal + drawer tam temizlik
    if (typeof modalCleanupOrphans === 'function') {
      try { modalCleanupOrphans(); } catch(e) {}
    }
    if (typeof drawerCloseAll === 'function') {
      try { drawerCloseAll(); } catch(e) {}
    }
    // 5. Orijinal goPage'i çalıştır
    _originalGoPage(i);
  };

  goPage._guarded = true;
  console.debug('[runtime-patches] goPage lifecycle guard kuruldu');
}

// ── 9. Render Guard Patcher ──────────────────────────────────
// render* fonksiyonlarına isDataReady() guard ekler.
// Sadece guard YOK olan fonksiyonlara uygulanır.
function _patchRenderGuards() {
  var targets = [
    'renderPazar', 'renderTakip', 'renderEkipCharts',
    'renderTTTDetail', 'renderMigi1', 'renderMigi2',
    'renderGenelTablo', 'renderAnaInsight'
  ];

  targets.forEach(function(fnName) {
    if (typeof window[fnName] !== 'function') return;
    if (window[fnName]._guarded) return;

    var _orig = window[fnName];
    window[fnName] = function() {
      if (!_renderGuard(fnName)) return;
      return _orig.apply(this, arguments);
    };
    window[fnName]._guarded = true;
    console.debug('[runtime-patches] render guard eklendi: ' + fnName);
  });
}

// ── 10. Kurulum ──────────────────────────────────────────────
// DOMContentLoaded sonrası (tüm fonksiyonlar tanımlı olduktan sonra) çalıştır.
// Bu fonksiyon index.html DOMContentLoaded handler'ının EN SONUNDA çağrılmalı.
function installRuntimePatches() {
  _installGoPageGuard();
  _patchRenderGuards();
  console.info('[runtime-patches] Phase 2.2 stabilization patches aktif');
}
