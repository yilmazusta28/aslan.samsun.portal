// ══════════════════════════════════════════════════════════════
//  js/data/storage.js — Yerel Depolama Yardımcıları
//  Phase 3.0 extraction
//  Globals: loadProxyUrl(), saveProxyUrl()
//  Bağımlılık: localStorage (browser)
//  Yükleme sırası: bu dosya AI modüllerinden önce yüklenmeli
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════

// ── AI Proxy URL Depolama ────────────────────────────────────
// Proxy URL'sini localStorage'dan yükler, window.AI_PROXY_URL'e atar
function loadProxyUrl() {
  window.AI_PROXY_URL = _AI_DEFAULT_PROXY;
  try {
    var saved = sessionStorage.getItem('ai_proxy_url') || _AI_DEFAULT_PROXY;
    var inp = document.getElementById('proxyUrlInput');
    if (inp) inp.value = saved;
    window.AI_PROXY_URL = saved;
    _updateProxyStatus(saved);
  } catch(e) {
    _updateProxyStatus(_AI_DEFAULT_PROXY);
  }
}

// ── AI Proxy URL Kaydetme ────────────────────────────────────
// Kullanıcının girdiği proxy URL'sini localStorage'a kaydeder
function saveProxyUrl() {
  var val = document.getElementById('proxyUrlInput') &&
            document.getElementById('proxyUrlInput').value &&
            document.getElementById('proxyUrlInput').value.trim();
  if (val && val.startsWith('http')) {
    window.AI_PROXY_URL = val;
    try { sessionStorage.setItem('ai_proxy_url', val); } catch(e) {}
    _updateProxyStatus(val);
  }
}
