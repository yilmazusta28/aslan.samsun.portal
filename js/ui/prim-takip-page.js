// ══════════════════════════════════════════════════════════════
//  PRİM TAKİP BÖLÜMÜ (page7 / #mgrPrimTakip) — SADECE Yönetici (Bölge Müdürü)
//
//  Kullanıcı isteği: Yönetici, temsilcilerin primlerini takip edebilsin.
//  Bölüm Yönetici sayfasının (page7) İÇİNDE, "Dönem Arşivi" kartından ÖNCE yer alır;
//  banner altındaki "💰 Prim Takip" pill'i bu bölüme (#mgr-sec-primtakip) kaydırır.
//
//  Hesap kuralları calcPrimForTTT / calcPrimForTTTForecast ile AYNI
//  (prim-calc.js): TL Real ve Prim Puanı önce 1 ondalığa, sonra tam sayıya yuvarlanır (roundPct: 90,45 → 91 · 90,44 → 90),
//  TL Real primi %100 sınırlı çarpanla, Portföy ≥91/≥91, MI&GI ≥70.
//  Bu sayfa SADECE OKUR — hiçbir veriyi/hesabı değiştirmez.
//
//  Bölümler: (1) Güncel dönem ekip tablosu (satıra tıkla → ürün dökümü)
//  · (2) Geçmiş Dönem Prim Hesabı — filtre YOK; temsilci satırına tıkla → dönem dönem döküm
//  (temsilci sayfasındaki tabloyla aynı hesap — js/ui/prim-gecmis.js PrimGecmisMgr.buildTeam)
//  · (3) Ek Prim Tablosu — açılır kutu, varsayılan kapalı (EK_PRIM.csv — js/data/ek-prim-loader.js ekPrimTablesHtml).
//
//  Rollback: index.html'den #mgr-sec-primtakip + #mgrPrimTakip bloğunu, bu script
//  satırını, "Prim Takip" pill'ini ve goPage() i===7 dalındaki renderPrimTakipPage çağrısını sil.
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var BAZ_TL_REAL = 55000;
  var BAZ_MIGI    = 14000;

  // Sıralama durumu (kolon başlığına tıklayınca)
  var _sortKey = 'toplam';
  var _sortDir = -1;          // -1: büyükten küçüğe
  var _openRows = {};         // açık ürün detayı satırları

  // Geçmiş Dönem Prim Hesabı: yıl seçimi (yalnızca birden çok yıl varsa görünür), açık temsilci satırları
  // ve Ek Prim Tablosu açılır kutusunun durumu (yeniden çizimlerde korunur)
  var _fYear = '';
  var _histOpen = {};
  var _ekOpen = false;

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _tl(n) { return (typeof fTL === 'function') ? fTL(n) : Math.round(n).toLocaleString('tr-TR') + '₺'; }
  function _id(ttt) { return 'pt_' + String(ttt).replace(/[^A-Za-z0-9]/g, '_'); }

  // ── Tek temsilci için prim dökümü (canlı GENEL) ──────────────
  function _detail(ttt) {
    var rG = GENEL.find(function (g) { return g.ttt === ttt && g.urun === 'GENEL TOPLAM'; });
    if (!rG) return null;

    var urunRows  = GENEL.filter(function (g) { return g.ttt === ttt && g.urun !== 'GENEL TOPLAM' && g.urun !== 'DESTEVIT'; });
    var urunReals = {};
    urunRows.forEach(function (r) { urunReals[r.urun] = r.tl_pct; });

    var effRaw   = rG.tl_pct || 0;
    var puanRaw  = rG.prim_pct || calcPrimPuani(urunReals, ttt);
    var effReal  = roundPct(effRaw);
    var primPuani = roundPct(puanRaw);

    // MI / GI — calcPrimForTTT ile aynı kaynak sırası
    var dn = function (d) { var p = String(d || '').split('/'); return p.length === 2 ? (+p[1] * 100 + +p[0]) : 0; };
    var all = (typeof MIGI_TL_RAW !== 'undefined' ? MIGI_TL_RAW : []).filter(function (r) { return r.person === ttt; });
    var latest = all.reduce(function (m, r) { return Math.max(m, dn(r.donem)); }, 0);
    var rows = all.filter(function (r) { return dn(r.donem) === latest; });
    var mi = rows.length ? rows.reduce(function (s, r) { return s + (r.mi || 100); }, 0) / rows.length : 100;
    var gi = rows.length ? rows.reduce(function (s, r) { return s + (r.bi || 100); }, 0) / rows.length : 100;
    var auto = (typeof getMiGiOtomatik === 'function') ? getMiGiOtomatik(ttt) : null;
    if (auto) { mi = auto.mi; gi = auto.gi; }

    var carpan = effReal >= 91 ? getCarpan(Math.min(effReal, 100)) : 0;
    var tlRealDonemlik = carpan * BAZ_TL_REAL;
    var komp = (typeof calcKompanzasyonEkPrimi === 'function') ? calcKompanzasyonEkPrimi(ttt, GENEL) : { ekPrim: 0 };
    var ekPrim = (komp && komp.ekPrim) || 0;
    var portfoy = calcPortfoyPrim(effReal, primPuani);
    var migiKat = effReal >= 70 ? getMiGiKatsayi(mi, gi) : 0;
    var migiPrim = migiKat * BAZ_MIGI;

    var tahmini = 0;
    try { tahmini = (typeof calcPrimForTTTForecast === 'function') ? calcPrimForTTTForecast(ttt) : 0; } catch (e) { tahmini = 0; }

    // %91'e yuvarlanma eşiği: gerçekleşme ≥ %90,45 (önce 1 ondalık, sonra tam sayı)
    var hedef = rG.hedef_tl || 0, satis = rG.satis_tl || 0;
    var esigeKalan = hedef > 0 ? Math.max(0, hedef * 0.9045 - satis) : 0;

    return {
      ttt: ttt, effRaw: effRaw, effReal: effReal, puanRaw: puanRaw, primPuani: primPuani,
      mi: mi, gi: gi, carpan: carpan,
      tlReal: tlRealDonemlik, ekPrim: ekPrim, portfoy: portfoy, migi: migiPrim,
      toplam: tlRealDonemlik + ekPrim + portfoy + migiPrim,
      tahmini: tahmini, hedef: hedef, satis: satis, esigeKalan: esigeKalan,
      urunRows: urunRows
    };
  }

  function _status(d) {
    if (d.effReal >= 91 && d.primPuani >= 91) return { t: '✅ Tam hak',      c: '#059669', bg: 'rgba(5,150,105,.12)' };
    if (d.effReal >= 91)                      return { t: '🟡 Portföy yok',  c: '#B45309', bg: 'rgba(217,119,6,.14)' };
    if (d.effReal >= 70)                      return { t: '🟠 Sadece MI&GI', c: '#C2410C', bg: 'rgba(234,88,12,.12)' };
    return                                           { t: '🔴 Prim yok',     c: '#DC2626', bg: 'rgba(220,38,38,.10)' };
  }

  function _urunDetailHtml(d) {
    var head = '<tr><th>Ürün</th><th>TL %</th><th>Ağırlık</th><th>Prim Puanına Katkı</th></tr>';
    var body = d.urunRows.map(function (r) {
      var real = r.tl_pct || 0;
      var ag = (r.urun_agirlik > 0) ? normAgirlik(r.urun_agirlik) : (URUN_AGIRLIK[r.urun] || 0);
      var katki = real >= 70 ? Math.min(real, 130) * ag : 0;
      return '<tr><td style="font-weight:700;color:' + (URUN_CLR[r.urun] || 'var(--c1)') + '">' + _esc(r.urun) + '</td>' +
        '<td class="mono">' + real.toFixed(1) + '%</td>' +
        '<td class="mono">%' + Math.round(ag * 100) + '</td>' +
        '<td class="mono">' + (real >= 70 ? katki.toFixed(1) + '%' : '<span style="color:var(--dim)">0 (TL% &lt; 70)</span>') + '</td></tr>';
    }).join('');
    return '<div style="padding:10px 14px">' +
      '<table class="tbl" style="min-width:420px;background:transparent"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '<div style="font-size:10px;color:var(--dim);margin-top:6px">Prim Puanı = Σ (min(TL%,130) × ağırlık), TL% ≥ 70 olan ürünler · Ham: ' +
      d.puanRaw.toFixed(1) + '% → ' + d.primPuani + '%</div></div>';
  }

  var COLS = [
    { k: 'ttt',        l: 'Temsilci' },
    { k: 'effReal',    l: 'TL Real %' },
    { k: 'primPuani',  l: 'Prim Puanı %' },
    { k: 'mi',         l: 'MI / GI' },
    { k: 'tlReal',     l: 'TL Real Primi' },
    { k: 'portfoy',    l: 'Portföy Primi' },
    { k: 'migi',       l: 'MI&GI Primi' },
    { k: 'toplam',     l: 'Toplam Prim' },
    { k: 'tahmini',    l: 'Dönem Sonu Tahmini' },
    { k: 'esigeKalan', l: '%91 Eşiğine Kalan' },
    { k: 'durum',      l: 'Durum' }
  ];

  function ptSort(k) {
    if (_sortKey === k) _sortDir = -_sortDir; else { _sortKey = k; _sortDir = (k === 'ttt') ? 1 : -1; }
    renderPrimTakipPage();
  }
  function ptToggle(ttt) {
    _openRows[ttt] = !_openRows[ttt];
    renderPrimTakipPage();
  }

  function ptSetFilter(kind, val) {
    if (kind === 'year') _fYear = val || '';
    else if (kind === 'clear') _fYear = '';
    renderPrimTakipPage();
  }

  // Yalnız Geçmiş Dönem + Ek Prim bölümünü yeniden çiz (Güncel Dönem tablosuna dokunma)
  function _renderHist() {
    var gHost = document.getElementById('mgrPrimGecmis');
    if (gHost) gHost.innerHTML = _historyHtml(); else renderPrimTakipPage();
  }
  function ptHistToggle(ttt) { _histOpen[ttt] = !_histOpen[ttt]; _renderHist(); }
  function ptEkToggle() { _ekOpen = !_ekOpen; _renderHist(); }

  // Geçmiş Dönem kartı (temsilci satırı tıklanınca açılır) + Ek Prim kartı (başlığa tıklanınca açılır)
  function _historyHtml() {
    var G = window.PrimGecmisMgr;
    if (!G || typeof G.buildTeam !== 'function') {
      return '<div class="card" style="margin-top:16px"><div class="card-body" style="font-size:12px;color:var(--dim)">Geçmiş dönem modülü (prim-gecmis.js) yüklenemedi.</div></div>';
    }
    G.ensure(renderPrimTakipPage);   // YTD_TL.csv yüklü değilse arka planda çek, gelince yeniden çiz

    var years = G.years();
    var curY = String(new Date().getFullYear());
    var year = (_fYear && years.indexOf(_fYear) >= 0) ? _fYear : (years.indexOf(curY) >= 0 ? curY : years[0]);
    var yearSel = years.length > 1
      ? '<div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-bottom:8px;font-size:11px"><span style="color:var(--dim)">Yıl</span>' +
        '<select class="inp" style="padding:4px 8px;font-size:11px" onchange="ptSetFilter(\'year\',this.value)">' +
        years.map(function (y) { return '<option value="' + _esc(y) + '"' + (y === year ? ' selected' : '') + '>' + _esc(y) + '</option>'; }).join('') + '</select></div>'
      : '';

    var histCard =
      '<div class="card" style="margin-top:18px">' +
        '<div class="card-hd"><span class="card-title">📆 Geçmiş Dönem Prim Hesabı — MI &amp; GIGI</span><span class="card-badge">' + _esc(year) + ' · Satıra tıkla → dönem dönem döküm</span></div>' +
        '<div class="card-body">' + yearSel + G.buildTeam({ year: year, open: _histOpen }) + '</div>' +
      '</div>';

    var ek = (typeof window.ekPrimTablesHtml === 'function') ? window.ekPrimTablesHtml('') : null;
    var ekBody = ek ||
      '<div style="color:var(--dim);font-size:11px;padding:6px 0">Ek prim tablosu bulunamadı veya yükleniyor' +
      (window.EK_PRIM_LOAD_ERROR ? ' (' + _esc(window.EK_PRIM_LOAD_ERROR) + ')' : '') + '.</div>';
    // Ekip Haftalık Rota Planları ile aynı açılır kutu görünümü (varsayılan KAPALI)
    var ekCard =
      '<div class="mb16" style="background:var(--surf);border:1.5px solid rgba(79,0,140,.15);border-radius:14px;padding:16px;margin-top:16px">' +
        '<div style="font-size:13px;font-weight:700;color:var(--fg);cursor:pointer;display:flex;align-items:center;gap:6px" onclick="ptEkToggle()">' +
          '<span class="mgr-acc-arrow" style="font-size:10px;color:var(--dim)">' + (_ekOpen ? '▾' : '▸') + '</span>🎯 Ek Prim Tablosu</div>' +
        '<div style="display:' + (_ekOpen ? 'block' : 'none') + ';margin-top:8px">' + ekBody +
          '<div style="font-size:10px;color:var(--dim);margin-top:2px">Ek prim kampanyaları döneme bağlı değildir (kampanya tablosu olduğu gibi gösterilir). Kompanzasyon ek primi yukarıdaki Geçmiş Dönem tablosunda (3. ve 6. dönem) yer alır.</div>' +
        '</div>' +
      '</div>';

    return histCard + ekCard;
  }

  function renderPrimTakipPage() {
    var host = document.getElementById('mgrPrimTakip');
    if (!host) return;

    // Güvenlik: sadece Yönetici
    if (typeof getCurrentRole === 'function' && getCurrentRole() !== 'YONETICI') {
      host.innerHTML = '<div style="padding:16px;color:var(--dim);font-size:13px">Bu bölüm yalnızca Yönetici için görüntülenebilir.</div>';
      return;
    }
    if (typeof GENEL === 'undefined' || !GENEL.length) {
      host.innerHTML = '<div style="padding:16px;color:var(--dim);font-size:13px">Veri yükleniyor…</div>';
      return;
    }

    var per = (typeof getEffectivePeriod === 'function') ? getEffectivePeriod() : null;
    var perTxt = per ? (per.label + ' · ' + per.months) : '—';
    var isKomp = (typeof isKompanzasyonDonemi === 'function') ? !!isKompanzasyonDonemi() : false;

    var list = ALL_TTTS.map(_detail).filter(Boolean);

    // Sıralama
    var statusRank = function (d) { return d.effReal >= 91 ? (d.primPuani >= 91 ? 3 : 2) : (d.effReal >= 70 ? 1 : 0); };
    list.sort(function (a, b) {
      var va, vb;
      if (_sortKey === 'ttt')        { return _sortDir * a.ttt.localeCompare(b.ttt, 'tr'); }
      else if (_sortKey === 'durum') { va = statusRank(a); vb = statusRank(b); }
      else if (_sortKey === 'mi')    { va = a.mi; vb = b.mi; }
      else                           { va = a[_sortKey] || 0; vb = b[_sortKey] || 0; }
      return _sortDir * (va - vb);
    });

    // KPI
    var sum = function (f) { return list.reduce(function (s, d) { return s + (d[f] || 0); }, 0); };
    var totNow = sum('toplam'), totFc = sum('tahmini');
    var nTam = list.filter(function (d) { return d.effReal >= 91 && d.primPuani >= 91; }).length;
    var nTL  = list.filter(function (d) { return d.effReal >= 91; }).length;
    var nYok = list.filter(function (d) { return d.effReal < 70; }).length;

    var kpi = function (label, val, sub, color) {
      return '<div class="card" style="flex:1 1 180px;min-width:170px;padding:14px 16px">' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--dim);text-transform:uppercase">' + label + '</div>' +
        '<div class="mono" style="font-size:22px;font-weight:800;color:' + color + ';margin-top:4px">' + val + '</div>' +
        '<div style="font-size:10px;color:var(--dim);margin-top:2px">' + sub + '</div></div>';
    };

    var th = COLS.map(function (c) {
      var arrow = (_sortKey === c.k) ? (_sortDir === 1 ? ' ▲' : ' ▼') : '';
      return '<th style="cursor:pointer;white-space:nowrap" onclick="ptSort(\'' + c.k + '\')">' + c.l + arrow + '</th>';
    }).join('');

    var rowsHtml = list.map(function (d) {
      var st = _status(d);
      var open = !!_openRows[d.ttt];
      var effTxt = d.effRaw.toFixed(1) + '%' + (d.effReal !== d.effRaw ? ' <span style="color:var(--dim)">→ ' + d.effReal + '%</span>' : '');
      var puanTxt = d.puanRaw.toFixed(1) + '%' + (d.primPuani !== d.puanRaw ? ' <span style="color:var(--dim)">→ ' + d.primPuani + '%</span>' : '');
      var effColor = d.effReal >= 91 ? '#059669' : (d.effReal >= 70 ? '#D97706' : '#DC2626');
      var puanColor = d.primPuani >= 91 ? '#059669' : '#D97706';
      var kalanTxt = d.effReal >= 91
        ? '<span style="color:#059669;font-weight:700">Eşik aşıldı</span>'
        : (d.hedef > 0 ? '<span style="color:#DC2626">' + _tl(d.esigeKalan) + '</span>' : '—');
      var line =
        '<tr style="cursor:pointer" onclick="ptToggle(\'' + _esc(d.ttt).replace(/'/g, "\\'") + '\')">' +
        '<td style="font-weight:700;white-space:nowrap">' + (open ? '▾ ' : '▸ ') + _esc(d.ttt) + '</td>' +
        '<td class="mono" style="color:' + effColor + ';font-weight:700">' + effTxt + '</td>' +
        '<td class="mono" style="color:' + puanColor + ';font-weight:700">' + puanTxt + '</td>' +
        '<td class="mono">' + Math.round(d.mi) + ' / ' + Math.round(d.gi) + '</td>' +
        '<td class="mono">' + _tl(d.tlReal + d.ekPrim) + (d.ekPrim > 0 ? '<div style="font-size:9px;color:#D97706">+ kompanzasyon</div>' : '') + '</td>' +
        '<td class="mono">' + _tl(d.portfoy) + '</td>' +
        '<td class="mono">' + _tl(d.migi) + '</td>' +
        '<td class="mono" style="font-weight:800;color:var(--c1)">' + _tl(d.toplam) + '</td>' +
        '<td class="mono" style="color:var(--c2);font-weight:700">' + _tl(d.tahmini) + '</td>' +
        '<td class="mono">' + kalanTxt + '</td>' +
        '<td><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;color:' + st.c + ';background:' + st.bg + '">' + st.t + '</span></td>' +
        '</tr>';
      if (open) {
        line += '<tr><td colspan="' + COLS.length + '" style="background:rgba(79,0,140,.03);padding:0">' + _urunDetailHtml(d) + '</td></tr>';
      }
      return line;
    }).join('');

    var foot =
      '<tr style="border-top:2px solid var(--c1);background:rgba(79,0,140,.05)">' +
      '<td style="font-weight:800;color:var(--c1)">EKİP TOPLAMI</td><td></td><td></td><td></td>' +
      '<td class="mono" style="font-weight:700">' + _tl(sum('tlReal') + sum('ekPrim')) + '</td>' +
      '<td class="mono" style="font-weight:700">' + _tl(sum('portfoy')) + '</td>' +
      '<td class="mono" style="font-weight:700">' + _tl(sum('migi')) + '</td>' +
      '<td class="mono" style="font-weight:800;color:var(--c1)">' + _tl(totNow) + '</td>' +
      '<td class="mono" style="font-weight:800;color:var(--c2)">' + _tl(totFc) + '</td><td></td><td></td></tr>';

    host.innerHTML =
      '<div>' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
          '<span class="card-badge">' + _esc(perTxt) + (isKomp ? ' · 🏆 Kompanzasyon' : '') + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
          kpi('Ekip Mevcut Prim', _tl(totNow), 'Şu anki gerçekleşmeye göre', 'var(--c1)') +
          kpi('Dönem Sonu Tahmini', _tl(totFc), 'Forecast bazlı (kompanzasyon hariç)', 'var(--c2)') +
          kpi('TL Real Primi Hak Eden', nTL + ' / ' + list.length, 'TL Real ≥ %91 (yuvarlanmış)', '#059669') +
          kpi('Tam Hak (Portföy dahil)', nTam + ' / ' + list.length, 'TL Real ve Prim Puanı ≥ %91', '#059669') +
          kpi('Prim Dışı', String(nYok), 'TL Real < %70 · MI&GI de yok', nYok ? '#DC2626' : '#059669') +
        '</div>' +
        '<div class="card">' +
          '<div class="card-hd"><span class="card-title">Temsilci Prim Takibi — Güncel Dönem</span>' +
          '<span class="card-badge">Satıra tıkla → ürün bazlı Prim Puanı dökümü</span></div>' +
          '<div class="card-body-0 scroll-x"><table class="tbl" style="min-width:1100px">' +
          '<thead><tr>' + th + '</tr></thead><tbody>' + rowsHtml + foot + '</tbody></table></div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--dim);margin-top:10px;line-height:1.5">' +
          'TL Real ve Prim Puanı önce 1 ondalığa, sonra tam sayıya yuvarlanır (90,45 → 91 · 90,44 → 90). Mevcut prim, canlı GENEL / MI&amp;GI verisiyle hesaplanır; ' +
          'dönem sonu tahmini forecast motorundan gelir. %91 eşiğine kalan TL, gerçekleşmenin %90,45\'e ulaşması (→ 91\'e yuvarlanması) için gereken satıştır.' +
        '</div>' +
      '</div>';

    // Geçmiş Dönem Prim Hesabı + Ek Prim Tablosu: ayrı kutuda (Kongre Etkisi Analizi'nden sonra).
    // #mgrPrimGecmis yoksa eski davranış: Prim Takip kutusunun altına eklenir.
    var gHost = document.getElementById('mgrPrimGecmis');
    if (gHost) gHost.innerHTML = _historyHtml();
    else host.insertAdjacentHTML('beforeend', _historyHtml());
  }

  window.renderPrimTakipPage = renderPrimTakipPage;
  window.ptSort = ptSort;
  window.ptToggle = ptToggle;
  window.ptSetFilter = ptSetFilter;
  window.ptHistToggle = ptHistToggle;
  window.ptEkToggle = ptEkToggle;

  // data-loader.js veri yüklenince renderManagerExtra()'yı çağırıyor; Yönetici sayfası
  // açıkken Prim Takip bölümü de otomatik yenilensin (çift sarmayı engelle).
  if (typeof window.renderManagerExtra === 'function' && !window.renderManagerExtra.__ptWrapped) {
    var _origExtra = window.renderManagerExtra;
    window.renderManagerExtra = function () {
      var r = _origExtra.apply(this, arguments);
      try { renderPrimTakipPage(); } catch (e) { console.warn('[prim-takip] render hata:', e.message); }
      return r;
    };
    window.renderManagerExtra.__ptWrapped = true;
  }
})();
