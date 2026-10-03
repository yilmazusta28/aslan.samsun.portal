// ══════════════════════════════════════════════════════════════════════
//  js/ui/ttt-lock.js — Temsilci filtresi kilidi (yalnızca kendi verisi)
//
//  KURAL (kullanıcı isteği): YILMAZ USTA, ŞENOL YILMAZ ve admin (= ŞENOL YILMAZ girişi)
//  dışındaki TÜM temsilciler şu bölümlerde SADECE kendi verisini görür; temsilci
//  filtresi onlardan kaldırılır:
//    • Prim Hesapla (Prim Hesaplama Şablonu + Geçmiş Dönem Prim Hesabı)
//    • Performans › Pazar Analizi · Pazar Payı Analizi · Satış Takibi · MI & GI Takibi
//    • AI & Görev Motoru
//    • Eczane › Eczane Detay Listesi
//
//  NASIL: (1) bu sayfaların seçili-temsilci durum değişkenleri HER render/gezinme/seçim
//  öncesinde giriş yapan temsilciye zorlanır (filtre bir şekilde tetiklense de kendi verisi
//  gösterilir); (2) temsilci seçici kutular/çekmece grupları/✕ çipleri gizlenir.
//  Veri/hesap katmanına dokunmaz — sadece seçim durumu + DOM görünürlüğü.
//
//  ⚠ GÜVENLİK NOTU: Bu bir ARAYÜZ kısıtıdır. Site GitHub Pages'te statik olduğundan CSV'ler
//  ve giriş şifresi tarayıcıya iner; teknik bilgisi olan biri geliştirici araçlarıyla
//  aşabilir. Gerçek veri gizliliği için sunucu taraflı yetkilendirme gerekir.
//
//  Public API: isTttLocked(), applyTttLock()
//  Bağımlılık: window.LOGGED_IN_USER (index.html doLogin), role-visibility.js (çağıran)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window._TTT_LOCK_LOADED) return;
  window._TTT_LOCK_LOADED = true;

  // Tüm ekibi görebilen kullanıcılar (stripTR + büyük harf). 'admin' girişi zaten
  // USER_TO_TTT ile 'ŞENOL YILMAZ'a çevrildiği için ayrıca yazmaya gerek yok.
  var PRIVILEGED = ['SENOL YILMAZ', 'YILMAZ USTA'];

  function _s(x) {
    return String(x || '')
      .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
      .replace(/Ş/g, 'S').replace(/ş/g, 's').replace(/İ/g, 'I').replace(/ı/g, 'i')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c')
      .toUpperCase().trim();
  }
  function _me() { return window.LOGGED_IN_USER || ''; }
  function isTttLocked() {
    var u = _me();
    return !!u && PRIVILEGED.indexOf(_s(u)) < 0;
  }

  // ── 1) Durum zorlama ───────────────────────────────────────
  // Üst düzey `let` değişkenleri window'da DEĞİL ama başka klasik script'lerden çıplak adla
  // erişilebilir (bkz. index.html AUDIT6 notu). Henüz tanımlanmamışsa (TDZ) sessiz geç.
  function forceState() {
    if (!isTttLocked()) return;
    var me = _me();
    try { selTTT_p1 = me; } catch (e) {}
    try { selTTT_p2 = me; } catch (e) {}
    try { mg1_ttt = me; } catch (e) {}
    try { mg2_ttt = me; } catch (e) {}
    try { selMigiTTT = me; } catch (e) {}
    try { selAiTTT = me; } catch (e) {}
    try { engineSelTTT = me; } catch (e) {}
    try { selEczaneTTT = me; } catch (e) {}
  }

  function lockPrimSelect() {
    if (!isTttLocked()) return;
    var sel = document.getElementById('primTTT');
    if (!sel) return;
    var me = _me();
    // Boş "Seçin..." + yalnızca kendi adı (2 seçenek → buildPrimInputs yeniden doldurmaz)
    Array.prototype.slice.call(sel.options).forEach(function (o) { if (o.value !== '' && o.value !== me) sel.removeChild(o); });
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === me; })) {
      var opt = document.createElement('option'); opt.value = opt.textContent = me; sel.appendChild(opt);
    }
    if (sel.value !== me) sel.value = me;
    var box = sel.parentElement;                         // <div><label>Temsilci</label><select/></div>
    if (box && box.style.display !== 'none') box.style.display = 'none';
  }

  // ── 2) Arayüzden temsilci filtrelerini kaldır ────────────────
  var HIDE_CSS =
    'body.pv-ttt-locked #engineTttBar{display:none!important}' +
    'body.pv-ttt-locked #eczMfTtt{display:none!important}';
  function ensureCss() {
    if (document.getElementById('pvTttLockCss')) return;
    var st = document.createElement('style'); st.id = 'pvTttLockCss'; st.textContent = HIDE_CSS;
    document.head.appendChild(st);
  }
  var _isTemsilci = /^\s*Temsilci\s*$/i;
  function stripFilters() {
    if (!isTttLocked()) return;
    // Üst filtre çubuğundaki "Temsilci" seçici kutuları
    document.querySelectorAll('.mf-select').forEach(function (el) {
      var l = el.querySelector('.mf-label');
      if (l && _isTemsilci.test(l.textContent) && el.style.display !== 'none') el.style.display = 'none';
    });
    // "Temsilci Seç" düğmesi + çekmecelerdeki Temsilci grupları
    document.querySelectorAll('.mf-detail-btn').forEach(function (b) {
      if (/Temsilci/i.test(b.textContent) && b.style.display !== 'none') b.style.display = 'none';
    });
    document.querySelectorAll('.filter-drawer .drawer-group').forEach(function (g) {
      var lab = g.querySelector('label');
      if (lab && /Temsilci/i.test(lab.textContent) && g.style.display !== 'none') g.style.display = 'none';
    });
    // Çiplerdeki temsilciyi kaldıran ✕ (kendi adı çipi görünür kalır)
    document.querySelectorAll('.filter-chip-tag .fct-x').forEach(function (x) {
      var chip = x.parentElement;
      if (chip && /👤/.test(chip.textContent) && x.style.display !== 'none') x.style.display = 'none';
    });
    lockPrimSelect();
  }
  var _raf = 0;
  function scheduleStrip() {
    if (_raf) return;
    _raf = (window.requestAnimationFrame || setTimeout)(function () { _raf = 0; stripFilters(); });
  }

  // ── 3) Fonksiyon sarmalayıcıları ─────────────────────────────
  function wrap(name, impl) {
    var f = window[name];
    if (typeof f !== 'function' || f.__tttLock) return;
    var g = function () {
      if (isTttLocked()) { forceState(); lockPrimSelect(); }   // prim seçicisi de her çağrıdan ÖNCE kendi adına çekilir
      var args = impl && isTttLocked() ? impl(arguments) : arguments;
      var r = f.apply(this, args);
      if (isTttLocked()) { forceState(); scheduleStrip(); }
      return r;
    };
    g.__tttLock = true;
    window[name] = g;
  }

  var _wrapped = false;
  function installWrappers() {
    if (_wrapped) return;
    _wrapped = true;
    // Gezinme + render/build giriş noktaları (durum her zaman kendi adına zorlanır)
    ['goPage', 'goPageSub', 'goPerfSubTab', 'goEczaneSubTab', 'goAyarSubTab',
     'buildPazarSlicers', 'renderPazarCharts', 'buildTTT2Slicer',
     'initMigi1', 'initMigi2', 'buildMigiFilters',
     'renderAiAsistan', 'renderEngine',
     'buildEczaneFilters', 'renderEczaneContent',
     'buildPrimInputs', 'calcPrim', 'renderPrimGecmis'
    ].forEach(function (n) { wrap(n); });
    // Seçim yapan fonksiyonlar: hedef temsilci argümanı kendi adına çevrilir
    var me = function () { return _me(); };
    wrap('setP1', function (a) { var r = Array.prototype.slice.call(a); if (r[0] === 0) r[1] = me(); return r; });
    wrap('setP2', function (a) { return [me()]; });
    wrap('setAiTTT', function (a) { return [me()]; });
  }

  function applyTttLock() {
    ensureCss();
    var locked = isTttLocked();
    if (document.body) document.body.classList.toggle('pv-ttt-locked', locked);
    if (!locked) return;
    installWrappers();
    forceState();
    stripFilters();
    if (!window._tttLockObserver && typeof MutationObserver === 'function' && document.body) {
      // Filtre çubukları/çekmeceler innerHTML ile yeniden çiziliyor → her çizimden sonra tekrar gizle.
      // Yalnız childList izlenir (kendi stil değişikliklerimiz döngü yaratmaz).
      window._tttLockObserver = new MutationObserver(scheduleStrip);
      window._tttLockObserver.observe(document.body, { childList: true, subtree: true });
    }
    // Ekranda zaten açık olan sayfaları kendi verisiyle yeniden çiz
    ['buildPazarSlicers', 'buildTTT2Slicer', 'initMigi1', 'initMigi2', 'buildEczaneFilters'].forEach(function (n) {
      try { if (typeof window[n] === 'function') window[n](); } catch (e) { /* veri henüz yüklenmemiş olabilir */ }
    });
  }

  window.isTttLocked = isTttLocked;
  window.applyTttLock = applyTttLock;
})();
