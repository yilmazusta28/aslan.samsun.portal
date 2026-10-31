// ══════════════════════════════════════════════════════════════
//  js/data/ek-prim-loader.js — Ek Prim tablosu (Prim Hesapla sayfası)
//  Kaynak CSV: ./EK_PRIM.csv (A:E) + ./EK_PRIM_FAMTREC.csv (G:L) — YENI IMS .xlsm içindeki
//  "EK-PRIM" sayfasındaki iki tablonun haftalık otomasyonla (ims_transform.py → FINAL_EXPORTS) üretilen çıktısı.
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

  // Her kaynak = EK-PRIM sayfasındaki bir tablo (A:E Griport Cold, G:L Famtrec). Eksik olan atlanır.
  var SOURCES = ['./EK_PRIM.csv', './EK_PRIM_FAMTREC.csv'];
  window.EK_PRIM = null;          // [ { baslik, kolonlar:[...], satirlar:[[...]] }, ... ]
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

  // ── Famtrec "Tekil Eczane Sayısı (Mevcut)": CSV değeri SOLUK gösterilir (salt görüntü) ──
  //  Kolon, başlık metninden bulunur (CSV başlıkları değişirse kod değişmez):
  //    1) "TEKİL" + "MEVCUT"  2) "ECZANE" + "MEVCUT"  3) başlığında "TEKİL" geçen tek kolon.
  function fadedCol(d) {
    if (key(d.baslik).indexOf('FAMTREC') < 0) return -1;
    var ks = d.kolonlar.map(key), i, one = -1, n = 0;
    for (i = 1; i < ks.length; i++) if (ks[i].indexOf('TEKIL') >= 0 && ks[i].indexOf('MEVCUT') >= 0) return i;
    for (i = 1; i < ks.length; i++) if (ks[i].indexOf('ECZANE') >= 0 && ks[i].indexOf('MEVCUT') >= 0) return i;
    for (i = 1; i < ks.length; i++) if (ks[i].indexOf('TEKIL') >= 0) { one = i; n++; }
    return n === 1 ? one : -1;
  }
  // Önceki sürümde eklenen elle giriş kaldırıldı; kalan kayıtları temizle
  try { localStorage.removeItem('pv_ekprim_manuel_v1'); } catch (e) { /* sessiz */ }

  function tableHtml(d, only, sel) {
    var rows = d.satirlar.filter(function (r) { return !only || key(r[0]) === only; });
    var last = d.kolonlar.length - 1;
    var th = d.kolonlar.map(function (c, i) {
      return '<th style="padding:6px 8px;text-align:' + (i ? 'right' : 'left') + ';font-size:10px;color:var(--dim);border-bottom:1px solid var(--border)">' + esc(c) + '</th>';
    }).join('');
    var total = 0;
    var mc = fadedCol(d);
    var tr = rows.map(function (r) {
      var hl = (!only && sel && key(r[0]) === sel) || !!only;
      total += num(r[last]);
      var pos = num(r[last]) > 0;
      return '<tr style="' + (hl ? 'background:#EEF6FF;font-weight:600' : '') + '">' + r.map(function (c, i) {
        var st = 'padding:5px 8px;font-size:11px;border-bottom:1px solid var(--border);text-align:' + (i ? 'right' : 'left');
        if (i === last) st += ';color:' + (pos ? '#15803D' : 'var(--dim)') + ';font-weight:700';
        c = String(c == null ? '' : c).replace(/^(-?\d+),00%$/, '$1%');   // 111,00% → 111%
        if (i === last && c && c !== '-') c += ' ₺';
        if (i === mc) {
          return '<td style="' + st + ';opacity:.45" title="CSV değeri">' + esc(c || '—') + '</td>';
        }
        return '<td style="' + st + '">' + esc(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var foot = only ? '' :
      '<tr><td colspan="' + last + '" style="padding:6px 8px;font-size:11px;font-weight:700">TOPLAM ' + esc(d.kolonlar[last]) + '</td>' +
      '<td style="padding:6px 8px;font-size:11px;font-weight:700;text-align:right">' +
      total.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' ₺</td></tr>';
    return '<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:700;margin-bottom:6px">' + esc(d.baslik) + '</div>' +
      (rows.length
        ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>' + th + '</tr></thead><tbody>' + tr + foot + '</tbody></table></div>'
        : '<div style="color:var(--dim);font-size:11px">Bu dönem için kaydınız bulunmuyor.</div>') +
      '</div>';
  }

  function render() {
    var body = document.getElementById('ekPrimBody');
    var card = document.getElementById('ekPrimCard');
    if (!body || !card) return;
    var list = window.EK_PRIM;
    if (!list || !list.length) {
      body.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:10px 0">Ek prim tablosu bulunamadı' +
        (window.EK_PRIM_LOAD_ERROR ? ' (' + esc(window.EK_PRIM_LOAD_ERROR) + ')' : '') + '.</div>';
      return;
    }
    var only = myKey();
    var sel = selectedKey();
    var badge = document.getElementById('ekPrimBadge');
    if (badge) badge.textContent = list.length + ' tablo';
    body.innerHTML = list.map(function (d) { return tableHtml(d, only, sel); }).join('');
  }

  function fetchOne(u, ts) {
    return fetch(u + '?v=' + ts, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(u + ' HTTP ' + r.status);
      return r.text();
    }).then(parse).catch(function (e) { return { _err: e && e.message || String(e) }; });
  }
  function load() {
    var ts = Date.now();
    return Promise.all(SOURCES.map(function (u) { return fetchOne(u, ts); })).then(function (res) {
      var ok = res.filter(function (d) { return !d._err; });
      var bad = res.filter(function (d) { return d._err; });
      window.EK_PRIM = ok.length ? ok : null;
      window.EK_PRIM_LOAD_ERROR = bad.length ? bad.map(function (d) { return d._err; }).join('; ') : null;
    }).catch(function (e) { window.EK_PRIM = null; window.EK_PRIM_LOAD_ERROR = e && e.message || String(e); })
      .then(function () {
        render();
        // Yönetici sayfasındaki Prim Takip bölümü de yeni veriyle yenilensin
        if (typeof window.renderPrimTakipPage === 'function') { try { window.renderPrimTakipPage(); } catch (e) { /* sessiz */ } }
      });
  }
  window.loadEkPrim = load;
  window.renderEkPrim = render;

  // Yönetici paneli (Prim Takip) için: yüklü Ek Prim tablolarının HTML'i. ttt boşsa tüm ekip + toplam,
  // doluysa yalnızca o temsilcinin satırı. Veri yoksa null döner. (js/ui/prim-takip-page.js kullanır)
  window.ekPrimTablesHtml = function (ttt) {
    var list = window.EK_PRIM;
    if (!list || !list.length) return null;
    var only = ttt ? key(ttt) : null;
    return list.map(function (d) { return tableHtml(d, only, ''); }).join('');
  };

  function init() {
    load();
    // Temsilci seçimi (kullanıcı ya da kod tarafından) değişince vurguyu yenile
    var last = null;
    setInterval(function () { if (document.hidden) return; var s = selectedKey(); if (s !== last) { last = s; render(); } }, 1500);
    document.addEventListener('change', function (e) { if (e.target && e.target.id === 'primTTT') render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
