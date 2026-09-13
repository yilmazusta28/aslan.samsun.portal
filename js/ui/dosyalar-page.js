// ══════════════════════════════════════════════════════════════════════
//  js/ui/dosyalar-page.js
//  FAZ 19.0 — "Dosyalar" Sayfası (Sayfa 9)
//
//  Amaç: Her temsilci, sahada yaptığı sunum/toplantı bilgisini kendi
//  adına manuel girer. Şenol Yılmaz (Bölge Müdürü) TÜM temsilcilerin
//  kayıtlarını tek sayfada görür ve Excel olarak indirebilir; her
//  temsilci de yalnızca KENDİ kayıtlarını görür ve kendi Excel'ini
//  indirebilir.
//
//  Depolama deseni: stock-entry-adapter.js / route-plan-input.js İLE
//  AYNI — localStorage (anlık yerel önbellek) + GitHub'a fire-and-forget
//  POST (worker.js → /dosyalar-sync → data/dosyalar_kayitlari.json,
//  APPEND). Sayfa açıldığında GitHub'daki dosya doğrudan (raw.
//  githubusercontent.com) çekilip yerel önbellekle birleştirilir —
//  böylece Şenol Yılmaz farklı bir cihazdan girilen kayıtları da görür.
//
//  Alanlar:
//    Bölge (oto=SAMSUN), Grup (oto=ASLAN),
//    Tarih (takvim), BM (oto=ŞENOL YILMAZ), TTT (oto=giriş yapan),
//    Brick (temsilcinin kendi brick'leri + her zaman "333"),
//    Ünite (manuel), Hekim Sayısı (manuel), Bütçe (manuel),
//    Branş, Sunum Temsil Şekli, Sunumu Yapılan Ürün, Klinik,
//    Gerçekleşen Maliyet (manuel), Kişi Sayısı (manuel),
//    Kişi Başı Maliyet (OTOMATİK = Maliyet / Kişi Sayısı)
//
//  GitHub Pages compatible: classic script, no ES modules.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window._DOSYALAR_PAGE_LOADED) {
    console.warn('[dosyalar-page] Zaten yüklü — atlandı');
    return;
  }
  window._DOSYALAR_PAGE_LOADED = true;

  // ── Sabitler (kullanıcı isteğiyle tanımlanan seçenek listeleri) ───────
  var BRANS_OPTIONS   = ['A.HEK', 'ACİL', 'DAHİLİYE', 'FTR', 'ORTOPEDİ', 'GASTRO'];
  var KLINIK_OPTIONS  = ['A.HEK', 'ACİL', 'DAHİLİYE', 'FTR', 'ORTOPEDİ', 'GASTRO'];
  var TEMSIL_OPTIONS  = ['K.K', 'NAKİT', 'MERKEZİ ÖDEME'];
  var URUN_OPTIONS    = ['PANOCER', 'ACİDPASS', 'FAMTREC', 'MOKSEFEN', 'GRİPORT COLD'];

  // Bölge/Grup/BM sabit — uygulama genelinde tek bölge (SAMSUN), tek grup
  // (ASLAN) ve tek Bölge Müdürü (ŞENOL YILMAZ) var. Değişirse SADECE
  // burayı güncelle.
  var BOLGE_ADI = (window.PV_DOSYALAR_BOLGE_ADI) || 'SAMSUN';
  var GRUP_ADI  = (window.PV_DOSYALAR_GRUP_ADI) || 'ASLAN';
  var BM_ADI    = 'ŞENOL YILMAZ';

  var STORAGE_KEY   = 'pv_dosyalar_kayitlari_v1';
  var _RAW_URL       = 'https://raw.githubusercontent.com/yilmazusta28/aslan.samsun.portal/main/data/dosyalar_kayitlari.json';
  var _remoteCache   = null;  // son çekilen GitHub kayıtları (dizi) — null: henüz çekilmedi
  var _workerSyncQueue = Promise.resolve();

  // ── Yerel (localStorage) okuma/yazma ──────────────────────────────────
  function _loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { return []; }
  }
  function _saveLocal(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list || [])); } catch (e) { /* yoksay */ }
  }

  // ── GitHub'dan tüm kayıtları oku (rota-sync/fetchTeamPlans deseniyle aynı) ─
  function _fetchRemote() {
    return fetch(_RAW_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        return (data && Array.isArray(data.kayitlar)) ? data.kayitlar : [];
      })
      .catch(function (e) {
        console.warn('[dosyalar-page] GitHub\'dan kayıtlar okunamadı (yerel önbellek kullanılacak):', e && e.message);
        return null;
      });
  }

  // Yerel + uzak birleşimi — id'ye göre tekilleştirilir (yerel kayıt daha
  // güncel kabul edilir; henüz senkronlanmamış olabilir).
  function _mergedRecords(remote) {
    var local = _loadLocal();
    var byId = {};
    (remote || []).forEach(function (r) { if (r && r.id) byId[r.id] = r; });
    local.forEach(function (r) { if (r && r.id) byId[r.id] = r; });
    var all = Object.keys(byId).map(function (k) { return byId[k]; });
    all.sort(function (a, b) { return (b.enteredAt || '').localeCompare(a.enteredAt || ''); });
    return all;
  }

  function _makeId(ttt) {
    return 'dsy_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + '_' + (ttt || '').slice(0, 3);
  }

  // ── Worker'a fire-and-forget senkron (stok/route ile aynı desen) ─────
  function _syncToWorker(record) {
    if (!window.DOSYALAR_SYNC_WORKER_URL || !record) return;
    _workerSyncQueue = _workerSyncQueue.then(function () {
      return (typeof pvAuthHeaders === 'function' ? pvAuthHeaders() : Promise.resolve({}))
        .then(function (authHeaders) {
          return fetch(window.DOSYALAR_SYNC_WORKER_URL, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
            body: JSON.stringify(record)
          });
        })
        .then(function (res) {
          if (res && !res.ok) console.warn('[dosyalar-page] worker senkron HTTP hatası:', res.status);
        })
        .catch(function (e) {
          console.warn('[dosyalar-page] worker senkron hatası (yoksayıldı, yerel kayıt geçerli):', e && e.message);
        });
    }).catch(function () {});
  }

  // ── Temsilcinin kendi brick'lerini bul (IMS verisinden) ───────────────
  // Her zaman "333" (ortak/paylaşımlı brick) listeye eklenir — kullanıcı
  // isteği: "brick yanında 333 brick sırasını da görebilsin".
  function getTTTBricks(ttt) {
    var set = {};
    try {
      if (typeof IMS !== 'undefined' && Array.isArray(IMS)) {
        IMS.forEach(function (r) {
          if (r && r.ttt === ttt && r.brick) set[String(r.brick).trim()] = true;
        });
      }
    } catch (e) { /* IMS henüz yüklenmemiş olabilir */ }
    var list = Object.keys(set).sort();
    if (list.indexOf('333') === -1) list.push('333');
    return list;
  }

  function _currentTTT() {
    return (typeof LOGGED_IN_USER !== 'undefined' && LOGGED_IN_USER) ? LOGGED_IN_USER : (window.LOGGED_IN_USER || '');
  }
  function _isManager() {
    return _currentTTT() === 'ŞENOL YILMAZ';
  }

  // ── Form HTML ──────────────────────────────────────────────────────
  function _optionsHtml(list, selected) {
    return list.map(function (o) {
      return '<option value="' + o + '"' + (o === selected ? ' selected' : '') + '>' + o + '</option>';
    }).join('');
  }

  function _buildFormHtml() {
    var ttt = _currentTTT();
    var bricks = getTTTBricks(ttt);

    return '' +
    '<div class="card mb16">' +
      '<div class="card-hd">' +
        '<span class="card-title">📁 Yeni Saha Kaydı</span>' +
        '<span class="card-badge">' + ttt + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="g2">' +
          '<div>' +
            '<div class="section-h">Otomatik Bilgiler</div>' +
            '<div class="g2" style="gap:10px">' +
              _roField('Bölge', BOLGE_ADI, 'dsyBolge') +
              _roField('Grup', GRUP_ADI, 'dsyGrup') +
              _roField('BM', BM_ADI, 'dsyBM') +
              _roField('TTT', ttt, 'dsyTTT') +
            '</div>' +
            '<div style="margin-top:10px">' +
              '<label class="dsy-lbl">Tarih</label>' +
              '<input type="date" class="inp" id="dsyTarih" style="width:100%">' +
            '</div>' +
            '<div style="margin-top:10px">' +
              '<label class="dsy-lbl">Brick</label>' +
              '<select class="inp" id="dsyBrick" style="width:100%">' + _optionsHtml(bricks, bricks[0]) + '</select>' +
              '<div style="font-size:9px;color:var(--dim);margin-top:3px">Kendi brick\'lerin listelenir — 333 (ortak brick) her zaman seçenekler arasındadır.</div>' +
            '</div>' +
            '<div style="margin-top:10px">' +
              '<label class="dsy-lbl">Ünite</label>' +
              '<input type="text" class="inp" id="dsyUnite" style="width:100%" placeholder="Ünite adı...">' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="section-h">Manuel Girilenler</div>' +
            '<div class="g2" style="gap:10px">' +
              '<div><label class="dsy-lbl">Hekim Sayısı</label><input type="number" min="0" class="inp" id="dsyHekimSayisi" style="width:100%" placeholder="0"></div>' +
              '<div><label class="dsy-lbl">Bütçe (₺)</label><input type="number" min="0" class="inp" id="dsyButce" style="width:100%" placeholder="0"></div>' +
            '</div>' +
            '<div class="g2" style="gap:10px;margin-top:10px">' +
              '<div><label class="dsy-lbl">Branş</label><select class="inp" id="dsyBrans" style="width:100%">' + _optionsHtml(BRANS_OPTIONS) + '</select></div>' +
              '<div><label class="dsy-lbl">Klinik</label><select class="inp" id="dsyKlinik" style="width:100%">' + _optionsHtml(KLINIK_OPTIONS) + '</select></div>' +
            '</div>' +
            '<div class="g2" style="gap:10px;margin-top:10px">' +
              '<div><label class="dsy-lbl">Sunum Temsil Şekli</label><select class="inp" id="dsyTemsil" style="width:100%">' + _optionsHtml(TEMSIL_OPTIONS) + '</select></div>' +
              '<div><label class="dsy-lbl">Sunumu Yapılan Ürün</label><select class="inp" id="dsyUrun" style="width:100%">' + _optionsHtml(URUN_OPTIONS) + '</select></div>' +
            '</div>' +
            '<div class="g2" style="gap:10px;margin-top:10px">' +
              '<div><label class="dsy-lbl">Gerçekleşen Maliyet (₺)</label><input type="number" min="0" class="inp" id="dsyMaliyet" oninput="_dsyUpdateKisiBasi()" style="width:100%" placeholder="0"></div>' +
              '<div><label class="dsy-lbl">Kişi Sayısı</label><input type="number" min="0" class="inp" id="dsyKisiSayisi" oninput="_dsyUpdateKisiBasi()" style="width:100%" placeholder="0"></div>' +
            '</div>' +
            '<div style="margin-top:10px;background:#F7F9FC;border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between">' +
              '<span style="font-size:10px;font-weight:600;color:var(--dim)">Kişi Başı Maliyet (otomatik)</span>' +
              '<span id="dsyKisiBasi" style="font-size:14px;font-weight:700;color:var(--c1)">—</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<button onclick="_dsySubmit()" style="padding:8px 18px;border-radius:8px;border:none;background:var(--c1);color:#fff;font-size:12px;font-weight:700;cursor:pointer">💾 Kaydet</button>' +
          '<span id="dsyFormStatus" style="font-size:11px;color:var(--dim)"></span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _roField(label, value, id) {
    return '<div><label class="dsy-lbl">' + label + '</label>' +
      '<input type="text" class="inp" id="' + id + '" value="' + value + '" readonly ' +
      'style="width:100%;background:#F1F3F8;color:var(--dim);cursor:not-allowed"></div>';
  }

  // ── Kişi başı maliyeti canlı hesapla (global — oninput'tan çağrılır) ──
  window._dsyUpdateKisiBasi = function () {
    var maliyetEl = document.getElementById('dsyMaliyet');
    var kisiEl    = document.getElementById('dsyKisiSayisi');
    var outEl     = document.getElementById('dsyKisiBasi');
    if (!outEl) return;
    var maliyet = parseFloat(maliyetEl && maliyetEl.value) || 0;
    var kisi    = parseFloat(kisiEl && kisiEl.value) || 0;
    if (kisi > 0) {
      outEl.textContent = (typeof fTL === 'function') ? fTL(maliyet / kisi) : (Math.round(maliyet / kisi).toLocaleString('tr-TR') + ' ₺');
    } else {
      outEl.textContent = '—';
    }
  };

  // ── Kayıt gönder ───────────────────────────────────────────────────
  window._dsySubmit = function () {
    var statusEl = document.getElementById('dsyFormStatus');
    var ttt = _currentTTT();
    var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };

    var tarih   = val('dsyTarih');
    var brick   = val('dsyBrick');
    var unite   = (val('dsyUnite') || '').trim();
    var hekim   = parseFloat(val('dsyHekimSayisi')) || 0;
    var butce   = parseFloat(val('dsyButce')) || 0;
    var brans   = val('dsyBrans');
    var klinik  = val('dsyKlinik');
    var temsil  = val('dsyTemsil');
    var urun    = val('dsyUrun');
    var grup    = val('dsyGrup');
    var maliyet = parseFloat(val('dsyMaliyet')) || 0;
    var kisi    = parseFloat(val('dsyKisiSayisi')) || 0;

    if (!tarih) { if (statusEl) statusEl.textContent = '⚠ Tarih seçilmedi.'; return; }
    if (!brick) { if (statusEl) statusEl.textContent = '⚠ Brick seçilmedi.'; return; }
    if (!unite) { if (statusEl) statusEl.textContent = '⚠ Ünite alanı boş olamaz.'; return; }
    if (kisi <= 0) { if (statusEl) statusEl.textContent = '⚠ Kişi sayısı 0\'dan büyük olmalı.'; return; }

    var kisiBasi = kisi > 0 ? (maliyet / kisi) : 0;

    var record = {
      id: _makeId(ttt),
      bolge: BOLGE_ADI,
      grup: grup,
      tarih: tarih,
      bm: BM_ADI,
      ttt: ttt,
      brick: brick,
      unite: unite,
      hekimSayisi: hekim,
      butce: butce,
      brans: brans,
      klinik: klinik,
      sunumTemsil: temsil,
      urun: urun,
      maliyet: maliyet,
      kisiSayisi: kisi,
      kisiBasi: kisiBasi,
      enteredAt: new Date().toISOString()
    };

    var local = _loadLocal();
    local.push(record);
    _saveLocal(local);
    _syncToWorker(record);

    if (statusEl) {
      statusEl.textContent = '✓ Kaydedildi';
      setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 3000);
    }

    // Formu kısmen sıfırla (Bölge/Grup/BM/TTT/Brick/Tarih kalıcı kalabilir,
    // tekrarlayan girişte hız için sadece değişken alanlar temizlenir)
    ['dsyUnite', 'dsyHekimSayisi', 'dsyButce', 'dsyMaliyet', 'dsyKisiSayisi'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var kb = document.getElementById('dsyKisiBasi'); if (kb) kb.textContent = '—';

    _renderTableFromSource();
  };

  // ── Tablo + Excel export ──────────────────────────────────────────
  var TABLE_COLS = [
    { key: 'ttt',         label: 'TTT',              managerOnly: true },
    { key: 'bolge',       label: 'Bölge' },
    { key: 'grup',        label: 'Grup' },
    { key: 'tarih',       label: 'Tarih' },
    { key: 'bm',          label: 'BM' },
    { key: 'brick',       label: 'Brick' },
    { key: 'unite',       label: 'Ünite' },
    { key: 'hekimSayisi', label: 'Hekim Sayısı' },
    { key: 'butce',       label: 'Bütçe' },
    { key: 'brans',       label: 'Branş' },
    { key: 'klinik',      label: 'Klinik' },
    { key: 'sunumTemsil', label: 'Sunum Temsil' },
    { key: 'urun',        label: 'Ürün' },
    { key: 'maliyet',     label: 'Gerçekleşen Maliyet' },
    { key: 'kisiSayisi',  label: 'Kişi Sayısı' },
    { key: 'kisiBasi',    label: 'Kişi Başı Maliyet' }
  ];

  function _visibleRecords(all) {
    var manager = _isManager();
    var ttt = _currentTTT();
    return manager ? all : all.filter(function (r) { return r.ttt === ttt; });
  }

  function _renderTable(all) {
    var el = document.getElementById('dsyTableWrap');
    if (!el) return;
    var manager = _isManager();
    var rows = _visibleRecords(all);
    var cols = TABLE_COLS.filter(function (c) { return manager || !c.managerOnly; });

    var head = '<tr>' + cols.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '</tr>';
    var body = rows.length === 0
      ? '<tr><td colspan="' + cols.length + '" style="text-align:center;color:var(--dim);padding:14px">Henüz kayıt yok.</td></tr>'
      : rows.map(function (r) {
          return '<tr>' + cols.map(function (c) {
            var v = r[c.key];
            if (c.key === 'butce' || c.key === 'maliyet' || c.key === 'kisiBasi') {
              v = (typeof fTL === 'function') ? fTL(v) : v;
            }
            return '<td>' + (v == null ? '—' : v) + '</td>';
          }).join('') + '</tr>';
        }).join('');

    el.innerHTML =
      '<div style="overflow-x:auto"><table class="tbl" id="dsyTable"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';

    var countEl = document.getElementById('dsyRecordCount');
    if (countEl) countEl.textContent = rows.length + ' kayıt' + (manager ? ' (tüm temsilciler)' : '');
  }

  function _renderTableFromSource() {
    // Önce yerelle hızlıca göster, arka planda GitHub'dan tazele
    _renderTable(_mergedRecords(_remoteCache));
    _fetchRemote().then(function (remote) {
      if (remote) { _remoteCache = remote; _renderTable(_mergedRecords(remote)); }
    });
  }

  window.exportDosyalarExcel = function () {
    if (typeof XLSX === 'undefined') { alert('Excel kütüphanesi yüklenemedi.'); return; }
    var manager = _isManager();
    var ttt = _currentTTT();
    var rows = _visibleRecords(_mergedRecords(_remoteCache));
    var cols = TABLE_COLS.filter(function (c) { return manager || !c.managerOnly; });

    var sheetData = rows.map(function (r) {
      var row = {};
      cols.forEach(function (c) { row[c.label] = r[c.key] == null ? '' : r[c.key]; });
      return row;
    });

    var ws = XLSX.utils.json_to_sheet(sheetData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dosyalar');
    var fname = 'Dosyalar_' + (manager ? 'TUM_TEMSILCILER' : ttt.replace(/\s+/g, '_')) + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    XLSX.writeFile(wb, fname);
  };

  // ── Sayfa render (goPage(9) tarafından çağrılır) ──────────────────
  window.renderDosyalarPage = function () {
    var page = document.getElementById('page9');
    if (!page) return;
    var manager = _isManager();
    var ttt = _currentTTT();

    var html = '';
    if (!manager) {
      html += _buildFormHtml();
    } else {
      html += '<div class="card mb16"><div class="card-body" style="font-size:12px;color:var(--dim)">' +
        '📋 Bölge Müdürü görünümü — tüm temsilcilerin girdiği saha kayıtları aşağıda listelenir. Kendi kaydını girmek bu görünümde yoktur (yalnızca temsilciler girer).' +
        '</div></div>';
    }

    html += '' +
      '<div class="card">' +
        '<div class="card-hd">' +
          '<span class="card-title">🗂️ ' + (manager ? 'Tüm Temsilci Kayıtları' : 'Girdiğim Kayıtlar') + '</span>' +
          '<span class="card-badge" id="dsyRecordCount">—</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<div style="margin-bottom:10px">' +
            '<button onclick="exportDosyalarExcel()" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surf);font-size:11px;font-weight:600;cursor:pointer;color:var(--c1)">📥 Excel Olarak İndir</button>' +
          '</div>' +
          '<div id="dsyTableWrap"></div>' +
        '</div>' +
      '</div>';

    page.innerHTML = html;

    // Bugünün tarihi varsayılan olsun (temsilci formu varsa)
    var tarihEl = document.getElementById('dsyTarih');
    if (tarihEl && !tarihEl.value) tarihEl.value = new Date().toISOString().slice(0, 10);

    _renderTableFromSource();
  };

  console.debug('[dosyalar-page] FAZ 19.0 yüklendi.');
})();
