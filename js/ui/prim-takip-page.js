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
//  Bölümler: (1) Güncel dönem ekip tablosu · (2) Filtre çubuğu (temsilci / yıl / dönem)
//  · (3) Geçmiş Dönem Prim Hesabı (temsilci sayfasındaki tabloyla aynı hesap — js/ui/prim-gecmis.js
//  PrimGecmisMgr) · (4) Ek Prim Tablosu (EK_PRIM.csv — js/data/ek-prim-loader.js ekPrimTablesHtml).
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

  // Geçmiş Dönem / Ek Prim filtreleri ('' = tüm ekip / tüm dönemler)
  var _fTtt = '';
  var _fYear = '';
  var _fPeriod = '';

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
    if (kind === 'ttt') _fTtt = val || '';
    else if (kind === 'year') _fYear = val || '';
    else if (kind === 'period') _fPeriod = val || '';
    else if (kind === 'clear') { _fTtt = ''; _fPeriod = ''; _fYear = ''; }
    renderPrimTakipPage();
  }

  // Filtre çubuğu + Geçmiş Dönem kartı + Ek Prim kartı
  function _historyHtml() {
    var G = window.PrimGecmisMgr;
    if (!G) {
      return '<div class="card" style="margin-top:16px"><div class="card-body" style="font-size:12px;color:var(--dim)">Geçmiş dönem modülü (prim-gecmis.js) yüklenemedi.</div></div>';
    }
    G.ensure(renderPrimTakipPage);   // YTD_TL.csv yüklü değilse arka planda çek, gelince yeniden çiz

    var years = G.years();
    var curY = String(new Date().getFullYear());
    var year = (_fYear && years.indexOf(_fYear) >= 0) ? _fYear : (years.indexOf(curY) >= 0 ? curY : years[0]);
    var periods = G.periods();
    var opt = function (v, l, sel) { return '<option value="' + _esc(v) + '"' + (sel ? ' selected' : '') + '>' + _esc(l) + '</option>'; };
    var sty = 'padding:5px 8px;font-size:11px;max-width:100%';
    var lab = 'font-size:9px;font-weight:700;letter-spacing:.05em;color:var(--dim);text-transform:uppercase;display:block;margin-bottom:2px';

    var filterBar =
      '<div class="card" style="margin-top:18px"><div class="card-body" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">' +
        '<div><label style="' + lab + '">Temsilci</label><select class="inp" style="' + sty + ';min-width:170px" onchange="ptSetFilter(\'ttt\',this.value)">' +
          opt('', 'Tüm ekip', !_fTtt) + ALL_TTTS.map(function (t) { return opt(t, t, t === _fTtt); }).join('') + '</select></div>' +
        '<div><label style="' + lab + '">Yıl</label><select class="inp" style="' + sty + '" onchange="ptSetFilter(\'year\',this.value)">' +
          years.map(function (y) { return opt(y, y, y === year); }).join('') + '</select></div>' +
        '<div><label style="' + lab + '">Dönem</label><select class="inp" style="' + sty + ';min-width:170px" onchange="ptSetFilter(\'period\',this.value)">' +
          opt('', 'Tüm dönemler', !_fPeriod) + periods.map(function (p) { return opt(p.key, p.label + ' · ' + p.months, p.key === _fPeriod); }).join('') + '</select></div>' +
        ((_fTtt || _fPeriod) ? '<button onclick="ptSetFilter(\'clear\')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surf);font-size:11px;cursor:pointer">↺ Filtreyi temizle</button>' : '') +
        '<div style="font-size:10px;color:var(--dim);flex:1 1 220px;line-height:1.4">Temsilci filtresi hem Geçmiş Dönem Prim Hesabını hem Ek Prim Tablosunu, yıl ve dönem filtresi Geçmiş Dönem tablosunu etkiler.</div>' +
      '</div></div>';

    var perLbl = '';
    if (_fPeriod) { var pm = periods.filter(function (p) { return p.key === _fPeriod; })[0]; perLbl = pm ? pm.label : ''; }
    var badge = [(_fTtt || 'Tüm ekip'), year, (perLbl || 'Tüm dönemler')].join(' · ');
    var histCard =
      '<div class="card" style="margin-top:16px">' +
        '<div class="card-hd"><span class="card-title">📆 Geçmiş Dönem Prim Hesabı — MI &amp; GIGI</span><span class="card-badge">' + _esc(badge) + '</span></div>' +
        '<div class="card-body">' + G.build({ ttt: _fTtt, year: year, period: _fPeriod }) + '</div>' +
      '</div>';

    var ek = (typeof window.ekPrimTablesHtml === 'function') ? window.ekPrimTablesHtml(_fTtt) : null;
    var ekBody = ek ||
      '<div style="color:var(--dim);font-size:11px;padding:6px 0">Ek prim tablosu bulunamadı veya yükleniyor' +
      (window.EK_PRIM_LOAD_ERROR ? ' (' + _esc(window.EK_PRIM_LOAD_ERROR) + ')' : '') + '.</div>';
    var ekCard =
      '<div class="card" style="margin-top:16px">' +
        '<div class="card-hd"><span class="card-title">🎯 Ek Prim Tablosu</span><span class="card-badge">' + _esc(_fTtt || 'Tüm ekip') + '</span></div>' +
        '<div class="card-body">' + ekBody +
          '<div style="font-size:10px;color:var(--dim);margin-top:2px">Ek prim kampanyaları döneme bağlı değildir (kampanya tablosu olduğu gibi gösterilir). Kompanzasyon ek primi yukarıdaki Geçmiş Dönem tablosunda (3. ve 6. dönem) yer alır.</div>' +
        '</div>' +
      '</div>';

    return filterBar + histCard + ekCard;
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
        _historyHtml() +
      '</div>';
  }

  window.renderPrimTakipPage = renderPrimTakipPage;
  window.ptSort = ptSort;
  window.ptToggle = ptToggle;
  window.ptSetFilter = ptSetFilter;

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
