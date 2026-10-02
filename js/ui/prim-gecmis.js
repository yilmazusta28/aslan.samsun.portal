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
  function _pct(v) { return (v == null) ? '—' : v.toFixed(1).replace('.', ',') + '%'; }
  function _clr(v) { return v > 0 ? 'color:#16A34A;font-weight:700' : 'color:#DC2626;font-weight:700'; }
  var _AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  function _donemAdi(d) { var p = String(d || '').split('/'); return p.length === 2 ? (_AY[(+p[0]) - 1] + ' ' + p[1]) : '—'; }
  // PDF "Ödeme Takvimi" (baz IMS: dönem sonu +2 ay kesinleşmiş)
  var _ODEME = { '1d': 'Mayıs', '2d': 'Temmuz', 'k1': 'Eylül', '4d': 'Kasım', '5d': 'Ocak (Ertesi yıl)', 'k2': 'Mart (Ertesi yıl)' };
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
    var row = { p: p, rec: rec, mg: mg, auto: auto, inProgress: inProgress, calc: null, komp: null };
    if (!rec) return row;

    var effReal = rec.genel.tl_pct || 0;
    var primPuani = rec.genel.prim_pct || window.PrimLedger.primPuani(rec.urunler);

    // Kompanzasyon Ek Primi (sadece k1/k2): önceki 2 dönemin ledger kaydı gerekli
    var ek = 0;
    if (p.key === 'k1' || p.key === 'k2') {
      var sib = p.key === 'k1' ? ['1d', '2d'] : ['4d', '5d'];
      var rows = sib.map(function (k) { var r = window.PrimLedger.get(year, k, ttt); return r ? r.genel : null; });
      if (rows.every(Boolean)) {
        row.komp = calcKompEkFromRows(rows.concat([rec.genel]));
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

  function _statusBadge(r) {
    if (r.mg && r.rec) return '<span style="color:#16A34A;font-weight:700">✅ Kesinleşti</span>';
    if (r.mg && !r.rec) return '<span style="color:#D97706;font-weight:700">📥 MI&amp;GIGI var, ürün % yok</span>';
    if (r.inProgress) return '<span style="color:#2563EB;font-weight:700">▶ Devam ediyor</span>';
    if (r.rec) return '<span style="color:#D97706;font-weight:700">⏳ Tahmini (' + (r.auto ? 'sistem MI/GIGI' : 'MI=GIGI=100') + ')</span>';
    return '<span style="color:var(--dim)">— Veri yok</span>';
  }

  function _editRowHtml(ttt, year, r) {
    var inputs = URUN_ORDER.map(function (u) {
      var v = r.rec && r.rec.urunler[u] ? r.rec.urunler[u].tl_pct : '';
      return '<div><label style="font-size:9px;font-weight:700;color:' + (URUN_CLR[u] || '#444') + ';display:block">' + u + '</label>' +
        '<input type="number" step="0.1" min="0" max="200" class="inp pg-in" data-u="' + u + '" value="' + v + '" style="width:80px;padding:4px 6px" placeholder="%"></div>';
    }).join('');
    var gv = r.rec && r.rec.source === 'manuel' ? r.rec.genel.tl_pct : '';
    return '<tr><td colspan="14" style="background:var(--surf2);padding:10px;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:10px;font-weight:700;margin-bottom:6px">✏️ ' + r.p.label + ' — ürün bazlı TL Real % (resmi sonuç tablosundan)</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">' + inputs +
      '<div><label style="font-size:9px;font-weight:700;display:block">GENEL TL Real % <span style="font-weight:400;color:var(--dim)">(boşsa ağırlıklı ort.)</span></label>' +
      '<input type="number" step="0.1" min="0" max="200" class="inp" id="pgGenelIn" value="' + gv + '" style="width:90px;padding:4px 6px"></div>' +
      '<button onclick="pgSaveEdit(\'' + r.p.key + '\')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--c1);background:var(--c1);color:#fff;font-size:11px;font-weight:600;cursor:pointer">💾 Kaydet</button>' +
      (r.rec && r.rec.source === 'manuel' ? '<button onclick="pgClearEdit(\'' + r.p.key + '\')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surf);font-size:11px;cursor:pointer">🗑 Manuel kaydı sil</button>' : '') +
      '</div>' + (r.rec ? '<div style="font-size:9px;color:var(--dim);margin-top:6px">Mevcut kayıt kaynağı: ' + r.rec.source + (r.rec.savedAt ? ' · ' + String(r.rec.savedAt).slice(0, 10) : '') + '</div>' : '') +
      '</td></tr>';
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
    var trs = rows.map(function (r) {
      var c = r.calc, pr = r.p;
      var cells;
      if (c) {
        if (r.mg) kesin += c.toplamPrim; else if (!r.inProgress) tahmini += c.toplamPrim;
        var urunCells = URUN_ORDER.map(function (u) {
          var x = r.rec.urunler[u];
          return '<td style="text-align:right;padding:4px 5px">' + (x ? _pct(x.tl_pct) : '—') + '</td>';
        }).join('');
        cells = '<td style="text-align:right;padding:4px 5px;font-weight:700">' + _pct(r.effReal) + '</td>' + urunCells +
          '<td style="text-align:right;padding:4px 5px" title="' + (r.rec.agirlikTahmini ? 'Bu dönemin resmi ürün ağırlıkları sistemde yok; tahmini ağırlıkla hesaplandı (portföy eşiği %91 etkilenebilir)' : 'Resmi ürün ağırlıklarıyla') + '">' + (r.rec.agirlikTahmini ? '≈' : '') + _pct(r.primPuani) + '</td>';
      } else {
        cells = '<td colspan="7" style="text-align:center;color:var(--dim);padding:4px 5px">Ürün bazlı veri yok (YTD_TL.csv içinde bu dönem için hedef bulunamadı)</td>';
      }
      var _aTip = r.auto ? ('Sistem verisinden tahmin — MI: ' + _donemAdi(r.auto.donem) + ' YTD' + (r.auto.giNote ? '; ' + r.auto.giNote : (r.auto.giFallback ? '; GIGI=100 varsayıldı' : '')) + ' — kesinleşmiş IMS gelince değişir') : '';
      var mi = r.mg ? '<span style="color:' + getIndeksColor(r.mg.mi) + ';font-weight:700">' + r.mg.mi.toFixed(1).replace('.', ',') + '%</span>'
        : (r.auto ? '<span title="' + _aTip + '" style="color:var(--dim)">≈' + r.auto.mi.toFixed(1).replace('.', ',') + '%</span>' : '<span style="color:var(--dim)">' + (c ? '100*' : '—') + '</span>');
      var gi = r.mg ? '<span style="color:' + getIndeksColor(r.mg.gi) + ';font-weight:700">' + r.mg.gi.toFixed(1).replace('.', ',') + '</span>'
        : (r.auto ? '<span title="' + _aTip + '" style="color:var(--dim)">≈' + r.auto.gi.toFixed(1).replace('.', ',') + '</span>' : '<span style="color:var(--dim)">' + (c ? '100*' : '—') + '</span>');
      var money = c ? ('<td style="text-align:right;padding:4px 5px"><span style="' + _clr(c.tlRealPrim) + '">' + _tl(c.tlRealPrim) + '</span>' +
          (c.ekPrim > 0 ? '<div style="font-size:8px;color:var(--dim)" title="' + (r.komp && r.komp.detail && r.komp.detail.approx ? 'Manuel girilen dönemlerde hedef/satış TL yok: kümülatif real, dönem real ortalamasından yaklaşık hesaplandı' : 'Kompanzasyon Ek Primi') + '">(+' + _tl(c.ekPrim) + ' komp.' + (r.komp && r.komp.detail && r.komp.detail.approx ? ' ≈' : '') + ')</div>' : '') + '</td>' +
        '<td style="text-align:right;padding:4px 5px"><span style="' + _clr(c.portfoyPrim) + '">' + _tl(c.portfoyPrim) + '</span></td>' +
        '<td style="text-align:right;padding:4px 5px"><span style="' + _clr(c.migiPrim) + '">' + _tl(c.migiPrim) + '</span><div style="font-size:8px;color:var(--dim)">' + c.migiKatsayi + 'x</div></td>' +
        '<td style="text-align:right;padding:4px 5px;font-weight:800;color:var(--c1)">' + _tl(c.toplamPrim) + '</td>')
        : '<td colspan="4"></td>';
      var kompNote = (r.komp && !r.komp.eligible && c && (pr.key === 'k1' || pr.key === 'k2'))
        ? '<div style="font-size:8px;color:#D97706;max-width:150px;white-space:normal">Komp. ek prim yok: ' + r.komp.reason + '</div>' : '';
      var tr = '<tr style="border-bottom:1px solid var(--border)' + (r.inProgress ? ';background:rgba(37,99,235,.05)' : '') + '">' +
        '<td style="padding:4px 5px;white-space:nowrap;font-weight:700">' + pr.label + '<div style="font-size:8px;font-weight:400;color:var(--dim)">' + pr.months + '</div></td>' +
        '<td style="padding:4px 5px;font-size:10px;white-space:nowrap">' + _statusBadge(r) + '<div style="font-size:8px;color:var(--dim)">Ödeme: ' + (_ODEME[pr.key] || '') + ' son hafta</div>' + kompNote + '</td>' +
        cells + '<td style="text-align:right;padding:4px 5px">' + mi + '</td><td style="text-align:right;padding:4px 5px">' + gi + '</td>' + money +
        '<td style="padding:4px 5px"><button title="Ürün % düzenle" onclick="pgToggleEdit(\'' + pr.key + '\')" style="border:1px solid var(--border);background:var(--surf);border-radius:5px;cursor:pointer;padding:2px 6px">✏️</button></td></tr>';
      if (_editKey === pr.key) tr += _editRowHtml(ttt, _year, r);
      return tr;
    }).join('');

    var th = function (t, extra) { return '<th style="text-align:right;padding:4px 5px;font-size:9px;white-space:nowrap;' + (extra || '') + '" >' + t + '</th>'; };
    var urunHeads = URUN_ORDER.map(function (u) {
      return '<th title="' + u + '" style="text-align:right;padding:4px 5px;font-size:9px;white-space:nowrap;color:' + (URUN_CLR[u] || 'inherit') + '">' + u.split(' ')[0].slice(0, 5) + '</th>';
    }).join('');

    var yearSel = '<select class="inp" style="padding:4px 8px;font-size:11px" onchange="pgSetYear(this.value)">' +
      years.map(function (y) { return '<option value="' + y + '"' + (y === _year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>';

    body.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">' +
        '<div style="font-size:11px"><strong>' + ttt + '</strong> · ' + yearSel + '</div>' +
        '<button onclick="PrimLedger.exportYear(\'' + _year + '\')" title="arsiv/ klasörüne commit edin — tüm cihazlar görsün" style="padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surf);font-size:10px;cursor:pointer">⬇️ Kayıtları indir (arsiv/)</button>' +
      '</div>' +
      '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;font-size:10.5px;border-collapse:collapse;min-width:900px">' +
        '<thead><tr style="border-bottom:2px solid var(--c1)"><th style="text-align:left;padding:4px 5px;font-size:9px">Dönem</th><th style="text-align:left;padding:4px 5px;font-size:9px">Durum</th>' +
        th('TL Real') + urunHeads + th('Prim Puanı') + th('MI') + th('GIGI') + th('TL Real Primi') + th('Portföy') + th('MI&amp;GI Primi') + th('TOPLAM') + '<th></th></tr></thead>' +
        '<tbody>' + trs + '</tbody></table></div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:11px">' +
        '<div>✅ Kesinleşen toplam: <strong style="color:#16A34A">' + _tl(kesin) + '</strong></div>' +
        '<div>⏳ MI&amp;GIGI bekleyen (tahmini): <strong style="color:#D97706">' + _tl(tahmini) + '</strong></div>' +
      '</div>' +
      '<div style="font-size:9px;color:var(--dim);background:var(--surf2);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:8px">' +
        '* Prim, dönem bitiminden 2 ay sonra gelen (düzeltilmiş IMS\'li) MI &amp; GIGI ile kesinleşir. Gelene kadar sistemdeki MI ve GIGI (Grup İçi Gelişim İndeksi) verisinden otomatik tahmin edilir (≈); veri yoksa 100* varsayılır. ' +
        'MI &amp; GIGI kaynağı: <code>MI_GIGI.csv</code>. Ürün bazlı hedef/satış/real değerleri <code>YTD_TL.csv</code> dosyasındaki dönem bloklarından okunur (manuel giriş gerekmez); ✏️ yalnızca o dosyada olmayan bir dönemi elle düzeltmek içindir.' +
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

  window.renderPrimGecmis = renderPrimGecmis;
})();
