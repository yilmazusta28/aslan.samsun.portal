// ══════════════════════════════════════════════════════════════════════
//  js/core/security.js — Ortak güvenlik yardımcıları (XSS / URL / pencere açma)
//
//  Neden: uygulama innerHTML ile HTML üretiyor; temsilcilerin girdiği metinler (kayıt
//  alanları, ad, not…) worker üzerinden Bölge Müdürü'nün tarayıcısına geliyor. Ham basılırsa
//  saklı XSS olur. Kullanıcı/uzak kaynaklı HER metin HTML'e pvEsc() ile basılmalıdır.
//
//  API (window):
//    pvEsc(s)       → HTML metni/özniteliği için kaçış (& < > " ')
//    pvJsArg(s)     → onclick="fn(' + pvJsArg(id) + ')" içinde güvenli JS string argümanı
//    pvSafeUrl(u)   → yalnız http(s)/mailto/göreli URL; aksi halde '' (javascript: vb. engellenir)
//    pvOpen(u)      → pvSafeUrl + 'noopener,noreferrer' ile yeni sekme
//  GitHub Pages compatible: classic script, no ES modules. Başka dosyaya bağımlılığı yoktur.
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.pvEsc) return;

  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function pvEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  }
  // Öznitelik içindeki JS argümanı: önce JS string'e çevir (tırnak/ters bölü kaçışlı), sonra HTML kaçışla
  function pvJsArg(s) { return pvEsc(JSON.stringify(String(s == null ? '' : s))); }

  function pvSafeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^(https?:|mailto:)/i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';      // javascript:, data:, vbscript: … → engelle
    return s;                                            // göreli URL
  }
  function pvOpen(u) {
    var s = pvSafeUrl(u);
    if (!s) { console.warn('[security] Güvensiz URL engellendi'); return null; }
    return window.open(s, '_blank', 'noopener,noreferrer');
  }

  window.pvEsc = pvEsc;
  window.pvJsArg = pvJsArg;
  window.pvSafeUrl = pvSafeUrl;
  window.pvOpen = pvOpen;
})();
