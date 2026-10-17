// ══════════════════════════════════════════════════════════════
//  js/data/ek-prim-loader.js — Ek Prim tablosu (Prim Hesapla sayfası)
//  Kaynak CSV: ./EK_PRIM.csv (repo kökü) — YENI IMS .xlsm içindeki "EK-PRIM"
//  sayfasının haftalık otomasyonla (ims_transform.py → FINAL_EXPORTS) üretilen çıktısı.
//
//  CSV YAPISI (';' ayraçlı, Türkçe sayı biçimi — Excel'in kendi CSV çıktısı gibi):
//    Satır 1 : kampanya başlığı   (örn. GRİPORT COLD EK PRİM)
//    Satır 2 : kolon başlıkları   (TTT; EYLÜL SATIŞ; EKİM SATIŞ; BÜYÜME %; EK PRİM)
//    Satır 3+: temsilci başına 1 satır
//  Kolon başlıkları (ay adları dahil) CSV'den okunur; ay/ürün değişince kod değişmez.
//
//  Gizlilik: ttt-lock.js kuralı geçerli — kilitli (yönetici/YILMAZ USTA dışı) kullanıcı
//  yalnızca KENDİ satırını görür, toplam gösterilmez.
//
//  Bağımlılık: yok (isTttLocked / LOGGED_IN_USER varsa kullanır)
//  GitHub Pages compatible: classic script, no ES modules
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window._EK_PRIM_LOADED) return;
  window._EK_PRIM_LOADED = true;

  var URLS = ['./EK_PRIM.csv', './EK-PRIM.csv'];
  window.EK_PRIM = null;          // { baslik, kolonlar:[...], satirlar:[[...]] }
  window.EK_PRIM_LOAD_ERROR = null;

  function key(s) {
    return String(s == null ? '' : s)
      .replace(/İ/g, 'I').replace(/ı/g, 'I').toUpperCase()
      .replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U')
      .replace(/Ö/g, 'O').replace(/Ç/g, 'C').replace(/\s+/g, ' ').trim();
  }
  function num(v) {
    var s = String(v == null ? '' : v).replace('%', '').trim();
    if (!s || s === '-') return 0;
    var n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function parse(text) {
    var grid = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
      .filter(function (l) { return l.replace(/;/g, '').trim().length; })
      .map(function (l) { return l.split(';').map(function (s) { return s.trim(); }); });
    var hi = -1;
    for (var i = 0; i < grid.length; i++) { if (key(grid[i][0]) === 'TTT') { hi = i; break; } }
    if (hi < 0) throw new Error('Başlık satırı (TTT) bulunamadı');
    var kolonlar = grid[hi].filter(function (c, idx) { return c !== '' || idx === 0; });
    var satirlar = grid.slice(hi + 1).filter(function (r) { return r[0]; })
      .map(function (r) { return r.slice(0, kolonlar.length); });
    return { baslik: hi > 0 ? grid[0][0] : 'EK PRİM', kolonlar: kolonlar, satirlar: satirlar };
  }

  function myKey() {
    try { if (typeof isTttLocked === 'function' && isTttLocked()) return key(window.LOGGED_IN_USER || ''); } catch (e) {}
    return null;
  }
  function selectedKey() {
    var el = document.getElementById('primTTT');
    return el && el.value ? key(el.value) : '';
  }

  function render() {
    var body = document.getElementById('ekPrimBody');
    var card = document.getElementById('ekPrimCard');
    if (!body || !card) return;
    var d = window.EK_PRIM;
    if (!d) {
      body.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:10px 0">Ek prim tablosu bulunamadı' +
        (window.EK_PRIM_LOAD_ERROR ? ' (' + esc(window.EK_PRIM_LOAD_ERROR) + ')' : '') + '.</div>';
      return;
    }
    var only = myKey();
    var sel = selectedKey();
    var rows = d.satirlar.filter(function (r) { return !only || key(r[0]) === only; });
    var last = d.kolonlar.length - 1;
    var th = d.kolonlar.map(function (c, i) {
      return '<th style="padding:6px 8px;text-align:' + (i ? 'right' : 'left') + ';font-size:10px;color:var(--dim);border-bottom:1px solid var(--border)">' + esc(c) + '</th>';
    }).join('');
    var total = 0;
    var tr = rows.map(function (r) {
      var hl = (!only && sel && key(r[0]) === sel) || !!only;
      total += num(r[last]);
      var pos = num(r[last]) > 0;
      return '<tr style="' + (hl ? 'background:#EEF6FF;font-weight:600' : '') + '">' + r.map(function (c, i) {
        var st = 'padding:5px 8px;font-size:11px;border-bottom:1px solid var(--border);text-align:' + (i ? 'right' : 'left');
        if (i === last) st += ';color:' + (pos ? '#15803D' : 'var(--dim)') + ';font-weight:700';
        if (i === last && c && c !== '-') c += ' ₺';
        return '<td style="' + st + '">' + esc(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var foot = only ? '' :
      '<tr><td colspan="' + last + '" style="padding:6px 8px;font-size:11px;font-weight:700">TOPLAM EK PRİM</td>' +
      '<td style="padding:6px 8px;font-size:11px;font-weight:700;text-align:right">' +
      total.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' ₺</td></tr>';
    var badge = document.getElementById('ekPrimBadge');
    if (badge) badge.textContent = d.baslik;
    body.innerHTML = rows.length
      ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>' + th + '</tr></thead><tbody>' + tr + foot + '</tbody></table></div>'
      : '<div style="color:var(--dim);font-size:11px;padding:10px 0">Bu dönem için ek prim kaydınız bulunmuyor.</div>';
  }

  function load() {
    var ts = Date.now();
    var p = Promise.reject(new Error('başlatılmadı'));
    URLS.forEach(function (u) {
      p = p.catch(function () {
        return fetch(u + '?v=' + ts, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        });
      });
    });
    return p.then(function (t) { window.EK_PRIM = parse(t); window.EK_PRIM_LOAD_ERROR = null; })
      .catch(function (e) { window.EK_PRIM = null; window.EK_PRIM_LOAD_ERROR = e && e.message || String(e); })
      .then(render);
  }
  window.loadEkPrim = load;
  window.renderEkPrim = render;

  function init() {
    load();
    // Temsilci seçimi (kullanıcı ya da kod tarafından) değişince vurguyu yenile
    var last = null;
    setInterval(function () { var s = selectedKey(); if (s !== last) { last = s; render(); } }, 1500);
    document.addEventListener('change', function (e) { if (e.target && e.target.id === 'primTTT') render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
