// ══════════════════════════════════════════════════════════════
//  js/core/async-guard.js — Async Concurrency Guard Sabitleri
//  Phase 3.0 extraction
//  Globals: _aiInflight, _engineRunLock, _engineInflight
//  Yükleme sırası: bu dosya AI modüllerinden ÖNCE yüklenmeli
//  Böylece shim'ler modül tanımlarından önce var olur (var re-decl safe)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── AI Chat Concurrency Guard ────────────────────────────────
// Paralel chat isteği engeller — ai-service.js bu var'ı yönetir
var _aiInflight = false;

// ── Engine Run Lock ──────────────────────────────────────────
// runEngine() çift çağrı koruması — ai-engine.js yönetir
var _engineRunLock = false;

// ── Engine AI Analysis Guard ─────────────────────────────────
// engineAiAnalysis() paralel çağrı engeli — ai-engine.js yönetir
var _engineInflight = false;

// ── Guard Utility ────────────────────────────────────────────
// Merkezi guard reset (örn: sayfa geçişi sonrası)
function resetAllGuards() {
  _aiInflight    = false;
  _engineRunLock = false;
  _engineInflight = false;
}

// ── Timer Leak Koruması ──────────────────────────────────────
// _safeTimeout: data-loader.js'deki syncData'dan render fns çağrılmadan
// önce tanımlı olmalı. Bu yüzden async-guard.js'de tanımlandı (en erken yüklenen modül).
var _pendingTimers = [];

function _safeTimeout(fn, ms) {
  var id = setTimeout(function() {
    _pendingTimers = _pendingTimers.filter(function(t) { return t !== id; });
    fn();
  }, ms);
  _pendingTimers.push(id);
  return id;
}

function _cancelPendingTimers() {
  _pendingTimers.forEach(function(id) { clearTimeout(id); });
  _pendingTimers = [];
}
