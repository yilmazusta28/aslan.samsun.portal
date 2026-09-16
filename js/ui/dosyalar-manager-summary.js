// ══════════════════════════════════════════════════════════════════════
//  js/ui/dosyalar-manager-summary.js
//  FAZ 22.1 — Yönetici Paneli (page7) › "📁 Dosyalar Özeti" kartı
//
//  SORUN: "Dosyalar" sayfasına (page9) girilen masraf/kongre kayıtları
//  yalnızca o sayfada listeleniyordu. ŞENOL YILMAZ girişinde uygulama
//  doğrudan Yönetici sayfasına (page7) düştüğü için (bkz. index.html
//  LOGIN bloğu, goPage(7)) Bölge Müdürü bu kayıtları hiç görmüyordu.
//
//  ÇÖZÜM: Yönetici panelinin "Saha Yönetimi" bölümüne, temsilci bazında
//  kayıt sayısı + toplam masraf gösteren salt-okunur bir özet kartı.
//  "Detay" butonu ilgili Dosyalar sekmesine geçirir (goPage(9)).
//
//  Veri kaynağı: js/ui/dosyalar-page.js › window.PV_DOSYALAR_API
//  (GitHub raw + localStorage birleşimi — AYNI mantık, veri kopyalanmadı).
//  Bu dosya HİÇBİR yazma işlemi yapmaz; sadece okur ve gösterir.
//
//  Yükleme sırası: dosyalar-page.js'den SONRA.
//  Rollback: index.html'den bu script satırını, page7'deki
//  #mgrDosyalarOzet kartını ve goPage(7) içindeki çağrıyı sil.
//  GitHub Pages compatible: classic script, no ES modules.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._DOSYALAR_MGR_SUMMARY_LOADED) {
    console.warn('[dosyalar-mgr] Zaten yüklü — atlandı');
    return;
  }
  window._DOSYALAR_MGR_SUMMARY_LOADED = true;

  var TIP_SIRA = ['temsil', 'planlanan', 'gerceklesen', 'kongre'];
  var TIP_KISA = {
    temsil:      'Temsil',
    planlanan:   'Planlanan',
    gerceklesen: 'Gerçekleşen',
    kongre:      'Kongre'
  };
  // Hangi tipte hangi alan "masraf" sayılır:
  //   temsil → butce, planlanan/gerceklesen → maliyet, kongre → (parasal alan yok)
  var TIP_TUTAR_ALANI = { temsil: 'butce', planlanan: 'maliyet', gerceklesen: 'maliyet' };

  function _fmtTL(v) {
    if (typeof fTL === 'function') return fTL(v || 0);
    return (Math.round(v || 0)).toLocaleString('tr-TR') + ' ₺';
  }

  function _tipOf(r) {
    if (window.PV_DOSYALAR_API && typeof window.PV_DOSYALAR_API.tipOf === 'function') {
      return window.PV_DOSYALAR_API.tipOf(r);
    }
    return (r && r.tip) ? r.tip : 'gerceklesen';
  }

  // ── Temsilci bazında özet tablosu kur ─────────────────────────────────
  function _ozetHesapla(all) {
    var byTTT = {};
    (all || []).forEach(function (r) {
      if (!r) return;
      var ttt = r.ttt || '—';
      if (!byTTT[ttt]) {
        byTTT[ttt] = { ttt: ttt, toplamTutar: 0, sonKayit: '', adet: { temsil: 0, planlanan: 0, gerceklesen: 0, kongre: 0 } };
      }
      var tip = _tipOf(r);
      if (byTTT[ttt].adet[tip] === undefined) byTTT[ttt].adet[tip] = 0;
      byTTT[ttt].adet[tip]++;

      var alan = TIP_TUTAR_ALANI[tip];
      if (alan) byTTT[ttt].toplamTutar += (parseFloat(r[alan]) || 0);

      var ts = r.enteredAt || r.syncedAt || '';
      if (ts > byTTT[ttt].sonKayit) byTTT[ttt].sonKayit = ts;
    });

    return Object.keys(byTTT).map(function (k) { return byTTT[k]; })
      .sort(function (a, b) { return b.toplamTutar - a.toplamTutar; });
  }

  function _tarihKisa(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('tr-TR') + ' ' + d.toTimeString().slice(0, 5);
    } catch (e) { return '—'; }
  }

  function _tabloHtml(rows) {
    if (!rows.length) {
      return '<div style="font-size:11px;color:var(--dim);padding:6px 0">' +
        'Henüz kayıt yok. Temsilciler \"Dosyalar\" sayfasından kayıt girdiğinde burada görünür.' +
        '</div>';
    }

    var genel = { temsil: 0, planlanan: 0, gerceklesen: 0, kongre: 0, tutar: 0 };
    rows.forEach(function (r) {
      TIP_SIRA.forEach(function (t) { genel[t] += (r.adet[t] || 0); });
      genel.tutar += r.toplamTutar;
    });

    var html = '<div class="scroll-x"><table class="tbl" style="min-width:720px">' +
      '<thead><tr>' +
        '<th>Temsilci</th>' +
        TIP_SIRA.map(function (t) { return '<th>' + TIP_KISA[t] + '</th>'; }).join('') +
        '<th>Toplam Masraf</th><th>Son Kayıt</th><th>Detay</th>' +
      '</tr></thead><tbody>';

    rows.forEach(function (r) {
      html += '<tr>' +
        '<td style="font-weight:700;white-space:nowrap">' + r.ttt + '</td>' +
        TIP_SIRA.map(function (t) {
          var n = r.adet[t] || 0;
          return '<td style="text-align:center;color:' + (n ? 'var(--fg)' : 'var(--dim)') + '">' + n + '</td>';
        }).join('') +
        '<td style="font-weight:700;white-space:nowrap">' + _fmtTL(r.toplamTutar) + '</td>' +
        '<td style="font-size:10px;color:var(--dim);white-space:nowrap">' + _tarihKisa(r.sonKayit) + '</td>' +
        '<td><button onclick="_mgrDosyalarDetay()" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surf);color:var(--c1);font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap">Detay →</button></td>' +
      '</tr>';
    });

    html += '<tr style="background:rgba(79,0,140,.05)">' +
      '<td style="font-weight:800">TOPLAM</td>' +
      TIP_SIRA.map(function (t) { return '<td style="text-align:center;font-weight:800">' + genel[t] + '</td>'; }).join('') +
      '<td style="font-weight:800;white-space:nowrap">' + _fmtTL(genel.tutar) + '</td>' +
      '<td></td><td></td>' +
    '</tr>';

    html += '</tbody></table></div>' +
      '<div style="font-size:10px;color:var(--dim);margin-top:8px">' +
        'Masraf toplamı = Temsil \"Bütçe\" + Planlanan/Gerçekleşen \"Maliyet\". ' +
        'Kongre kayıtlarında parasal alan yoktur, yalnızca adet sayılır.' +
      '</div>';
    return html;
  }

  // "Detay" → Dosyalar sayfası (yönetici orada tüm temsilci kayıtlarını
  // satır satır görür, düzenleyebilir ve Excel indirebilir).
  window._mgrDosyalarDetay = function () {
    if (typeof goPage === 'function') goPage(9);
  };

  // ── Ana render — goPage(7) tarafından çağrılır ────────────────────────
  window.renderDosyalarManagerSummary = function () {
    var el = document.getElementById('mgrDosyalarOzet');
    if (!el) return;

    var api = window.PV_DOSYALAR_API;
    if (!api) {
      el.innerHTML = '<div style="font-size:11px;color:var(--dim)">Dosyalar modülü yüklenemedi (js/ui/dosyalar-page.js).</div>';
      return;
    }

    // 1) Önce eldeki (önbellek + yerel) veriyle anında çiz
    try { el.innerHTML = _tabloHtml(_ozetHesapla(api.merged())); }
    catch (e) { el.innerHTML = '<div style="font-size:11px;color:var(--dim)">Yükleniyor…</div>'; }

    // 2) Sonra GitHub'dan tazele
    api.fetchRemote().then(function (remote) {
      if (!remote) {
        // GitHub okunamadı — eldeki görünüm kalsın, sadece uyarı ekle
        el.insertAdjacentHTML('beforeend',
          '<div style="font-size:10px;color:#D97706;margin-top:6px">' +
          '⚠ GitHub verisi okunamadı — gösterilen veriler bu cihazdaki önbellekten.</div>');
        return;
      }
      api.setRemoteCache(remote);
      el.innerHTML = _tabloHtml(_ozetHesapla(api.merged(remote)));
    }).catch(function (e) {
      console.warn('[dosyalar-mgr] özet tazelenemedi:', e && e.message);
    });
  };

  console.debug('[dosyalar-mgr] FAZ 22.1 yüklendi — Yönetici paneli Dosyalar Özeti kartı hazır.');
})();
