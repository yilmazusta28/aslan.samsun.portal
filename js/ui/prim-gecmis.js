// ══════════════════════════════════════════════════════════════════════
//  js/ui/prim-gecmis.js — Prim Hesapla › "Geçmiş Dönem Prim Hesabı"
//
//  Seçili temsilcinin her dönemi için: ürün bazlı TL Real %, Prim Puanı,
//  MI & GIGI (MI_GIGI.csv) ve bunlarla hesaplanan prim dökümü.
//    ✅ Kesinleşti → MI&GIGI geldi (dönem sonu +2 ay)
//    ⏳ Tahmini    → MI&GIGI henüz yok, MI=GIGI=100 varsayılır (yürüyen sistem)
//    ▶ Devam      → dönem sürüyor
//  Ürün % verisi: PrimLedger (otomatik sync/arşiv kaydı veya ✏️ manuel giriş).
//  Hesap kuralı: calcPrimBreakdown / calcKompEkFromRows (prim-calc.js).
//  Bağımlılık: prim-calc.js, migi-donem.js, prim-ledger.js, date-utils.js
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var _year = null;          // seçili yıl ('2026' / '2027')
  var _editKey = null;       // açık düzenleme satırının dönem anahtarı

  function _tl(v) { return (v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' ₺'; }
  // Tam sayı (en yakın, .5 yukarı): 75,9→76 · 96,45→96 · 34,51→35. Ham değer tooltip'te.
  // HTML kaçışı: uzaktan gelen (arsiv/PRIM_KAYIT_*.json) veya CSV kaynaklı metinler innerHTML'e ham basılmaz
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _r0(v) { return Math.floor((+v || 0) + 0.5 + 1e-9); }
  function _raw(v) { return (+v || 0).toFixed(2).replace('.', ','); }
  function _pct(v) { return (v == null) ? '—' : v.toFixed(1).replace('.', ',') + '%'; }
  function _clr(v) { return v > 0 ? 'color:#16A34A;font-weight:700' : 'color:#DC2626;font-weight:700'; }
  var _AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  function _donemAdi(d) { var p = String(d || '').split('/'); return p.length === 2 ? (_AY[(+p[0]) - 1] + ' ' + p[1]) : '—'; }
  // PDF "Ödeme Takvimi" (baz IMS: dönem sonu +2 ay kesinleşmiş)
  var _ODEME = { '1d': 'Mayıs', '2d': 'Temmuz', 'k1': 'Eylül', '4d': 'Kasım', '5d': 'Ocak (Ertesi yıl)', 'k2': 'Mart (Ertesi yıl)' };
  function _wText(wi) {
    return URUN_ORDER.map(function (u) { return Math.round((wi.w[u] || 0) * 100); }).join('/') + (wi.custom ? ' ✎' : '');
  }
  function _periods() { return (typeof PERIODS !== 'undefined') ? PERIODS : []; }
  function _ttt() { var el = document.getElementById('primTTT'); return el ? el.value : ''; }

  function _years() {
    var ys = {};
    ys[String(new Date().getFullYear())] = 1;
    (typeof migiDonemYears === 'function' ? migiDonemYears() : []).forEach(function (y) { ys[y] = 1; });
    return Object.keys(ys).sort();
  }

  // Bir dönem satırının tüm hesabı
  function _calcRow(ttt, year, p, effKey) {
    var rec = window.PrimLedger ? window.PrimLedger.get(year, p.key, ttt) : null;
    var mg = (typeof getMiGiDonem === 'function') ? getMiGiDonem(ttt, year, p.key) : null;
    var inProgress = (year === _yearOfPeriod(p) && p.key === effKey);
    // Kesinleşmiş MI&GIGI yoksa sistem verisinden otomatik tahmin (sadece 2026 — sistem verisi 2026'ya ait)
    var auto = (!mg && rec && year === _yearOfPeriod(p) && typeof getMiGiOtomatik === 'function') ? getMiGiOtomatik(ttt, p.key) : null;
    if (auto && auto.source === 'final') auto = null;
    var row = { ttt: ttt, year: year, p: p, rec: rec, mg: mg, auto: auto, inProgress: inProgress, calc: null, komp: null,
                wInfo: window.PrimLedger.effectiveWeights(year, p.key), puanKaynak: null };
    if (!rec) return row;

    var effReal = rec.genel.tl_pct || 0;
    // Prim puanı önceliği: MI_GIGI.csv'deki RESMİ prim puanı > (YTD/manuel kayıt veya elle ağırlık) → dönem
    // ağırlıklarıyla hesap > GENEL/arşiv kaydındaki resmi puan.
    var wInfo = window.PrimLedger.effectiveWeights(year, p.key);
    var primPuani, puanKaynak;
    if (mg && mg.primP > 0 && !wInfo.custom) { primPuani = mg.primP; puanKaynak = 'resmi'; }
    else if (rec.source === 'ytd' || rec.source === 'manuel' || wInfo.custom || !(rec.genel.prim_pct > 0)) { primPuani = window.PrimLedger.primPuani(rec.urunler, p.key, year); puanKaynak = wInfo.custom ? 'elle' : 'hesap'; }
    else { primPuani = rec.genel.prim_pct; puanKaynak = 'resmi'; }
    row.puanKaynak = puanKaynak; row.wInfo = wInfo;

    // Kompanzasyon Ek Primi (sadece k1/k2): önceki 2 dönemin ledger kaydı gerekli
    var ek = 0;
    if (p.key === 'k1' || p.key === 'k2') {
      var sib = p.key === 'k1' ? ['1d', '2d'] : ['4d', '5d'];
      var rows = sib.map(function (k) { var r = window.PrimLedger.get(year, k, ttt); return r ? r.genel : null; });
      if (rows.every(Boolean)) {
        row.komp = calcKompEkFromRows(rows.concat([rec.genel]), { round: true });
        ek = row.komp.ekPrim || 0;
      } else {
        row.komp = { eligible: false, ekPrim: 0, reason: 'Önceki 2 dönemin ürün verisi yok.' };
      }
    }
    row.calc = calcPrimBreakdown({ effReal: effReal, primPuani: primPuani, mi: mg ? mg.mi : (auto ? auto.mi : 100), gi: mg ? mg.gi : (auto ? auto.gi : 100), ekPrim: ek });
    row.effReal = effReal; row.primPuani = primPuani;
    return row;
  }
  function _yearOfPeriod(p) { return p.start.slice(0, 4); }

  // "Tahmini" rozetine / hücreye: MI_GIGI.csv'de kesin değerin neden çıkmadığı
  function _nedenTitle(r) {
    var n = (typeof window.getMiGiNeden === 'function') ? window.getMiGiNeden(r.ttt, r.year, r.p.key) : '';
    return n ? ' title="Kesinleşmedi: ' + _esc(n) + '"' : '';
  }
  function _statusBadge(r) {
    if (r.mg && r.rec) return '<span style="color:#16A34A;font-weight:700">✅ Kesinleşti</span>';
    if (r.mg && !r.rec) return '<span style="color:#D97706;font-weight:700">📥 MI&amp;GIGI var, ürün % yok</span>';
    if (r.inProgress) return '<span style="color:#2563EB;font-weight:700">▶ Devam ediyor</span>';
    if (r.rec) return '<span style="color:#D97706;font-weight:700"' + _nedenTitle(r) + '>⏳ Tahmini (' + (r.auto ? 'sistem MI/GIGI' : 'MI=GIGI=100') + ')</span>';
    return '<span style="color:var(--dim)">— Veri yok</span>';
  }

  function _editRowHtml(ttt, year, r) {
    var inputs = URUN_ORDER.map(function (u) {
      var v = r.rec && r.rec.urunler[u] ? r.rec.urunler[u].tl_pct : '';
      return '<div><label style="font-size:9px;font-weight:700;color:' + (URUN_CLR[u] || '#444') + ';display:block">' + u + '</label>' +
        '<input type="number" step="0.1" min="0" max="200" class="inp pg-in" data-u="' + u + '" value="' + v + '" style="width:80px;padding:4px 6px" placeholder="%"></div>';
    }).join('');
    var gv = r.rec && r.rec.source === 'manuel' ? r.rec.genel.tl_pct : '';
    return '<tr><td colspan="15" style="background:var(--surf2);padding:10px;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:10px;font-weight:700;margin-bottom:6px">✏️ ' + r.p.label + ' — ürün bazlı TL Real % (resmi sonuç tablosundan)</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">' + inputs +
      '<div><label style="font-size:9px;font-weight:700;display:block">GENEL TL Real % <span style="font-weight:400;color:var(--dim)">(boşsa ağırlıklı ort.)</span></label>' +
      '<input type="number" step="0.1" min="0" max="200" class="inp" id="pgGenelIn" value="' + gv + '" style="width:90px;padding:4px 6px"></div>' +
      '<button onclick="pgSaveEdit(\'' + r.p.key + '\')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--c1);background:var(--c1);color:#fff;font-size:11px;font-weight:600;cursor:pointer">💾 Kaydet</button>' +
      (r.rec && r.rec.source === 'manuel' ? '<button onclick="pgClearEdit(\'' + r.p.key + '\')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surf);font-size:11px;cursor:pointer">🗑 Manuel kaydı sil</button>' : '') +
      '</div>' +
      '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border)">' +
        '<div style="font-size:10px;font-weight:700;margin-bottom:6px">⚖️ ' + r.p.label + ' — ürün ağırlıkları (%) <span style="font-weight:400;color:var(--dim)">(tüm temsilcilere uygulanır · toplam 100 olmalı' + (r.wInfo.custom ? ' · şu an ELLE girilmiş' : '') + ')</span></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">' +
        URUN_ORDER.map(function (u) {
          return '<div><label style="font-size:9px;font-weight:700;color:' + (URUN_CLR[u] || '#444') + ';display:block">' + u + '</label>' +
            '<input type="number" step="1" min="0" max="100" class="inp pg-w" data-u="' + u + '" value="' + Math.round((r.wInfo.w[u] || 0) * 1000) / 10 + '" style="width:70px;padding:4px 6px"></div>';
        }).join('') +
        '<button onclick="pgSaveWeights(\'' + r.p.key + '\')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--c1);background:var(--c1);color:#fff;font-size:11px;font-weight:600;cursor:pointer">💾 Ağırlıkları kaydet</button>' +
        (r.wInfo.custom ? '<button onclick="pgClearWeights(\'' + r.p.key + '\')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surf);font-size:11px;cursor:pointer">↺ Varsayılana dön</button>' : '') +
        '</div></div>' +
      (r.rec ? '<div style="font-size:9px;color:var(--dim);margin-top:6px">Mevcut kayıt kaynağı: ' + _esc(r.rec.source) + (r.rec.savedAt ? ' · ' + _esc(String(r.rec.savedAt).slice(0, 10)) : '') + '</div>' : '') +
      '</td></tr>';
  }

  // Tablo başlığı (Temsilci sayfası ve Yönetici paneli ortak)
  function _theadHtml(firstLabel, withEdit) {
    var th = function (t) { return '<th style="text-align:right;padding:4px 5px;font-size:9px;white-space:nowrap">' + t + '</th>'; };
    var urunHeads = URUN_ORDER.map(function (u) {
      return '<th title="' + u + '" style="text-align:right;padding:4px 5px;font-size:9px;white-space:nowrap;color:' + (URUN_CLR[u] || 'inherit') + '">' + u.split(' ')[0].slice(0, 5) + '</th>';
    }).join('');
    return '<thead><tr style="border-bottom:2px solid var(--c1)"><th style="text-align:left;padding:4px 5px;font-size:9px">' + firstLabel + '</th><th style="text-align:left;padding:4px 5px;font-size:9px">Durum</th>' +
      th('TL Real') + urunHeads + th('Prim Puanı') + th('MI') + th('GIGI') + th('TL Real Primi') + th('Portföy') + th('MI&amp;GI Çarpan') + th('MI&amp;GI Primi') + th('TOPLAM') + (withEdit ? '<th></th>' : '') + '</tr></thead>';
  }

  // Tek dönem satırı (Temsilci sayfası: o.edit=true · Yönetici paneli: salt-okunur, o.lead ile ilk hücre değişebilir)
  function _rowHtml(r, o) {
    o = o || {};
      var c = r.calc, pr = r.p;
      var cells;
      if (c) {
        var urunCells = URUN_ORDER.map(function (u) {
          var x = r.rec.urunler[u];
          return '<td style="text-align:right;padding:4px 5px">' + (x ? _pct(x.tl_pct) : '—') + '</td>';
        }).join('');
        cells = '<td style="text-align:right;padding:4px 5px;font-weight:700" title="Ham değer: ' + _raw(r.effReal) + '">' + _r0(r.effReal) + '%</td>' + urunCells +
          '<td style="text-align:right;padding:4px 5px" title="' + (r.puanKaynak === 'resmi' ? 'Resmi prim puanı (MI_GIGI.csv / GENEL)' : r.puanKaynak === 'elle' ? 'Elle girilen dönem ağırlıklarıyla hesaplandı' : 'Dönem ürün ağırlıklarıyla hesaplandı') + ' · ham: ' + _raw(r.primPuani) + '">' + (r.puanKaynak === 'hesap' && r.rec.agirlikTahmini ? '≈' : '') + _r0(r.primPuani) + '%</td>';
      } else {
        cells = '<td colspan="7" style="text-align:center;color:var(--dim);padding:4px 5px">Ürün bazlı veri yok (YTD_TL.csv içinde bu dönem için hedef bulunamadı)</td>';
      }
      var _aTip = r.auto ? ('Sistem verisinden tahmin — MI: ' + _donemAdi(r.auto.donem) + ' YTD' + (r.auto.giNote ? '; ' + r.auto.giNote : (r.auto.giFallback ? '; GIGI=100 varsayıldı' : '')) + ' — kesinleşmiş IMS gelince değişir') : '';
      var mi = r.mg ? '<span title="Ham değer: ' + _raw(r.mg.mi) + '" style="color:' + getIndeksColor(r.mg.mi) + ';font-weight:700">' + _r0(r.mg.mi) + '%</span>'
        : (r.auto ? '<span title="' + _aTip + ' · ham: ' + _raw(r.auto.mi) + '" style="color:var(--dim)">≈' + _r0(r.auto.mi) + '%</span>' : '<span style="color:var(--dim)">' + (c ? '100*' : '—') + '</span>');
      var gi = r.mg ? '<span title="Ham değer: ' + _raw(r.mg.gi) + '" style="color:' + getIndeksColor(r.mg.gi) + ';font-weight:700">' + _r0(r.mg.gi) + '</span>'
        : (r.auto ? '<span title="' + _aTip + ' · ham: ' + _raw(r.auto.gi) + '" style="color:var(--dim)">≈' + _r0(r.auto.gi) + '</span>' : '<span style="color:var(--dim)">' + (c ? '100*' : '—') + '</span>');
      var money = (c && r.inProgress) ? '<td colspan="5" style="text-align:center;color:var(--dim);font-size:10px" title="Dönem sürüyor — üstteki Prim Hesaplama Şablonu ile hesaplayın">— dönem sürüyor —</td>' : c ? ('<td style="text-align:right;padding:4px 5px"><span style="' + _clr(c.tlRealPrim) + '">' + _tl(c.tlRealPrim) + '</span>' +
          (c.ekPrim > 0 ? '<div style="font-size:8px;color:var(--dim)" title="' + (r.komp && r.komp.detail && r.komp.detail.approx ? 'Manuel girilen dönemlerde hedef/satış TL yok: kümülatif real, dönem real ortalamasından yaklaşık hesaplandı' : 'Kompanzasyon Ek Primi') + '">(+' + _tl(c.ekPrim) + ' komp.' + (r.komp && r.komp.detail && r.komp.detail.approx ? ' ≈' : '') + ')</div>' : '') + '</td>' +
        '<td style="text-align:right;padding:4px 5px"><span style="' + _clr(c.portfoyPrim) + '">' + _tl(c.portfoyPrim) + '</span></td>' +
        '<td style="text-align:right;padding:4px 5px;font-weight:700" title="MI &amp; GIGI matris katsayısı × 14.000 ₺ baz prim"><span style="' + _clr(c.migiKatsayi) + '">' + String(c.migiKatsayi).replace('.', ',') + 'x</span></td>' +
        '<td style="text-align:right;padding:4px 5px"><span style="' + _clr(c.migiPrim) + '">' + _tl(c.migiPrim) + '</span></td>' +
        '<td style="text-align:right;padding:4px 5px;font-weight:800;color:var(--c1)">' + _tl(c.toplamPrim) + '</td>')
        : '<td colspan="5"></td>';
      var kompNote = (r.komp && !r.komp.eligible && c && (pr.key === 'k1' || pr.key === 'k2'))
        ? '<div style="font-size:8px;color:#D97706;max-width:150px;white-space:normal">Komp. ek prim yok: ' + r.komp.reason + '</div>' : '';
      var leadTd = o.lead || ('<td style="padding:4px 5px;white-space:nowrap;font-weight:700">' + pr.label + '<div style="font-size:8px;font-weight:400;color:var(--dim)">' + pr.months + '</div>' +
          '<div style="font-size:8px;font-weight:400;color:var(--dim)" title="Ürün ağırlıkları (PANO/ACİD/GRİP/MOKS/FAMT)">⚖️ ' + _wText(r.wInfo) + '</div></td>');
      var tr = '<tr style="border-bottom:1px solid var(--border)' + (r.inProgress ? ';background:rgba(37,99,235,.05)' : '') + '">' +
        leadTd +
        '<td style="padding:4px 5px;font-size:10px;white-space:nowrap">' + _statusBadge(r) + '<div style="font-size:8px;color:var(--dim)">Ödeme: ' + (_ODEME[pr.key] || '') + ' son hafta</div>' + kompNote + '</td>' +
        cells + '<td style="text-align:right;padding:4px 5px">' + mi + '</td><td style="text-align:right;padding:4px 5px">' + gi + '</td>' + money +
        (o.edit ? '<td style="padding:4px 5px"><button title="Ürün % düzenle" onclick="pgToggleEdit(\'' + pr.key + '\')" style="border:1px solid var(--border);background:var(--surf);border-radius:5px;cursor:pointer;padding:2px 6px">✏️</button></td>' : '') + '</tr>';
      if (o.edit && _editKey === pr.key) tr += _editRowHtml(o.ttt, _year, r);
      return tr;
  }

  function renderPrimGecmis(ttt) {
    var body = document.getElementById('primGecmisBody');
    if (!body) return;
    ttt = (typeof ttt === 'string' && ttt) ? ttt : _ttt();
    if (!ttt) { body.innerHTML = '<div style="color:var(--dim);font-size:12px">Temsilci seçin…</div>'; return; }
    // Ürün bazlı dönem verisi: YTD_TL.csv (yüklü değilse arka planda çek, gelince yeniden çiz)
    if (!window.YTD_TL_DATA && typeof loadYtdTlData === 'function' && !window._pgYtdLoading) {
      window._pgYtdLoading = true;
      loadYtdTlData().then(function () { window._pgYtdLoading = false; if (window.YTD_TL_DATA && typeof calcPrim === 'function' && _ttt()) calcPrim(); else renderPrimGecmis(); })
                     .catch(function () { window._pgYtdLoading = false; });
    }
    if (window.PrimLedger) { try { window.PrimLedger.captureAll(typeof GENEL !== 'undefined' ? GENEL : []); } catch (e) { /* sessiz */ } }

    var years = _years();
    if (!_year || years.indexOf(_year) < 0) _year = years.indexOf(String(new Date().getFullYear())) >= 0 ? String(new Date().getFullYear()) : years[0];
    var eff = (typeof getEffectivePeriod === 'function') ? getEffectivePeriod() : null;
    var effKey = eff ? eff.key : null;

    // 2026 dışı yıllarda PERIODS tarihleri 2026 olduğundan satır iskeleti aynı dönem anahtarlarıyla kurulur
    var rows = _periods().map(function (p) {
      var pp = (_year === _yearOfPeriod(p)) ? p : Object.assign({}, p, { start: _year + p.start.slice(4), end: _year + p.end.slice(4) });
      return _calcRow(ttt, _year, pp, effKey);
    });

    var kesin = 0, tahmini = 0;
    rows.forEach(function (r) { if (r.calc) { if (r.mg) kesin += r.calc.toplamPrim; else if (!r.inProgress) tahmini += r.calc.toplamPrim; } });
    var trs = rows.map(function (r) { return _rowHtml(r, { edit: true, ttt: ttt }); }).join('');


    var yearSel = '<select class="inp" style="padding:4px 8px;font-size:11px" onchange="pgSetYear(this.value)">' +
      years.map(function (y) { return '<option value="' + y + '"' + (y === _year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>';

    body.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">' +
        '<div style="font-size:11px"><strong>' + _esc(ttt) + '</strong> · ' + yearSel + '</div>' +
        '<button onclick="PrimLedger.exportYear(\'' + _year + '\')" title="arsiv/ klasörüne commit edin — tüm cihazlar görsün" class="pv-dl pv-dl-sm">⬇️ Kayıtları indir (arsiv/)</button>' +
      '</div>' +
      '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;font-size:10.5px;border-collapse:collapse;min-width:960px">' +
        _theadHtml('Dönem', true) +
        '<tbody>' + trs + '</tbody></table></div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:11px">' +
        '<div>✅ Kesinleşen toplam: <strong style="color:#16A34A">' + _tl(kesin) + '</strong></div>' +
        '<div>⏳ MI&amp;GIGI bekleyen (tahmini): <strong style="color:#D97706">' + _tl(tahmini) + '</strong></div>' +
      '</div>' +
      '<div style="font-size:9px;color:var(--dim);background:var(--surf2);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:8px">' +
        '* Prim, dönem bitiminden 2 ay sonra gelen (düzeltilmiş IMS\'li) MI &amp; GIGI ile kesinleşir. Gelene kadar sistemdeki MI ve GIGI (Grup İçi Gelişim İndeksi) verisinden otomatik tahmin edilir (≈); veri yoksa 100* varsayılır. ' +
        'TL Real, Prim Puanı, MI ve GIGI tam sayıya yuvarlanır (en yakın; 75,9→76 · 96,45→96 · 34,51→35); ham değer üzerine gelince görünür. MI &amp; GIGI kaynağı: <code>MI_GIGI.csv</code> (ham veriden formülle hesaplanır). Ürün bazlı hedef/satış/real değerleri <code>YTD_TL.csv</code> dosyasındaki dönem bloklarından okunur (manuel giriş gerekmez); ✏️ yalnızca o dosyada olmayan bir dönemi elle düzeltmek içindir.' +
      '</div>';
  }

  // ── Etkileşim ────────────────────────────────────────────
  window.pgSetYear = function (y) { _year = y; _editKey = null; renderPrimGecmis(); };
  window.pgToggleEdit = function (key) { _editKey = (_editKey === key) ? null : key; renderPrimGecmis(); };
  window.pgSaveEdit = function (key) {
    var ttt = _ttt(), vals = {};
    document.querySelectorAll('#primGecmisBody .pg-in').forEach(function (el) { vals[el.getAttribute('data-u')] = el.value === '' ? '' : parseFloat(el.value); });
    var g = parseFloat((document.getElementById('pgGenelIn') || {}).value);
    if (window.PrimLedger.setManual(_year, key, ttt, vals, g)) { _editKey = null; renderPrimGecmis(); }
    else alert('En az bir ürün % veya GENEL TL Real % girin.');
  };
  window.pgSaveWeights = function (key) {
    var w = {}, sum = 0;
    document.querySelectorAll('#primGecmisBody .pg-w').forEach(function (el) { var v = parseFloat(el.value); w[el.getAttribute('data-u')] = isNaN(v) ? 0 : v / 100; sum += isNaN(v) ? 0 : v; });
    if (Math.abs(sum - 100) > 0.6 && !confirm('Ağırlıkların toplamı %' + sum.toFixed(1) + ' (100 olmalı). Yine de kaydedilsin mi? (100\'e orantılanır)')) return;
    if (window.PrimLedger.setWeights(_year, key, w)) renderPrimGecmis(); else alert('Ağırlık kaydedilemedi.');
  };
  window.pgClearWeights = function (key) {
    if (!confirm('Bu dönemin elle girilen ağırlıkları silinip varsayılana dönülsün mü?')) return;
    window.PrimLedger.clearWeights(_year, key); renderPrimGecmis();
  };
  window.pgClearEdit = function (key) {
    if (!confirm('Bu dönemin manuel kaydı silinsin mi? (Arşiv/sync kaydı varsa otomatik geri gelir.)')) return;
    window.PrimLedger.remove(_year, key, _ttt()); _editKey = null; renderPrimGecmis();
  };

  // ── Prim Hesaplama Şablonu: MI & GIGI otomatik doldurma ──────────────
  // Kesin MI_GIGI.csv değeri varsa o; yoksa sistem verisinden tahmin. Kullanıcı elle
  // değiştirirse otomatik doldurma durur (↺ ile geri dönülür); temsilci değişince sıfırlanır.
  var _miGiManual = false, _miGiLastTTT = null;
  window.primMiGiManual = function (el) {
    _miGiManual = !(el && el.value === '');          // alan boşaltılırsa tekrar otomatiğe dön
  };
  window.primMiGiReset = function () { _miGiManual = false; if (typeof calcPrim === 'function') calcPrim(); };
  window.applyPrimMiGiAuto = function (ttt) {
    var miEl = document.getElementById('primMI'), giEl = document.getElementById('primGI'), src = document.getElementById('primMiGiSrc');
    if (!miEl || !giEl) return;
    if (ttt !== _miGiLastTTT) { _miGiLastTTT = ttt; _miGiManual = false; }
    var a = (typeof getMiGiOtomatik === 'function') ? getMiGiOtomatik(ttt) : null;
    if (!_miGiManual && a) { miEl.value = a.mi.toFixed(1); giEl.value = a.gi.toFixed(1); }
    if (!src) return;
    if (_miGiManual) {
      src.innerHTML = '✏️ Elle girildi · <a href="javascript:void(0)" onclick="primMiGiReset()" style="color:var(--c1)">↺ Otomatiğe dön</a>';
    } else if (!a) {
      src.innerHTML = '⚠️ Sistemde bu temsilci için MI &amp; GIGI verisi yok — 100 varsayılıyor, elle girebilirsiniz.';
    } else if (a.source === 'final') {
      src.innerHTML = '✅ Kesinleşmiş MI &amp; GIGI (MI_GIGI.csv)';
    } else {
      src.innerHTML = '🔄 Otomatik tahmin — sistem verisi (' + _donemAdi(a.donem) + (a.giFallback ? ', GIGI için veri yok → 100' : '') + '). ' + (a.giNote ? a.giNote + '. ' : '') + 'Kesinleşmiş IMS gelince otomatik güncellenir.';
    }
  };

  // ══════════════════════════════════════════════════════════════════
  //  YÖNETİCİ PANELİ (Prim Takip) için SALT-OKUNUR görünüm
  //  Temsilci sayfasındaki "Geçmiş Dönem Prim Hesabı" ile AYNI hesap (_calcRow / _rowHtml);
  //  ✏️ düzenleme yok. Filtre: temsilci (boş = tüm ekip) · yıl · dönem (boş = tüm dönemler).
  //    • temsilci seçili           → dönem satırları (temsilci sayfasındaki tablo)
  //    • tüm ekip + tek dönem      → temsilci satırları
  //    • tüm ekip + tüm dönemler   → temsilci × dönem toplam prim matrisi
  //  Kullanım: PrimGecmisMgr.build({ttt, year, period}) → HTML (js/ui/prim-takip-page.js)
  // ══════════════════════════════════════════════════════════════════
  function _periodFor(p, year) {
    return (year === _yearOfPeriod(p)) ? p : Object.assign({}, p, { start: year + p.start.slice(4), end: year + p.end.slice(4) });
  }
  function _jsq(s) { return _esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }

  var _mgrLoading = false;
  function mgrEnsure(cb) {
    if (window.YTD_TL_DATA || typeof loadYtdTlData !== 'function' || _mgrLoading) return;
    _mgrLoading = true;
    loadYtdTlData().then(function () { _mgrLoading = false; if (cb) cb(); })
                   .catch(function () { _mgrLoading = false; });
  }

  function _sumRows(rows) {
    var kesin = 0, tahmini = 0;
    rows.forEach(function (r) { if (r.calc) { if (r.mg) kesin += r.calc.toplamPrim; else if (!r.inProgress) tahmini += r.calc.toplamPrim; } });
    return { kesin: kesin, tahmini: tahmini };
  }

  function mgrBuild(o) {
    o = o || {};
    var years = _years();
    var year = (o.year && years.indexOf(o.year) >= 0) ? o.year : (years.indexOf(String(new Date().getFullYear())) >= 0 ? String(new Date().getFullYear()) : years[0]);
    var eff = (typeof getEffectivePeriod === 'function') ? getEffectivePeriod() : null;
    var effKey = eff ? eff.key : null;
    var allP = _periods();
    var selP = o.period ? allP.filter(function (p) { return p.key === o.period; }) : allP;
    var ttts = o.ttt ? [o.ttt] : ((typeof ALL_TTTS !== 'undefined') ? ALL_TTTS.slice() : []);
    var wrap = function (inner) { return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">' + inner + '</div>'; };
    var note = '';
    if (!window.YTD_TL_DATA) note = '<div style="font-size:10px;color:var(--dim);margin-bottom:6px">Ürün bazlı dönem verisi (YTD_TL.csv) yükleniyor…</div>';

    var html;
    if (o.ttt || o.period) {
      // A) tek temsilci → dönem satırları · B) tüm ekip + tek dönem → temsilci satırları
      var rows = [], leads = [];
      if (o.ttt) {
        selP.forEach(function (p) { rows.push(_calcRow(o.ttt, year, _periodFor(p, year), effKey)); leads.push(null); });
      } else {
        var pp = _periodFor(selP[0], year);
        ttts.forEach(function (t) {
          var r = _calcRow(t, year, pp, effKey);
          rows.push(r);
          leads.push('<td style="padding:4px 5px;white-space:nowrap;font-weight:700"><a href="javascript:void(0)" onclick="ptSetFilter(\'ttt\',\'' + _jsq(t) + '\')" style="color:var(--c1);text-decoration:none" title="Bu temsilcinin tüm dönemlerini göster">' + _esc(t) + '</a>' +
            '<div style="font-size:8px;font-weight:400;color:var(--dim)">' + _esc(pp.label) + ' · ' + _esc(pp.months) + '</div></td>');
        });
      }
      var s = _sumRows(rows);
      var trs = rows.map(function (r, i) { return _rowHtml(r, { edit: false, lead: leads[i] || undefined }); }).join('');
      html = note + wrap('<table style="width:100%;font-size:10.5px;border-collapse:collapse;min-width:960px">' +
          _theadHtml(o.ttt ? 'Dönem' : 'Temsilci', false) + '<tbody>' + trs + '</tbody></table>') +
        '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:11px">' +
          '<div>✅ Kesinleşen toplam: <strong style="color:#16A34A">' + _tl(s.kesin) + '</strong></div>' +
          '<div>⏳ MI&amp;GIGI bekleyen (tahmini): <strong style="color:#D97706">' + _tl(s.tahmini) + '</strong></div>' +
        '</div>';
    } else {
      // C) tüm ekip + tüm dönemler → temsilci × dönem toplam prim
      var head = '<thead><tr style="border-bottom:2px solid var(--c1)"><th style="text-align:left;padding:4px 6px;font-size:9px">Temsilci</th>' +
        allP.map(function (p) {
          return '<th style="text-align:right;padding:4px 6px;font-size:9px;white-space:nowrap"><a href="javascript:void(0)" onclick="ptSetFilter(\'period\',\'' + _jsq(p.key) + '\')" style="color:inherit;text-decoration:none" title="Sadece bu dönemi göster">' + _esc(p.label) + '</a>' +
            '<div style="font-size:8px;font-weight:400;color:var(--dim)">' + _esc(p.months) + '</div></th>';
        }).join('') +
        '<th style="text-align:right;padding:4px 6px;font-size:9px;white-space:nowrap">✅ Kesinleşen</th><th style="text-align:right;padding:4px 6px;font-size:9px;white-space:nowrap">⏳ Tahmini</th></tr></thead>';
      var colK = allP.map(function () { return 0; }), colT = allP.map(function () { return 0; });
      var totK = 0, totT = 0;
      var body = ttts.map(function (t) {
        var rs = allP.map(function (p) { return _calcRow(t, year, _periodFor(p, year), effKey); });
        var sm = _sumRows(rs);
        totK += sm.kesin; totT += sm.tahmini;
        var tds = rs.map(function (r, i) {
          var c = r.calc;
          if (!c) return '<td style="text-align:right;padding:4px 6px;color:var(--dim)">—</td>';
          if (r.inProgress) return '<td style="text-align:right;padding:4px 6px;color:#2563EB;font-size:10px" title="Dönem sürüyor">▶ devam</td>';
          if (r.mg) { colK[i] += c.toplamPrim; return '<td style="text-align:right;padding:4px 6px;font-weight:700;color:#16A34A" title="Kesinleşti">' + _tl(c.toplamPrim) + '</td>'; }
          colT[i] += c.toplamPrim;
          var nd = (typeof window.getMiGiNeden === 'function') ? window.getMiGiNeden(r.ttt, r.year, r.p.key) : '';
          return '<td style="text-align:right;padding:4px 6px;color:#D97706" title="Tahmini (MI&amp;GIGI bekleniyor)' + (nd ? ' — ' + _esc(nd) : '') + '">≈ ' + _tl(c.toplamPrim) + '</td>';
        }).join('');
        return '<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 6px;white-space:nowrap;font-weight:700"><a href="javascript:void(0)" onclick="ptSetFilter(\'ttt\',\'' + _jsq(t) + '\')" style="color:var(--c1);text-decoration:none" title="Bu temsilcinin dönem detayını göster">' + _esc(t) + '</a></td>' + tds +
          '<td style="text-align:right;padding:4px 6px;font-weight:700;color:#16A34A">' + _tl(sm.kesin) + '</td><td style="text-align:right;padding:4px 6px;color:#D97706">' + _tl(sm.tahmini) + '</td></tr>';
      }).join('');
      var foot = '<tr style="border-top:2px solid var(--c1);background:rgba(79,0,140,.05)"><td style="padding:4px 6px;font-weight:800;color:var(--c1)">EKİP TOPLAMI</td>' +
        allP.map(function (p, i) { return '<td style="text-align:right;padding:4px 6px;font-weight:700">' + (colK[i] || colT[i] ? _tl(colK[i] + colT[i]) : '—') + '</td>'; }).join('') +
        '<td style="text-align:right;padding:4px 6px;font-weight:800;color:#16A34A">' + _tl(totK) + '</td><td style="text-align:right;padding:4px 6px;font-weight:800;color:#D97706">' + _tl(totT) + '</td></tr>';
      html = note + wrap('<table style="width:100%;font-size:11px;border-collapse:collapse;min-width:760px">' + head + '<tbody>' + body + foot + '</tbody></table>') +
        '<div style="font-size:10px;color:var(--dim);margin-top:6px">Temsilci adına tıkla → dönem dönem detay · dönem başlığına tıkla → o dönemin ekip tablosu.</div>';
    }
    return html +
      '<div style="font-size:9px;color:var(--dim);background:var(--surf2);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:8px">' +
        '* Prim, dönem bitiminden 2 ay sonra gelen (düzeltilmiş IMS\'li) MI &amp; GIGI ile kesinleşir; gelene kadar sistemdeki MI/GIGI verisinden tahmin edilir (≈), veri yoksa 100*. ' +
        'Hesap, temsilcinin kendi sayfasındaki Geçmiş Dönem tablosuyla aynıdır; kompanzasyon ek primi (3. ve 6. dönem) TL Real Primi hücresinde "(+… komp.)" olarak görünür.' +
      '</div>';
  }

  // ── AÇILIR TEMSİLCİ TABLOSU (Yönetici › Geçmiş Dönem Prim Hesabı) ──────────────────────
  //  Filtre YOK: tüm ekip, temsilci × dönem toplam prim matrisi olarak gelir; bir temsilci satırına tıklayınca
  //  (Temsilci Prim Takibi — Güncel Dönem ile aynı idiyom) altında o temsilcinin dönem dönem tam dökümü açılır
  //  (temsilci sayfasındaki tabloyla AYNI hesap: _calcRow / _rowHtml). Açık satırlar o.open[ttt] ile gelir;
  //  tıklama window.ptHistToggle(ttt) (js/ui/prim-takip-page.js) ile yönetilir.
  function mgrBuildTeam(o) {
    o = o || {};
    var years = _years();
    var year = (o.year && years.indexOf(o.year) >= 0) ? o.year : (years.indexOf(String(new Date().getFullYear())) >= 0 ? String(new Date().getFullYear()) : years[0]);
    var open = o.open || {};
    var eff = (typeof getEffectivePeriod === 'function') ? getEffectivePeriod() : null;
    var effKey = eff ? eff.key : null;
    var allP = _periods();
    var ttts = (typeof ALL_TTTS !== 'undefined') ? ALL_TTTS.slice() : [];
    var note = window.YTD_TL_DATA ? '' : '<div style="font-size:10px;color:var(--dim);margin-bottom:6px">Ürün bazlı dönem verisi (YTD_TL.csv) yükleniyor…</div>';
    var nCol = allP.length + 3;

    var head = '<thead><tr style="border-bottom:2px solid var(--c1)"><th style="text-align:left;padding:4px 6px;font-size:9px">Temsilci</th>' +
      allP.map(function (p) {
        return '<th style="text-align:right;padding:4px 6px;font-size:9px;white-space:nowrap">' + _esc(p.label) +
          '<div style="font-size:8px;font-weight:400;color:var(--dim)">' + _esc(p.months) + '</div></th>';
      }).join('') +
      '<th style="text-align:right;padding:4px 6px;font-size:9px;white-space:nowrap">✅ Kesinleşen</th><th style="text-align:right;padding:4px 6px;font-size:9px;white-space:nowrap">⏳ Tahmini</th></tr></thead>';

    var colK = allP.map(function () { return 0; }), colT = allP.map(function () { return 0; });
    var totK = 0, totT = 0;
    var body = ttts.map(function (t) {
      var rs = allP.map(function (p) { return _calcRow(t, year, _periodFor(p, year), effKey); });
      var sm = _sumRows(rs);
      totK += sm.kesin; totT += sm.tahmini;
      var isOpen = !!open[t];
      var tds = rs.map(function (r, i) {
        var c = r.calc;
        if (!c) return '<td style="text-align:right;padding:4px 6px;color:var(--dim)">—</td>';
        if (r.inProgress) return '<td style="text-align:right;padding:4px 6px;color:#2563EB;font-size:10px" title="Dönem sürüyor">▶ devam</td>';
        if (r.mg) { colK[i] += c.toplamPrim; return '<td style="text-align:right;padding:4px 6px;font-weight:700;color:#16A34A" title="Kesinleşti">' + _tl(c.toplamPrim) + '</td>'; }
        colT[i] += c.toplamPrim;
        var nd = (typeof window.getMiGiNeden === 'function') ? window.getMiGiNeden(r.ttt, r.year, r.p.key) : '';
        return '<td style="text-align:right;padding:4px 6px;color:#D97706" title="Tahmini (MI&amp;GIGI bekleniyor)' + (nd ? ' — ' + _esc(nd) : '') + '">≈ ' + _tl(c.toplamPrim) + '</td>';
      }).join('');
      var line = '<tr style="cursor:pointer;border-bottom:1px solid var(--border)" onclick="ptHistToggle(\'' + _jsq(t) + '\')">' +
        '<td style="padding:4px 6px;white-space:nowrap;font-weight:700">' + (isOpen ? '▾ ' : '▸ ') + _esc(t) + '</td>' + tds +
        '<td style="text-align:right;padding:4px 6px;font-weight:700;color:#16A34A">' + _tl(sm.kesin) + '</td><td style="text-align:right;padding:4px 6px;color:#D97706">' + _tl(sm.tahmini) + '</td></tr>';
      if (isOpen) {
        var trs = rs.map(function (r) { return _rowHtml(r, { edit: false }); }).join('');
        // sticky + min(): dar ekranda detay kutusu görünür genişlikte kalır, içindeki geniş tablo kendi içinde kayar
        line += '<tr><td colspan="' + nCol + '" style="background:rgba(79,0,140,.03);padding:8px 10px">' +
          '<div style="position:sticky;left:0;box-sizing:border-box;width:min(100%,calc(100vw - 64px))">' +
          '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;font-size:10.5px;border-collapse:collapse;min-width:960px">' +
            _theadHtml('Dönem', false) + '<tbody>' + trs + '</tbody></table></div>' +
          '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:11px">' +
            '<div>✅ Kesinleşen toplam: <strong style="color:#16A34A">' + _tl(sm.kesin) + '</strong></div>' +
            '<div>⏳ MI&amp;GIGI bekleyen (tahmini): <strong style="color:#D97706">' + _tl(sm.tahmini) + '</strong></div>' +
          '</div></div></td></tr>';
      }
      return line;
    }).join('');

    var foot = '<tr style="border-top:2px solid var(--c1);background:rgba(79,0,140,.05)"><td style="padding:4px 6px;font-weight:800;color:var(--c1)">EKİP TOPLAMI</td>' +
      allP.map(function (p, i) { return '<td style="text-align:right;padding:4px 6px;font-weight:700">' + (colK[i] || colT[i] ? _tl(colK[i] + colT[i]) : '—') + '</td>'; }).join('') +
      '<td style="text-align:right;padding:4px 6px;font-weight:800;color:#16A34A">' + _tl(totK) + '</td><td style="text-align:right;padding:4px 6px;font-weight:800;color:#D97706">' + _tl(totT) + '</td></tr>';

    return note + '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;font-size:11px;border-collapse:collapse;min-width:760px">' + head + '<tbody>' + body + foot + '</tbody></table></div>' +
      '<div style="font-size:10px;color:var(--dim);margin-top:6px">Temsilci satırına tıkla → dönem dönem MI&amp;GIGI / prim dökümü.</div>' +
      '<div style="font-size:9px;color:var(--dim);background:var(--surf2);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:8px">' +
        '* Prim, dönem bitiminden 2 ay sonra gelen (düzeltilmiş IMS\'li) MI &amp; GIGI ile kesinleşir; gelene kadar sistemdeki MI/GIGI verisinden tahmin edilir (≈), veri yoksa 100*. ' +
        'Hesap, temsilcinin kendi sayfasındaki Geçmiş Dönem tablosuyla aynıdır; kompanzasyon ek primi (3. ve 6. dönem) TL Real Primi hücresinde "(+… komp.)" olarak görünür.' +
      '</div>';
  }

  window.PrimGecmisMgr = {
    years: _years,
    periods: function () { return _periods().map(function (p) { return { key: p.key, label: p.label, months: p.months }; }); },
    ensure: mgrEnsure,
    build: mgrBuild,
    buildTeam: mgrBuildTeam
  };

  window.renderPrimGecmis = renderPrimGecmis;
})();
